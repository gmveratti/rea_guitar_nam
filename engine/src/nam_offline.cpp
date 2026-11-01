// Portable, offline NAM/IR processor for Linux and Windows (no audio device).
// This is NOT a realtime host and is not connected to the Tauri interface.
#include "nam_processing.hpp"
#include "wav_mono.hpp"

#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
void usage() {
  std::cout
      << "VTTRIG offline NAM/IR processor (Linux + Windows, experimental)\n"
      << "  vttrig-nam-offline --chain-json ordered.json --input dry.wav --output wet.wav [--tail-ms 0..30000]\n"
      << "  vttrig-nam-offline --passthrough --input dry.wav --output copy.wav\n"
      << "  vttrig-nam-offline --validate-chain-json ordered.json\n"
      << "48 kHz, MONO, PCM16 or float32 WAV input; float32 WAV output.\n"
      << "Default length equals input. --tail-ms adds silence for effects (max 30s).\n"
      << "NAM/IR ordering exactly follows schemaVersion 1. No audio device,\n"
      << "MIDI, effect pedals, parameter DSP mapping or live Tauri bridge yet.\n";
}
}  // namespace

int main(int argc, char* argv[]) {
  if (argc == 2 && std::string(argv[1]) == "--help") {
    usage();
    return 0;
  }
  try {
    std::filesystem::path manifest, input, output;
    bool passthrough = false, validate = false, tail_specified = false;
    std::size_t tail_frames = 0;
    for (int i = 1; i < argc; ++i) {
      const std::string arg(argv[i]);
      if (arg == "--passthrough") {
        if (passthrough) throw std::invalid_argument("Duplicate --passthrough");
        passthrough = true;
      } else if (arg == "--validate-chain-json") {
        if (validate || !manifest.empty()) throw std::invalid_argument("Duplicate chain selector");
        validate = true;
        if (++i >= argc) throw std::invalid_argument("Missing manifest path");
        manifest = argv[i];
      } else if (arg == "--tail-ms") {
        if (tail_specified) throw std::invalid_argument("Duplicate --tail-ms");
        tail_specified = true;
        if (++i >= argc) throw std::invalid_argument("Missing milliseconds for --tail-ms");
        const std::string value(argv[i]);
        if (value.empty() || value.find_first_not_of("0123456789") != std::string::npos) {
          throw std::invalid_argument("--tail-ms requires an integer 0..30000");
        }
        const auto millis = std::stoull(value);
        if (millis > 30000) throw std::invalid_argument("--tail-ms must not exceed 30000");
        tail_frames = static_cast<std::size_t>(millis) * (vttrig::kWavSampleRate / 1000);
      } else if (arg == "--chain-json" || arg == "--input" || arg == "--output") {
        if (++i >= argc) throw std::invalid_argument("Missing path for " + arg);
        if (arg == "--chain-json") {
          if (!manifest.empty()) throw std::invalid_argument("Duplicate --chain-json");
          manifest = argv[i];
        } else if (arg == "--input") {
          if (!input.empty()) throw std::invalid_argument("Duplicate --input");
          input = argv[i];
        } else {
          if (!output.empty()) throw std::invalid_argument("Duplicate --output");
          output = argv[i];
        }
      } else {
        throw std::invalid_argument("Unknown option: " + arg);
      }
    }
    if (validate) {
      if (passthrough || tail_specified || !input.empty() || !output.empty()) {
        throw std::invalid_argument("--validate-chain-json cannot render audio");
      }
      const auto nodes = vttrig::load_chain_file(manifest);
      std::cout << "Validated " << nodes.size() << " ordered NAM/IR nodes.\n";
      return 0;
    }
    if (input.empty() || output.empty() || (manifest.empty() == !passthrough) ||
        (passthrough && tail_specified)) {
      throw std::invalid_argument(
          "Provide --input and --output plus exactly one --chain-json or --passthrough");
    }
    if (std::filesystem::absolute(input).lexically_normal() ==
        std::filesystem::absolute(output).lexically_normal()) {
      throw std::invalid_argument("Input and output paths must differ");
    }

    // All file I/O and model construction take place outside any realtime callback.
    const auto dry = vttrig::read_mono_wav(input);
    vttrig::MonoChain chain;
    if (!passthrough) {
      const auto nodes = vttrig::load_chain_file(manifest);
      chain = vttrig::prepare_chain(nodes);
    }
    const auto wet = vttrig::render_offline(chain, dry, 128, tail_frames);
    vttrig::write_mono_float_wav(output, wet);
    std::cout << "Wrote " << wet.size() << " mono frames (48 kHz) to "
              << output.string() << (passthrough ? " [diagnostic passthrough]" : " [NAM/IR]")
              << "\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "VTTRIG offline engine error: " << error.what() << "\n";
    return 1;
  }
}
