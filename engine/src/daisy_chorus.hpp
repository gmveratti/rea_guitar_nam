#pragma once

// VTTCHORUS: mono guitar adaptation of DaisySP ChorusEngine.
// Original: https://github.com/daisyaudio/DaisySP/blob/master/Source/Effects/chorus.cpp
// Copyright (c) 2020 Electrosmith, Corp. MIT, see THIRD_PARTY_NOTICES.md.
//
// Two independent modulated delay lines with linear fractional reads,
// triangle LFOs and constant 20% feedback. DaisySP's stereo panning
// wrapper is not ported: the VTTRIG host currently supplies mono only.
// No heap allocation, locks, I/O or file access inside process().

#include "effect_chain.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>

namespace vttrig {

struct ChorusParams {
  double rate = 1.2;   // Hz: [0.1, 8.0]
  double depth = 48.0; // Percent: [0, 100]
  double mix = 30.0;   // Wet percent: [0, 100]
};

class DaisyChorusMonoProcessor final : public MonoProcessor {
 public:
  explicit DaisyChorusMonoProcessor(const ChorusParams& p = {},
                                    double sample_rate = 48000.0)
      : wet_(std::clamp(p.mix / 100.0, 0.0, 1.0)) {
    // The real-time host currently fixes the engine sample rate to 48 kHz.
    // At other rates, keep the delay within this fixed-size buffer too.
    const double base_samples = 6.025 * 0.001 * sample_rate;
    const double max_samples = (static_cast<double>(kDelayLength) - 2.0) / 1.93;
    const double base = std::clamp(base_samples, 1.0, max_samples);
    const double modulation = std::clamp(p.depth / 100.0, 0.0, 1.0) * 0.93 * base;
    const double increment = 4.0 * std::clamp(p.rate, 0.1, 8.0) / sample_rate;
    voices_[0].configure(base, modulation, increment, 0.0, 1.0);
    voices_[1].configure(base, modulation, increment, 1.0, -1.0);
  }

  void process(Sample* input, Sample* output, int frames) noexcept override {
    for (int i = 0; i < frames; ++i) {
      const Sample dry = input[i];
      const double wet = 0.5 * (voices_[0].process(dry) + voices_[1].process(dry));
      output[i] = dry * (1.0 - wet_) + wet * wet_;
    }
  }

 private:
  // 50 ms at 48 kHz plus two fractional interpolation slots.
  static constexpr std::size_t kDelayLength = 2402;
  static constexpr double kFeedback = 0.2; // DaisySP ChorusEngine default

  class Voice {
   public:
    void configure(double base, double amount, double phase_increment,
                   double phase, double direction) noexcept {
      base_ = base;
      amount_ = amount;
      increment_ = phase_increment * direction;
      phase_ = phase;
    }

    double process(double input) noexcept {
      // DaisySP triangle LFO: wave traverses [-1,+1], reversing at ends.
      phase_ += increment_;
      if (phase_ > 1.0) {
        phase_ = 2.0 - phase_;
        increment_ = -increment_;
      } else if (phase_ < -1.0) {
        phase_ = -2.0 - phase_;
        increment_ = -increment_;
      }

      const double delay = std::clamp(base_ + phase_ * amount_, 1.0,
                                      static_cast<double>(kDelayLength - 2));
      const std::size_t whole = static_cast<std::size_t>(delay);
      const double fraction = delay - static_cast<double>(whole);
      // Read before writing, matching DaisySP DelayLine's descending pointer.
      const double a = ring_[(write_ + whole) % kDelayLength];
      const double b = ring_[(write_ + whole + 1) % kDelayLength];
      const double delayed = a + (b - a) * fraction;
      ring_[write_] = input + kFeedback * delayed;
      write_ = (write_ + kDelayLength - 1) % kDelayLength;
      return delayed;
    }

   private:
    std::array<Sample, kDelayLength> ring_{};
    std::size_t write_ = 0;
    double base_ = 288.0;
    double amount_ = 0.0;
    double increment_ = 0.0;
    double phase_ = 0.0;
  };

  std::array<Voice, 2> voices_{};
  double wet_ = 0.3;
};

} // namespace vttrig
