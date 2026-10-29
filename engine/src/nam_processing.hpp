#pragma once

#include "chain_manifest.hpp"
#include "effect_chain.hpp"
#include "noise_gate.hpp"
#include "butter_comp2.hpp"
#include "pressure_sustain.hpp"
#include "daisy_chorus.hpp"
#include "classic_delay.hpp"

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
// Native effect parameters are applied during graph preparation. NAM/IR gain and EQ
// controls remain visual-only; do not present them as mapped DSP controls.
inline MonoChain prepare_chain(const std::vector<ManifestEffect>& specs,
                               double sample_rate = 48000.0) {
  if (!std::isfinite(sample_rate) || sample_rate != 48000.0) {
    throw std::invalid_argument("NAM engine currently requires 48000 Hz");
  }
  MonoChain chain;
  for (const auto& spec : specs) {
    if (spec.kind == "gate") {
      NoiseGateParams p;
      if (const auto it = spec.parameters.find("threshold"); it != spec.parameters.end())
        p.threshold = it->second;
      if (const auto it = spec.parameters.find("release"); it != spec.parameters.end())
        p.release = it->second;
      if (const auto it = spec.parameters.find("hold"); it != spec.parameters.end())
        p.hold = it->second;
      if (const auto it = spec.parameters.find("range"); it != spec.parameters.end())
        p.range = it->second;
      chain.append(Stage{
          spec.id, spec.kind, spec.enabled,
          std::make_unique<NoiseGateMonoProcessor>(p, sample_rate)});
      continue;
    }
    if (spec.kind == "compressor") {
      ButterComp2Params p;
      if (const auto it = spec.parameters.find("compress"); it != spec.parameters.end())
        p.compress = it->second;
      if (const auto it = spec.parameters.find("output"); it != spec.parameters.end())
        p.output = it->second;
      if (const auto it = spec.parameters.find("mix"); it != spec.parameters.end())
        p.mix = it->second;
      chain.append(Stage{spec.id, spec.kind, spec.enabled,
                         std::make_unique<ButterComp2MonoProcessor>(p, sample_rate)});
      continue;
    }
    if (spec.kind == "sustain") {
      PressureSustainParams p;
      if (const auto it = spec.parameters.find("sustain"); it != spec.parameters.end())
        p.sustain = it->second;
      if (const auto it = spec.parameters.find("speed"); it != spec.parameters.end())
        p.speed = it->second;
      if (const auto it = spec.parameters.find("level"); it != spec.parameters.end())
        p.level = it->second;
      if (const auto it = spec.parameters.find("mix"); it != spec.parameters.end())
        p.mix = it->second;
      chain.append(Stage{spec.id, spec.kind, spec.enabled,
                         std::make_unique<PressureSustainMonoProcessor>(p, sample_rate)});
      continue;
    }
    if (spec.kind == "chorus") {
      ChorusParams p;
      if (const auto it = spec.parameters.find("rate"); it != spec.parameters.end())
        p.rate = it->second;
      if (const auto it = spec.parameters.find("depth"); it != spec.parameters.end())
        p.depth = it->second;
      if (const auto it = spec.parameters.find("mix"); it != spec.parameters.end())
        p.mix = it->second;
      chain.append(Stage{spec.id, spec.kind, spec.enabled,
                         std::make_unique<DaisyChorusMonoProcessor>(p, sample_rate)});
      continue;
    }
    if (spec.kind == "delay") {
      DelayParams p;
      if (const auto it = spec.parameters.find("time"); it != spec.parameters.end())
        p.time = it->second;
      if (const auto it = spec.parameters.find("feedback"); it != spec.parameters.end())
        p.feedback = it->second;
      if (const auto it = spec.parameters.find("mix"); it != spec.parameters.end())
        p.mix = it->second;
      chain.append(Stage{spec.id, spec.kind, spec.enabled,
                         std::make_unique<ClassicDelayMonoProcessor>(p, sample_rate)});
      continue;
    }
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
