#include "../src/room_reverb.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <memory>
#include <vector>

namespace {
using vttrig::Sample;
constexpr double kRate = 48000.0;

std::vector<Sample> impulse(std::size_t frames, double amplitude = 0.7) {
  std::vector<Sample> samples(frames, 0.0);
  samples[0] = amplitude;
  return samples;
}

std::vector<Sample> render(const std::vector<Sample>& dry,
                           const vttrig::RoomReverbParams& params,
                           std::size_t block = 128) {
  vttrig::RoomReverbMonoProcessor reverb(params, kRate);
  auto in = dry;
  std::vector<Sample> out(dry.size(), 0.0);
  for (std::size_t i = 0; i < in.size(); i += block) {
    const auto frames = static_cast<int>(std::min(block, in.size() - i));
    reverb.process(in.data() + i, out.data() + i, frames);
  }
  return out;
}

double energy(const std::vector<Sample>& samples,
              std::size_t start, std::size_t finish) {
  double sum = 0.0;
  for (std::size_t i = start; i < finish; ++i)
    sum += samples[i] * samples[i];
  return sum;
}

std::size_t first_reflection(const std::vector<Sample>& signal) {
  for (std::size_t i = 1; i < signal.size(); ++i)
    if (std::abs(signal[i]) > 1.0e-9) return i;
  return signal.size();
}
} // namespace

int main() {
  vttrig::RoomReverbParams p;
  // Dry passes even non-clamped peaks exactly.
  p.mix = 0.0;
  const std::vector<Sample> peaks{1.5, -1.25, 0.0, 0.5, -0.1};
  assert(render(peaks, p) == peaks);

  // Wet-only must have no direct feedthrough and produce a diffuse tail.
  const auto dry = impulse(5 * 48000);
  p.mix = 100.0;
  const auto wet = render(dry, p);
  assert(wet[0] == 0.0);
  assert(first_reflection(wet) < 4800); // early room reflection within 100 ms
  assert(energy(wet, 0, 48000) > 1.0e-6);
  assert(energy(wet, 48000, 96000) > 1.0e-12);
  for (double sample : wet) {
    assert(std::isfinite(sample));
    assert(std::abs(sample) < 3.0);
  }

  // Size changes actual comb/allpass lengths, not just the UI knob.
  p.size = 0.0;
  const auto small = render(dry, p);
  p.size = 100.0;
  const auto large = render(dry, p);
  assert(first_reflection(small) < first_reflection(large));
  p.size = 67.0;

  // Decay controls the density/energy of the late reverb tail.
  p.decay = 0.2;
  const auto short_tail = render(dry, p);
  p.decay = 12.0;
  const auto long_tail = render(dry, p);
  assert(energy(long_tail, 48000, 96000) >
         2.0 * energy(short_tail, 48000, 96000));

  // Mix interpolates between exact dry and wet signal.
  p.decay = 4.2;
  p.mix = 35.0;
  const auto blended = render(dry, p);
  assert(std::abs(blended[0] - 0.7 * 0.65) < 1.0e-12);
  assert(energy(blended, 1, 48000) > 0.0);

  // Stream processing must produce the same bytes regardless of block size.
  assert(render(dry, p, 1) == render(dry, p, 128));
  assert(render(dry, p, 512) == render(dry, p, 128));

  // Very long decay on sustained input must not produce hazardous wet peaks.
  p.decay = 15.0;
  p.mix = 100.0;
  const std::vector<Sample> sustained_input(48000, 0.8);
  for (double sample : render(sustained_input, p)) {
    assert(std::isfinite(sample));
    assert(std::abs(sample) <= 1.0);
  }
  p.decay = 4.2;
  p.mix = 35.0;

  // Silence stays silent. No artificial hiss / denormal injection.
  const std::vector<Sample> silence(24000, 0.0);
  for (double sample : render(silence, p)) assert(sample == 0.0);

  // Each instance has independent buffers; bypass removes its contribution.
  vttrig::MonoChain chain;
  chain.append(vttrig::Stage{
      "room-a", "reverb", true,
      std::make_unique<vttrig::RoomReverbMonoProcessor>(p)});
  chain.append(vttrig::Stage{
      "room-b", "reverb", false,
      std::make_unique<vttrig::RoomReverbMonoProcessor>(p)});
  Sample in[4]{0.1, -0.2, 0.0, 0.25}, out[4]{};
  assert(chain.set_enabled("room-a", false));
  chain.process(in, out, 4);
  for (int i = 0; i < 4; ++i) assert(in[i] == out[i]);
  assert(chain.set_enabled("room-a", true));
  chain.process(in, out, 4);
  for (double sample : out) assert(std::isfinite(sample));
  return 0;
}
