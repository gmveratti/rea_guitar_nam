#pragma once

#include "chain_manifest.hpp"
#include "effect_chain.hpp"

#include <NAM/dsp.h>
#include <NAM/get_dsp.h>

#include <cmath>
#include <filesystem>
#include <fstream>
#include <memory>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

namespace vttrig {

// Common, device-independent NAM/IR adapter shared by the Linux JACK
// host and Windows/Linux offline renderer. Loading and Reset happen BEFORE
// entering any audio callback. This header does not depend on JACK, WASAPI,
// Tauri or the graphical interface.
class NamMonoProcessor final : public MonoProcessor {
 public:
  explicit NamMonoProcessor(std::unique_ptr<nam::DSP> model)
      : model_(std::move(model)) {}

  void process(Sample* input, Sample* output, int frames) noexcept override {
    static_assert(std::is_same_v<Sample, NAM_SAMPLE>,
                  "The VTTRIG graph sample type must match NAM_SAMPLE");
    NAM_SAMPLE* inputs[] = {input};
    NAM_SAMPLE* outputs[] = {output};
    model_->process(inputs, outputs, frames);
  }

 private:
  std::unique_ptr<nam::DSP> model_;
};

inline std::vector<ManifestEffect> load_chain_file(
    const std::filesystem::path& path) {
  if (!std::filesystem::is_regular_file(path) ||
      std::filesystem::file_size(path) > 256 * 1024) {
    throw std::invalid_argument(
        "Chain JSON must be an existing file of at most 256 KiB");
  }
  std::ifstream input(path);
  if (!input) throw std::runtime_error("Unable to read chain JSON");
  return parse_chain_manifest(input);
}

// No host-specific types or thread operations here. The stages remain in the
// exact source order, including duplicate kinds and bypassed instances.
// Parameters in the JSON are validated by the manifest parser but are not
// mapped to DSP controls yet. Do not present this as gain/EQ automation.
inline MonoChain prepare_chain(const std::vector<ManifestEffect>& specs,
                               double sample_rate = 48000.0) {
  if (!std::isfinite(sample_rate) || sample_rate != 48000.0) {
    throw std::invalid_argument("NAM engine currently requires 48000 Hz");
  }
  MonoChain chain;
  for (const auto& spec : specs) {
    auto model = nam::get_dsp(spec.path);
    if (!model) {
      throw std::runtime_error("Failed to load effect: " + spec.path.string());
    }
    if (model->NumInputChannels() != 1 || model->NumOutputChannels() != 1) {
      throw std::runtime_error("Only mono .nam/IR are supported: " +
                               spec.path.string());
    }
    const double expected_rate = model->GetExpectedSampleRate();
    if (spec.kind != "cabinet" && expected_rate > 0.0 &&
        std::abs(expected_rate - sample_rate) > 1.0) {
      throw std::runtime_error(
          "Resampling neural models is not yet supported: " +
          spec.path.string());
    }
    // Resampling IRs (when supported by NAM Core) is prepared here,
    // never inside the JACK realtime callback.
    model->Reset(sample_rate, static_cast<int>(kMaxFrames));
    chain.append(Stage{
        spec.id,
        spec.kind,
        spec.enabled,
        std::make_unique<NamMonoProcessor>(std::move(model)),
    });
  }
  return chain;
}

}  // namespace vttrig
