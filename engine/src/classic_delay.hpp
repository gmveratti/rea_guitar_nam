#pragma once

// VTTDELAY Classic: original mono echo algorithm for the VTTRIG native graph.
// Tape-inspired damping of repeats, NOT a port or clone of Airwindows TapeDelay2.
// The latter's tape-speed control does not map to the pedal's millisecond Time.
// A future distinct Tape mode can implement the full MIT TapeDelay2 algorithm.
//
// Circular delay buffer is allocated once during graph preparation. The
// realtime process() path performs no allocation, locks, I/O or exceptions.

#include "effect_chain.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <vector>

namespace vttrig {

struct DelayParams {
  double time = 420.0;      // [40,1200] milliseconds
  double feedback = 38.0;   // [0,90] percent
  double mix = 28.0;        // [0,100] percent, crossfade
};

class ClassicDelayMonoProcessor final : public MonoProcessor {
 public:
  explicit ClassicDelayMonoProcessor(const DelayParams& p = {},
                                     double sample_rate = 48000.0)
      : feedback_(std::clamp(p.feedback / 100.0, 0.0, 0.9)),
        wet_(std::clamp(p.mix / 100.0, 0.0, 1.0)),
        // Delay time is integer sample accurate at the current 48 kHz rate.
        buffer_(std::max<std::size_t>(
            1, static_cast<std::size_t>(std::llround(
                   std::clamp(p.time, 40.0, 1200.0) *
                   sample_rate / 1000.0))),
                 0.0),
        // Softened repeats: ~4 kHz low-pass in the regeneration path.
        pole_(std::exp(-2.0 * 3.14159265358979323846 *
                       4000.0 / sample_rate)) {}

  void process(Sample* input, Sample* output, int frames) noexcept override {
    if (wet_ == 0.0) {
      // Exact passthrough. State need not advance while the effect is dry:
      // graph updates still require Stop/Start, which creates a fresh stage.
      std::copy_n(input, frames, output);
      return;
    }
    const double dry_gain = 1.0 - wet_;
    for (int i = 0; i < frames; ++i) {
      const double dry = input[i];
      const double echo = buffer_[head_];

      // Low-pass the feedback only, preserving the attack of first repeat.
      // Soft saturation keeps large regeneration values bounded.
      tone_state_ = pole_ * tone_state_ + (1.0 - pole_) * echo;
      // Kill near-silent filter state before it enters the denormal range.
      if (std::abs(tone_state_) < 1.0e-20) tone_state_ = 0.0;
      const double regenerated =
          std::tanh(tone_state_ * 1.2) / 1.2;
      buffer_[head_] = dry + feedback_ * regenerated;
      if (++head_ == buffer_.size()) head_ = 0;

      output[i] = dry * dry_gain + echo * wet_;
    }
  }

 private:
  double feedback_ = 0.38;
  double wet_ = 0.28;
  std::vector<Sample> buffer_;
  double pole_ = 0.0;
  double tone_state_ = 0.0;
  std::size_t head_ = 0;
};

} // namespace vttrig
