#include "../src/butter_comp2.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <memory>
#include <numbers>
#include <vector>

namespace {
constexpr double kRate = 48000.0;
std::vector<vttrig::Sample> sine(double level, int samples) {
  std::vector<vttrig::Sample> data(samples);
  for (int i = 0; i < samples; ++i)
    data[static_cast<std::size_t>(i)] =
        level * std::sin(2.0 * std::numbers::pi * 440.0 * i / kRate);
  return data;
}
std::vector<vttrig::Sample> render(const std::vector<vttrig::Sample>& source,
                                  const vttrig::ButterComp2Params& settings,
                                  int block = 128) {
  vttrig::ButterComp2MonoProcessor effect(settings);
  auto input = source;
  std::vector<vttrig::Sample> output(source.size());
  for (std::size_t off = 0; off < source.size(); off += static_cast<std::size_t>(block)) {
    const int n = static_cast<int>(std::min<std::size_t>(block, source.size() - off));
    effect.process(input.data() + off, output.data() + off, n);
  }
  return output;
}
double rms(const std::vector<vttrig::Sample>& data, std::size_t from) {
  double sum = 0.0;
  for (std::size_t i = from; i < data.size(); ++i) sum += data[i] * data[i];
  return std::sqrt(sum / static_cast<double>(data.size() - from));
}
}

int main() {
  const auto dry = sine(0.45, 48000);
  vttrig::ButterComp2Params p;
  p.compress = 0.0;
  p.output = 100.0;
  p.mix = 100.0;
  auto unity = render(dry, p);
  // The original Airwindows A=0 mode is transparent for normalized audio.
  for (std::size_t i = 0; i < dry.size(); ++i)
    assert(std::abs(unity[i] - dry[i]) < 1e-12);

  p.compress = 90.0;
  p.mix = 0.0;
  auto fully_dry = render(dry, p);
  for (std::size_t i = 0; i < dry.size(); ++i)
    assert(fully_dry[i] == dry[i]);

  p.mix = 100.0;
  p.output = 100.0;
  const auto processed = render(dry, p);
  assert(std::abs(rms(processed, 12000) - rms(dry, 12000)) > 0.001);
  for (const auto sample : processed) assert(std::isfinite(sample));

  p.output = 0.0;
  const auto muted = render(dry, p);
  assert(rms(muted, 12000) < 1e-14);

  p.output = 200.0;
  const auto boosted = render(dry, p);
  assert(rms(boosted, 12000) > rms(processed, 12000));

  // The algorithm must have sample-continuous state, independent of blocks.
  p.output = 100.0;
  assert(render(dry, p, 1) == render(dry, p, 128));
  assert(render(dry, p, 256) == render(dry, p, 128));

  vttrig::MonoChain chain;
  chain.append(vttrig::Stage{"c1", "compressor", true,
                             std::make_unique<vttrig::ButterComp2MonoProcessor>(p)});
  chain.append(vttrig::Stage{"c2", "compressor", false,
                             std::make_unique<vttrig::ButterComp2MonoProcessor>(p)});
  vttrig::Sample in[4]{0.4, -0.4, 0.0, 0.6}, out[4]{};
  assert(chain.set_enabled("c1", false));
  chain.process(in, out, 4);
  for (int i = 0; i < 4; ++i) assert(in[i] == out[i]);
  assert(chain.set_enabled("c1", true));
  chain.process(in, out, 4);
  for (double v : out) assert(std::isfinite(v));

  const std::vector<vttrig::Sample> silence(48000, 0.0);
  for (double v : render(silence, p)) assert(v == 0.0);

  return 0;
}
