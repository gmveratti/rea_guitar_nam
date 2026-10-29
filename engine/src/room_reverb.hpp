#pragma once

// VTTREVERB Room: original mono Schroeder-style parallel-comb/allpass reverb.
// NOT CloudSeedCore or Dragonfly DSP. The present graph supports mono/48 kHz.
// All delay memory is reserved in the constructor, off the audio callback.
// process() has no allocation, locks, logging, I/O or exceptions.

#include "effect_chain.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <vector>

namespace vttrig {

struct RoomReverbParams {
  double size = 67.0;   // 0..100 %, controls path lengths/room impression
  double decay = 4.2;   // 0.2..15 s, approximate RT60 (60 dB)
  double mix = 24.0;    // 0..100 %, linear dry/wet
};

class RoomReverbMonoProcessor final : public MonoProcessor {
 public:
  explicit RoomReverbMonoProcessor(const RoomReverbParams& p = {},
                                   double sample_rate = 48000.0)
      : wet_(std::clamp(p.mix / 100.0, 0.0, 1.0)) {
    const double scale = sample_rate / 1000.0;
    const double room = 0.65 + 0.70 * std::clamp(p.size / 100.0, 0.0, 1.0);
    const double rt60 = std::clamp(p.decay, 0.2, 15.0);
    // Incommensurate lengths reduce obvious repeating/metallic modes.
    constexpr std::array<double, 4> kCombMs{29.7, 34.9, 41.1, 47.3};
    for (std::size_t i = 0; i < combs_.size(); ++i) {
      const auto samples =
          std::max<std::size_t>(1, static_cast<std::size_t>(
              std::llround(kCombMs[i] * room * scale)));
      combs_[i].line.assign(samples, 0.0);
      // Per-loop attenuation that makes 60 dB decay approximately RT60.
      combs_[i].gain = std::pow(10.0,
          -3.0 * static_cast<double>(samples) / (sample_rate * rt60));
    }

    constexpr std::array<double, 2> kDiffusionMs{5.1, 7.7};
    for (std::size_t i = 0; i < allpasses_.size(); ++i) {
      const auto samples =
          std::max<std::size_t>(1, static_cast<std::size_t>(
              std::llround(kDiffusionMs[i] * room * scale)));
      allpasses_[i].line.assign(samples, 0.0);
    }
  }

  void process(Sample* input, Sample* output, int frames) noexcept override {
    if (wet_ == 0.0) {
      std::copy_n(input, frames, output);
      return;
    }
    for (int i = 0; i < frames; ++i) {
      const double dry = input[i];
      // Parallel damped feedback combs, with one sample of shared input.
      double reflections = 0.0;
      for (auto& comb : combs_) {
        const double delayed = comb.line[comb.head];
        // Damping inside the recirculation network attenuates high end.
        comb.filtered = 0.75 * delayed + 0.25 * comb.filtered;
        if (std::abs(comb.filtered) < 1.0e-22) comb.filtered = 0.0;
        comb.line[comb.head] = dry + comb.filtered * comb.gain;
        if (++comb.head == comb.line.size()) comb.head = 0;
        reflections += delayed;
      }
      // Series allpass diffusers thicken the late reverberant tail.
      double tail = reflections * 0.25;
      for (auto& ap : allpasses_) {
        const double stored = ap.line[ap.head];
        const double next = tail + 0.5 * stored;
        tail = stored - 0.5 * next;
        ap.line[ap.head] = next;
        if (++ap.head == ap.line.size()) ap.head = 0;
      }
      output[i] = dry * (1.0 - wet_) + tail * wet_;
    }
  }

 private:
  struct Comb {
    std::vector<Sample> line;
    std::size_t head = 0;
    double gain = 0.0;
    double filtered = 0.0;
  };
  struct Allpass {
    std::vector<Sample> line;
    std::size_t head = 0;
  };

  std::array<Comb, 4> combs_{};
  std::array<Allpass, 2> allpasses_{};
  double wet_ = 0.24;
};

} // namespace vttrig
