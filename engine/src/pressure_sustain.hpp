#pragma once

// VTTSUSTAIN: mono adaptation of the dynamics section of Airwindows Pressure5.
// Upstream: https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Pressure5/Pressure5Proc.cpp
// Copyright (c) 2016 Airwindows / Chris Johnson, MIT. See THIRD_PARTY_NOTICES.md.
//
// Retains Pressure5's interleaved mu A/B envelope, program-dependent speed,
// threshold/makeup mapping and Mewiness at upstream defaults C=1, D=0.5.
// The 24 kHz anti-ultrasonic filters are bypassed at 48 kHz in upstream too.
// VST2, 32-bit dithering, stereo duplication, and ClipOnly2's sample delay
// are intentionally omitted. A zero-latency soft ceiling is used instead.
// This is an adaptation, not a bit-exact copy of the full Pressure5 plugin.

#include "effect_chain.hpp"

#include <algorithm>
#include <cmath>

namespace vttrig {

struct PressureSustainParams {
  double sustain = 65.0;  // Pressure5 'Pressure' A: [0,100] %
  double speed = 25.0;    // Pressure5 'Speed' B: [0,100] %, non-linear
  double level = 0.0;     // Post-dynamics trim: [-18,+18] dB
  double mix = 100.0;     // Pressure5 Dry/Wet F: [0,100] %
};

class PressureSustainMonoProcessor final : public MonoProcessor {
 public:
  explicit PressureSustainMonoProcessor(const PressureSustainParams& p = {},
                                        double sample_rate = 48000.0) {
    const double a = std::clamp(p.sustain / 100.0, 0.0, 1.0);
    const double b = std::clamp(p.speed / 100.0, 0.0, 1.0);
    const double threshold = 1.0 - (a * 0.95);
    threshold_ = threshold;
    makeup_gain_ = 1.0 / threshold;
    const double scale = sample_rate / 44100.0;
    const double original_release = std::pow(1.28 - b, 5.0) * 32768.0;
    release_ = original_release / scale;
    fastest_ = std::sqrt(original_release) / scale;
    level_gain_ = std::pow(10.0, std::clamp(p.level, -18.0, 18.0) / 20.0);
    wet_ = std::clamp(p.mix / 100.0, 0.0, 1.0);
    // Upstream defaults C=1.0 (Mewiness) and D=0.5 (PawClaw).
    // D=0.5 sets pawsClaws to zero so Mewiness is sin(1), fixed.
    constexpr double kOriginalMewiness = 0.84147098480789650665;
    mewiness_ = kOriginalMewiness;
  }

  void process(Sample* input, Sample* output, int frames) noexcept override {
    // An explicitly dry setting is an exact passthrough, including transients
    // above unity; no dynamics or safety limiter should touch that signal.
    if (wet_ == 0.0) {
      std::copy_n(input, frames, output);
      return;
    }
    for (int i = 0; i < frames; ++i) {
      const double dry = input[i];
      const double driven = dry * makeup_gain_;
      const double sense = std::abs(driven);
      auto& state = flip_ ? a_ : b_;

      if (sense > threshold_) {
        const double vary = threshold_ / sense;
        const double attack = std::sqrt(state.speed);
        state.coefficient =
            (state.coefficient * (attack - 1.0) + std::max(vary, threshold_)) / attack;
      } else {
        const double speed_sq = state.speed * state.speed;
        state.coefficient =
            (state.coefficient * (speed_sq - 1.0) + 1.0) / speed_sq;
      }
      state.speed = (state.speed * (state.speed - 1.0) +
                     std::abs(sense * release_) + fastest_) / state.speed;

      // Positive-Mewiness branch of Pressure5's native mu compression.
      const double mu = state.coefficient;
      const double coefficient =
          (mu * mu) * mewiness_ + mu * (1.0 - mewiness_);
      const double compressed = driven * coefficient * level_gain_;
      // Keep Dry/Wet before the peak protection as in original Pressure5.
      const double mixed = compressed * wet_ + dry * (1.0 - wet_);
      output[i] = soft_ceiling(mixed);
      flip_ = !flip_;
    }
  }

 private:
  struct MuState {
    double speed = 10000.0;
    double coefficient = 1.0;
  };

  static double soft_ceiling(double sample) noexcept {
    // Unity below -0.9/+0.9, smoothly approaches +/-1 at extreme settings.
    // Continuous slope at the knee, avoids sudden hard clip corners.
    const double magnitude = std::abs(sample);
    if (magnitude <= 0.9) return sample;
    const double capped = 1.0 - 0.1 * std::exp(-(magnitude - 0.9) * 10.0);
    return std::copysign(capped, sample);
  }

  MuState a_, b_;
  double threshold_ = 1.0;
  double makeup_gain_ = 1.0;
  double release_ = 0.0;
  double fastest_ = 0.0;
  double level_gain_ = 1.0;
  double wet_ = 1.0;
  double mewiness_ = 0.0;
  bool flip_ = false;
};

}  // namespace vttrig
