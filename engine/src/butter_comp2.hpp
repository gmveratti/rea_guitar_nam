#pragma once

// VTT Compressor Smooth: mono/float64 adaptation of Airwindows ButterComp2.
// Source (MIT): https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/ButterComp2/ButterComp2Proc.cpp
// Copyright (c) 2016 Airwindows / Chris Johnson. Attribution and MIT license:
// engine/THIRD_PARTY_NOTICES.md
//
// Preserves the original bipolar/interleaved smoothing algorithm and its
// exact Compress, Output and Dry/Wet mapping. Excludes VST2 host code, stereo
// duplication, and output dither (unnecessary in VTTRIG's float64 graph).
// There is no JUCE/VST dependency, no lookahead and no callback allocation.

#include "effect_chain.hpp"

#include <algorithm>
#include <cmath>

namespace vttrig {

struct ButterComp2Params {
  double compress = 35.0;  // 0..100%, original normalized A
  double output = 100.0;   // 0..200%, original B * 2
  double mix = 100.0;      // 0..100%, original C
};

class ButterComp2MonoProcessor final : public MonoProcessor {
 public:
  explicit ButterComp2MonoProcessor(
      const ButterComp2Params& p = {}, double sample_rate = 48000.0)
      : input_gain_(std::pow(10.0, (std::clamp(p.compress / 100.0, 0.0, 1.0)
                                    * 14.0) / 20.0)),
        comp_factor_(0.012 * (std::clamp(p.compress / 100.0, 0.0, 1.0) / 135.0)
                     / (sample_rate / 44100.0)),
        output_trim_(std::clamp(p.output / 100.0, 0.0, 2.0)),
        wet_(std::clamp(p.mix / 100.0, 0.0, 1.0)),
        output_gain_((input_gain_ - 1.0) / 1.5 + 1.0) {}

  void process(Sample* input, Sample* output, int frames) noexcept override {
    for (int i = 0; i < frames; ++i) {
      const double dry = input[i];
      const double driven = dry * input_gain_;

      // Program-dependent recovery: loud output slows the next response.
      const double remainder = comp_factor_ / (1.0 + std::abs(last_output_));
      const double divisor = 1.0 - remainder;

      double positive = std::max(driven + 1.0, 0.0);
      const double positive_mix = std::min(positive * 0.5, 1.0);
      positive *= positive;
      target_positive_ = target_positive_ * divisor + positive * remainder;
      const double positive_gain = 1.0 / (target_positive_ * target_positive_);

      double negative = std::max(1.0 - driven, 0.0);
      const double negative_mix = std::min(negative * 0.5, 1.0);
      negative *= negative;
      target_negative_ = target_negative_ * divisor + negative * remainder;
      const double negative_gain = 1.0 / (target_negative_ * target_negative_);

      // The Airwindows bipolar detector alternates A/B controls per
      // sample, and independently tracks positive/negative half cycles.
      auto& bank = flip_ ? controls_a_ : controls_b_;
      if (driven > 0.0) {
        bank.positive = bank.positive * divisor + positive_gain * remainder;
      } else {
        bank.negative = bank.negative * divisor + negative_gain * remainder;
      }
      const double multiplier =
          bank.positive * positive_mix + bank.negative * negative_mix;
      const double compressed = (driven * multiplier / output_gain_) * output_trim_;
      const double result = compressed * wet_ + dry * (1.0 - wet_);
      output[i] = result;
      last_output_ = result;
      flip_ = !flip_;
    }
  }

 private:
  struct Controls { double positive = 1.0, negative = 1.0; };
  double input_gain_, comp_factor_, output_trim_, wet_, output_gain_;
  double target_positive_ = 1.0, target_negative_ = 1.0;
  Controls controls_a_, controls_b_;
  double last_output_ = 0.0;
  bool flip_ = false;
};

}  // namespace vttrig
