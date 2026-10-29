#include "../src/classic_delay.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <memory>
#include <vector>

namespace {
using vttrig::Sample;
constexpr double kRate = 48000.0;

std::vector<Sample> render(const std::vector<Sample>& dry,
                           const vttrig::DelayParams& p,
                           std::size_t block = 128) {
  vttrig::ClassicDelayMonoProcessor delay(p, kRate);
  std::vector<Sample> in = dry;
  std::vector<Sample> out(dry.size(), 0.0);
  for (std::size_t offset = 0; offset < dry.size(); offset += block) {
    const auto frames =
        static_cast<int>(std::min(block, dry.size() - offset));
    delay.process(in.data() + offset, out.data() + offset, frames);
  }
  return out;
}

std::vector<Sample> impulse(std::size_t n, double amp = 1.0) {
  std::vector<Sample> samples(n, 0.0);
  samples.front() = amp;
  return samples;
}
} // namespace

int main() {
  vttrig::DelayParams p;
  // An entirely dry effect is bit-identical, even for peaks > 1.0.
  p.mix = 0.0;
  const std::vector<Sample> peaks{1.4, -1.25, 0.0, 0.2, -0.1};
  assert(render(peaks, p) == peaks);

  // At minimum time 40 ms / 48 kHz, first repeat starts at sample 1920.
  p.time = 40.0;
  p.feedback = 0.0;
  p.mix = 100.0;
  const auto small = render(impulse(5000), p);
  for (int i = 0; i < 1920; ++i) assert(small[i] == 0.0);
  assert(small[1920] == 1.0);
  for (std::size_t i = 1921; i < small.size(); ++i)
    assert(small[i] == 0.0);

  // At 420 ms, first echo is sample-exact at 20,160, including for
  // uninterrupted block processing and a dry/wet blend.
  p.time = 420.0;
  p.mix = 25.0;
  auto blended = render(impulse(23000), p);
  assert(blended[0] == 0.75);
  assert(blended[20159] == 0.0);
  assert(blended[20160] == 0.25);

  // At 1200 ms, the maximum delay fits the preallocated buffer.
  p.time = 1200.0;
  p.mix = 100.0;
  const auto long_echo = render(impulse(59000), p);
  assert(long_echo[57599] == 0.0);
  assert(long_echo[57600] == 1.0);

  // Feedback creates subsequent decaying repeats, smoothed by the
  // lowpass+soft saturation loop without creating runaway gain.
  p.time = 40.0;
  p.feedback = 65.0;
  const auto echo = render(impulse(48000, 0.7), p);
  assert(echo[1920] == 0.7);
  double repeat_energy = 0.0;
  for (int i = 3800; i < 3950; ++i)
    repeat_energy += std::abs(echo[i]);
  assert(repeat_energy > 0.01);
  for (double sample : echo) {
    assert(std::isfinite(sample));
    assert(std::abs(sample) <= 1.0);
  }

  // Feedback=0 produces one repeat; varying the feedback changes the sound.
  p.feedback = 0.0;
  const auto one_echo = render(impulse(48000, 0.7), p);
  for (std::size_t i = 3840; i < one_echo.size(); ++i)
    assert(one_echo[i] == 0.0);

  // The DSP state must be independent of the host's callback block size.
  p.feedback = 60.0;
  assert(render(impulse(25000), p, 1) ==
         render(impulse(25000), p, 128));
  assert(render(impulse(25000), p, 1024) ==
         render(impulse(25000), p, 128));

  // Silence remains silence without denormal hiss.
  const std::vector<Sample> silence(15000, 0.0);
  for (double sample : render(silence, p)) assert(sample == 0.0);

  // Multiple delays are independent; a disabled stage never processes.
  vttrig::MonoChain chain;
  chain.append(vttrig::Stage{
      "dly-a", "delay", true,
      std::make_unique<vttrig::ClassicDelayMonoProcessor>(p)});
  chain.append(vttrig::Stage{
      "dly-b", "delay", false,
      std::make_unique<vttrig::ClassicDelayMonoProcessor>(p)});
  Sample in[4]{0.1, -0.2, 0.0, 0.25}, out[4]{};
  assert(chain.set_enabled("dly-a", false));
  chain.process(in, out, 4);
  for (int i = 0; i < 4; ++i) assert(in[i] == out[i]);
  assert(chain.set_enabled("dly-a", true));
  chain.process(in, out, 4);
  for (double sample : out) assert(std::isfinite(sample));
  return 0;
}
