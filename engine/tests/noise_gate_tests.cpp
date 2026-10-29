#include "../src/noise_gate.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <numbers>
#include <vector>

// DSP regression tests, independent of NAM models, JUCE, audio devices or
// OS backends. TONE3000 upstream regression: test/src/gate_tests.cpp.
namespace {
constexpr double kRate = 48000.0;

std::vector<vttrig::Sample> sine(double amplitude, std::size_t frames) {
  std::vector<vttrig::Sample> samples(frames);
  for (std::size_t i = 0; i < frames; ++i) {
    samples[i] = amplitude * std::sin(2.0 * std::numbers::pi *
                                     1000.0 * static_cast<double>(i) / kRate);
  }
  return samples;
}

double rms(const std::vector<vttrig::Sample>& signal, std::size_t begin,
           std::size_t end) {
  double power = 0.0;
  for (std::size_t i = begin; i < end; ++i) power += signal[i] * signal[i];
  return std::sqrt(power / static_cast<double>(end - begin));
}

std::vector<vttrig::Sample> render(const std::vector<vttrig::Sample>& dry,
                                    const vttrig::NoiseGateParams& params) {
  vttrig::NoiseGateMonoProcessor gate(params);
  std::vector<vttrig::Sample> wet(dry.size());
  constexpr int kBlock = 128;
  for (std::size_t off = 0; off < dry.size(); off += kBlock) {
    const int count = static_cast<int>(std::min<std::size_t>(kBlock, dry.size() - off));
    gate.process(const_cast<vttrig::Sample*>(dry.data() + off),
                 wet.data() + off, count);
  }
  return wet;
}
}  // namespace

int main() {
  const auto loud = sine(0.5, 48000);
  const vttrig::NoiseGateParams defaults;
  const auto opened = render(loud, defaults);
  // A strong note opens the gate quickly and passes its steady-state level.
  assert(std::abs(rms(opened, 24000, 48000) / rms(loud, 24000, 48000) - 1.0) < 0.002);

  vttrig::NoiseGateParams p;
  p.threshold = -30.0;
  p.range = 40.0;
  const auto quiet = sine(0.00001, 48000);
  const auto closed = render(quiet, p);
  const auto attenuation_db =
      20.0 * std::log10(rms(closed, 24000, 48000) / rms(quiet, 24000, 48000));
  assert(std::abs(attenuation_db + 40.0) < 1.0);

  // After a strong burst, Hold postpones the closing transition.
  std::vector<vttrig::Sample> burst = sine(0.5, 9600);
  const auto tail = sine(0.00005, 48000);
  burst.insert(burst.end(), tail.begin(), tail.end());
  p.threshold = -30.0;
  p.release = 5.0;
  p.hold = 0.0;
  p.range = 80.0;
  const auto no_hold = render(burst, p);
  p.hold = 150.0;
  const auto with_hold = render(burst, p);
  // About 75 ms after the burst, a held gate remains substantially louder.
  const std::size_t begin = 9600 + 3600, end = begin + 960;
  assert(rms(with_hold, begin, end) > rms(no_hold, begin, end) * 10.0);

  // Two instances must be independent. Bypass must pass the original bytes.
  vttrig::MonoChain chain;
  chain.append(vttrig::Stage{"gate-a", "gate", true,
                             std::make_unique<vttrig::NoiseGateMonoProcessor>(p)});
  chain.append(vttrig::Stage{"gate-b", "gate", false,
                             std::make_unique<vttrig::NoiseGateMonoProcessor>(p)});
  vttrig::Sample in[4]{0.1, -0.1, 0.0, 0.2}, out[4]{};
  chain.set_enabled("gate-a", false);
  chain.process(in, out, 4);
  for (int i = 0; i < 4; ++i) assert(in[i] == out[i]);

  return 0;
}
