#include "../src/pressure_sustain.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <memory>
#include <numbers>
#include <vector>

namespace {
constexpr double kRate = 48000.0;

std::vector<vttrig::Sample> sine(double amplitude, std::size_t frames) {
  std::vector<vttrig::Sample> signal(frames);
  for (std::size_t i = 0; i < frames; ++i)
    signal[i] = amplitude * std::sin(2.0 * std::numbers::pi *
                                   440.0 * static_cast<double>(i) / kRate);
  return signal;
}
std::vector<vttrig::Sample> render(
    const std::vector<vttrig::Sample>& dry,
    const vttrig::PressureSustainParams& p, std::size_t block = 128) {
  vttrig::PressureSustainMonoProcessor sustain(p, kRate);
  auto in = dry;
  std::vector<vttrig::Sample> out(dry.size());
  for (std::size_t at = 0; at < dry.size(); at += block) {
    const auto size = static_cast<int>(std::min(block, dry.size() - at));
    sustain.process(in.data() + at, out.data() + at, size);
  }
  return out;
}
double rms(const std::vector<vttrig::Sample>& samples,
           std::size_t from, std::size_t to) {
  double sum = 0.0;
  for (std::size_t i = from; i < to; ++i) sum += samples[i] * samples[i];
  return std::sqrt(sum / static_cast<double>(to - from));
}
}

int main() {
  vttrig::PressureSustainParams p;
  const auto moderate = sine(0.15, 24000);
  // Pressure=0 and 0dB level must not create phantom compression on
  // normalized audio. The Pressure5 threshold is unity at A=0.
  p.sustain = 0;
  auto unity = render(moderate, p);
  for (std::size_t i = 0; i < moderate.size(); ++i)
    assert(std::abs(unity[i] - moderate[i]) < 1e-11);

  p.sustain = 65;
  p.speed = 25;
  const auto sustained = render(moderate, p);
  assert(rms(sustained, 12000, 24000) > rms(moderate, 12000, 24000) * 1.1);
  for (double sample : sustained) {
    assert(std::isfinite(sample));
    assert(sample >= -1.0 && sample <= 1.0);
  }

  // Sustain strength, Speed and Level all change actual audio.
  p.sustain = 25;
  const auto gentle = render(moderate, p);
  assert(rms(sustained, 12000, 24000) > rms(gentle, 12000, 24000));
  p.sustain = 65;
  p.speed = 95;
  const auto fast = render(moderate, p);
  assert(std::abs(rms(fast, 12000, 24000) -
                  rms(sustained, 12000, 24000)) > 0.00001);
  p.speed = 25;
  p.level = -12;
  const auto quieter = render(moderate, p);
  assert(rms(quieter, 12000, 24000) < rms(sustained, 12000, 24000) * 0.6);

  // A 0% Dry/Wet mix must pass dry input untouched in the normal signal range.
  p.mix = 0;
  const auto dry = render(moderate, p);
  for (std::size_t i = 0; i < moderate.size(); ++i)
    assert(dry[i] == moderate[i]);

  // Split processing at arbitrary block boundaries must equal single-sample
  // processing; the 48k host currently uses 128 frames.
  p.mix = 100;
  p.level = 0;
  assert(render(moderate, p, 1) == render(moderate, p, 128));
  assert(render(moderate, p, 512) == render(moderate, p, 128));

  // Quiet decay should get support, but silence must remain exact silence.
  const std::vector<vttrig::Sample> silence(48000, 0.0);
  for (double sample : render(silence, p)) assert(sample == 0.0);
  const auto low = sine(0.002, 48000);
  const auto boosted_tail = render(low, p);
  assert(rms(boosted_tail, 24000, 48000) > rms(low, 24000, 48000));

  // Independent instances with bypass and original chain ordering.
  vttrig::MonoChain chain;
  chain.append(vttrig::Stage{"sustain-a", "sustain", true,
                             std::make_unique<vttrig::PressureSustainMonoProcessor>(p)});
  chain.append(vttrig::Stage{"sustain-b", "sustain", false,
                             std::make_unique<vttrig::PressureSustainMonoProcessor>(p)});
  vttrig::Sample in[4]{0.1, -0.1, 0.0, 0.2}, out[4]{};
  assert(chain.set_enabled("sustain-a", false));
  chain.process(in, out, 4);
  for (int i = 0; i < 4; ++i) assert(in[i] == out[i]);
  assert(chain.set_enabled("sustain-a", true));
  chain.process(in, out, 4);
  for (const double sample : out) assert(std::isfinite(sample));
  return 0;
}
