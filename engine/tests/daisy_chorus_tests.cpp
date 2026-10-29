#include "../src/daisy_chorus.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <memory>
#include <numbers>
#include <vector>

namespace {
constexpr double kRate = 48000.0;

std::vector<vttrig::Sample> sine(double level, std::size_t frames) {
  std::vector<vttrig::Sample> samples(frames);
  for (std::size_t i = 0; i < frames; ++i)
    samples[i] = level * std::sin(2.0 * std::numbers::pi *
                                 440.0 * static_cast<double>(i) / kRate);
  return samples;
}

std::vector<vttrig::Sample> render(const std::vector<vttrig::Sample>& dry,
                                  const vttrig::ChorusParams& p,
                                  std::size_t block_size = 128) {
  vttrig::DaisyChorusMonoProcessor chorus(p, kRate);
  std::vector<vttrig::Sample> input = dry;
  std::vector<vttrig::Sample> output(dry.size());
  for (std::size_t i = 0; i < dry.size(); i += block_size) {
    const auto count =
        static_cast<int>(std::min(block_size, dry.size() - i));
    chorus.process(input.data() + i, output.data() + i, count);
  }
  return output;
}

double difference(const std::vector<vttrig::Sample>& a,
                  const std::vector<vttrig::Sample>& b,
                  std::size_t start) {
  double result = 0.0;
  for (std::size_t i = start; i < a.size(); ++i) {
    const double delta = a[i] - b[i];
    result += delta * delta;
  }
  return std::sqrt(result / static_cast<double>(a.size() - start));
}
} // namespace

int main() {
  vttrig::ChorusParams p;
  const auto input = sine(0.4, 48000);

  // Zero wet preserves every sample exactly, including the signal peak.
  p.mix = 0.0;
  assert(render(input, p) == input);
  assert(render({0.0, 1.2, -1.3, 0.4}, p) ==
         (std::vector<vttrig::Sample>{0.0, 1.2, -1.3, 0.4}));

  // Fully wet: the delay line is initially empty; the impulse must be
  // audibly delayed, with no dry feedthrough at frame zero.
  p.mix = 100.0;
  std::vector<vttrig::Sample> impulse(9600, 0.0);
  impulse[0] = 0.5;
  const auto wet_impulse = render(impulse, p);
  assert(wet_impulse[0] == 0.0);
  bool heard = false;
  for (std::size_t i = 1; i < wet_impulse.size(); ++i) {
    if (std::abs(wet_impulse[i]) > 0.0001) heard = true;
    assert(std::isfinite(wet_impulse[i]));
  }
  assert(heard);

  // The actual signal, not just the UI, changes with Rate, Depth and Mix.
  p.mix = 40;
  const auto normal = render(input, p);
  p.rate = 0.1;
  const auto slow = render(input, p);
  p.rate = 8.0;
  const auto fast = render(input, p);
  assert(difference(slow, fast, 12000) > 0.0001);
  p.rate = 1.2;
  p.depth = 0.0;
  const auto static_delay = render(input, p);
  p.depth = 90.0;
  const auto deep = render(input, p);
  assert(difference(static_delay, deep, 12000) > 0.0001);
  p.depth = 48.0;
  p.mix = 100.0;
  const auto full_wet = render(input, p);
  assert(difference(normal, full_wet, 12000) > 0.0001);

  // State must not depend on callback block size.
  assert(render(input, p, 1) == render(input, p, 128));
  assert(render(input, p, 1024) == render(input, p, 128));

  // Silence and a long feedback tail must remain finite and stable.
  const std::vector<vttrig::Sample> silence(48000, 0.0);
  for (double sample : render(silence, p)) assert(sample == 0.0);
  const auto tail = render(impulse, p);
  for (double sample : tail) {
    assert(std::isfinite(sample));
    assert(std::abs(sample) < 1.0);
  }

  // Two independent Chorus pedals, with per-instance bypass.
  vttrig::MonoChain chain;
  chain.append(vttrig::Stage{"chorus-a", "chorus", true,
      std::make_unique<vttrig::DaisyChorusMonoProcessor>(p)});
  chain.append(vttrig::Stage{"chorus-b", "chorus", false,
      std::make_unique<vttrig::DaisyChorusMonoProcessor>(p)});
  vttrig::Sample in[4]{0.1, -0.2, 0.0, 0.3}, out[4]{};
  assert(chain.set_enabled("chorus-a", false));
  chain.process(in, out, 4);
  for (int i = 0; i < 4; ++i) assert(in[i] == out[i]);
  assert(chain.set_enabled("chorus-a", true));
  chain.process(in, out, 4);
  for (double sample : out) assert(std::isfinite(sample));
  return 0;
}
