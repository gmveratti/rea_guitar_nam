#pragma once

// VTTGATE: portable mono adaptation of TONE3000 Plugin's NoiseGate.h.
// Source: https://github.com/tone-3000/tone3000-plugin/blob/main/plugin/include/NoiseGate.h
// Original copyright (c) 2026 TONE3000; MIT License.
// See engine/THIRD_PARTY_NOTICES.md. JUCE types were replaced with the
// VTTRIG MonoProcessor contract; there is no JUCE runtime dependency.
// The signal algorithm (band-limited detector, envelope, 5 dB hysteresis,
// hold, cubic downward expansion and smooth close) follows the original.

#include "effect_chain.hpp"

#include <algorithm>
#include <cmath>
#include <numbers>

namespace vttrig {

struct NoiseGateParams {
  double threshold = -80.0;  // dBFS, [-100, 0]
  double release = 50.0;     // ms, [5, 500]
  double hold = 20.0;        // ms, [0, 200]
  double range = 80.0;       // attenuation dB, [20, 80]
};

class NoiseGateMonoProcessor final : public MonoProcessor {
 public:
  explicit NoiseGateMonoProcessor(const NoiseGateParams& p = {},
                                  double sample_rate = 48000.0)
      : sample_rate_(sample_rate) {
    // No heap allocation, file access or synchronization in the audio path.
    const auto one_pole = [sample_rate](double milliseconds) {
      return milliseconds <= 0.0
                 ? 1.0
                 : 1.0 - std::exp(-1.0 / (0.001 * milliseconds * sample_rate));
    };
    envelope_rise_ = one_pole(0.2);
    envelope_fall_ = one_pole(25.0);
    attack_ = one_pole(0.2);
    release_ = one_pole(p.release);
    hold_samples_ = static_cast<int>(p.hold * 0.001 * sample_rate);

    // 80 Hz two-pole high-pass (TPT SVF) + 5 kHz one-pole low-pass.
    // Filters affect the detector only, not the guitar signal itself.
    const double g = std::tan(std::numbers::pi * 80.0 / sample_rate);
    svf_k_ = std::numbers::sqrt2;
    svf_a1_ = 1.0 / (1.0 + g * (g + svf_k_));
    svf_a2_ = g * svf_a1_;
    svf_a3_ = g * svf_a2_;
    lowpass_coeff_ = 1.0 - std::exp(-2.0 * std::numbers::pi * 5000.0 / sample_rate);

    open_threshold_ = std::pow(10.0, p.threshold / 20.0);
    close_threshold_ = std::pow(10.0, (p.threshold - 5.0) / 20.0);
    inv_open_threshold_ = 1.0 / open_threshold_;
    floor_gain_ = std::pow(10.0, -p.range / 20.0);
  }

  void process(Sample* input, Sample* output, int frames) noexcept override {
    for (int i = 0; i < frames; ++i) {
      const double x = input[i];

      // Band-passed sidechain detects notes without being held open by hum/hiss.
      const double v3 = x - svf_ic2_;
      const double v1 = svf_a1_ * svf_ic1_ + svf_a2_ * v3;
      const double v2 = svf_ic2_ + svf_a2_ * svf_ic1_ + svf_a3_ * v3;
      svf_ic1_ = 2.0 * v1 - svf_ic1_;
      svf_ic2_ = 2.0 * v2 - svf_ic2_;
      const double highpassed = x - svf_k_ * v1 - v2;
      lowpass_state_ += lowpass_coeff_ * (highpassed - lowpass_state_);

      const double rectified = std::abs(lowpass_state_);
      envelope_ += (rectified > envelope_ ? envelope_rise_ : envelope_fall_) *
                   (rectified - envelope_);

      switch (state_) {
        case State::closed:
          if (envelope_ >= open_threshold_) state_ = State::open;
          break;
        case State::open:
          if (envelope_ < close_threshold_) {
            state_ = State::holding;
            hold_remaining_ = hold_samples_;
          }
          break;
        case State::holding:
          if (envelope_ >= close_threshold_) {
            state_ = State::open;
          } else if (--hold_remaining_ <= 0) {
            state_ = State::closed;
          }
          break;
      }

      double target_gain = 1.0;
      if (state_ == State::closed) {
        const double ratio = std::clamp(envelope_ * inv_open_threshold_, 0.0, 1.0);
        target_gain = std::max(ratio * ratio * ratio, floor_gain_);
      }
      gain_ += (target_gain > gain_ ? attack_ : release_) * (target_gain - gain_);
      output[i] = x * gain_;
    }
  }

 private:
  enum class State { closed, open, holding };
  double sample_rate_;
  double envelope_rise_ = 0.0, envelope_fall_ = 0.0;
  double attack_ = 0.0, release_ = 0.0;
  int hold_samples_ = 0, hold_remaining_ = 0;
  double svf_k_ = 0.0, svf_a1_ = 0.0, svf_a2_ = 0.0, svf_a3_ = 0.0;
  double svf_ic1_ = 0.0, svf_ic2_ = 0.0;
  double lowpass_coeff_ = 0.0, lowpass_state_ = 0.0;
  double open_threshold_ = 0.0, close_threshold_ = 0.0;
  double inv_open_threshold_ = 0.0, floor_gain_ = 0.0;
  double envelope_ = 0.0, gain_ = 0.0;
  State state_ = State::closed;
};

}  // namespace vttrig
