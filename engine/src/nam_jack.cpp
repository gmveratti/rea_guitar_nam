// VTTRIG experimental mono realtime engine, using the MIT NAM Core (Gateway).
// Inference order is 100% user-controlled: --nam and --ir may repeat in any order.
// The UI is not yet connected; the eventual backend will translate the pedalboard
// order into a new pre-prepared graph, swapped safely at an audio-block boundary.
#include "effect_chain.hpp"
#include "nam_processing.hpp"

#include <jack/jack.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <csignal>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {
constexpr jack_nframes_t kMaxFrames = static_cast<jack_nframes_t>(vttrig::kMaxFrames);
constexpr jack_nframes_t kRequiredSampleRate = 48000;
volatile std::sig_atomic_t stop_requested = 0;
void on_signal(int) { stop_requested = 1; }
void on_jack_shutdown(void*) { stop_requested = 1; }

using PlannedEffect = vttrig::ManifestEffect;

void usage() {
  std::cout
      << "VTTRIG flexible NAM/IR JACK engine (experimental)\n"
      << "Usage: vttrig-nam-jack [--nam MODEL.nam | --ir CABINET.wav] ... [--bypass]\n"
      << "       vttrig-nam-jack --chain-json ordered-chain.json\n"
      << "       vttrig-nam-jack --validate-chain-json ordered-chain.json\n"
      << "Blocks execute in EXACT command-line order. Repeat any kind or use --bypass\n"
      << "immediately after the block to disable that instance. Up to 24 stages.\n"
      << "Examples:\n"
      << "  vttrig-nam-jack --nam amp.nam --ir cab.wav\n"
      << "  vttrig-nam-jack --ir cab.wav --nam amp.nam --nam drive.nam\n"
      << "  vttrig-nam-jack --nam drive.nam --bypass --nam amp.nam\n"
      << "Requires JACK/PipeWire 48000 Hz; mono input/output only.\n"
      << "Controls/UI are not yet connected. Connect ports manually via qpwgraph.\n";
}

std::vector<PlannedEffect> parse_plan(int argc, char* argv[]) {
  std::vector<PlannedEffect> planned;
  for (int i = 1; i < argc; ++i) {
    const std::string arg(argv[i]);
    if (arg == "--bypass") {
      if (planned.empty() || !planned.back().enabled) {
        throw std::invalid_argument("--bypass must follow a currently enabled block");
      }
      planned.back().enabled = false;
      continue;
    }
    if (arg != "--nam" && arg != "--ir") {
      throw std::invalid_argument("Unknown option: " + arg);
    }
    if (++i >= argc) throw std::invalid_argument("Missing path after " + arg);
    const std::filesystem::path path(argv[i]);
    const auto extension = path.extension().string();
    const auto expected = arg == "--nam" ? ".nam" : ".wav";
    if (!std::filesystem::is_regular_file(path) || extension != expected) {
      throw std::invalid_argument("Expected an existing " + std::string(expected) + " file");
    }
    planned.push_back({"cli-" + std::to_string(planned.size() + 1),
                       arg == "--nam" ? "amp" : "cabinet", path, true});
    if (planned.size() > vttrig::kMaxStages) {
      throw std::invalid_argument("Too many blocks (max 24)");
    }
  }
  if (planned.empty()) throw std::invalid_argument("Add at least one --nam or --ir block");
  return planned;
}

struct Engine {
  vttrig::MonoChain chain;
  jack_port_t* input = nullptr;
  jack_port_t* output = nullptr;
  std::array<vttrig::Sample, vttrig::kMaxFrames> in_data{};
  std::array<vttrig::Sample, vttrig::kMaxFrames> out_data{};
  std::atomic<bool> oversized_callback{false};

  static int callback(jack_nframes_t nframes, void* user_data) noexcept {
    auto& engine = *static_cast<Engine*>(user_data);
    const auto* in = static_cast<const jack_default_audio_sample_t*>(
      jack_port_get_buffer(engine.input, nframes));
    auto* out = static_cast<jack_default_audio_sample_t*>(
      jack_port_get_buffer(engine.output, nframes));
    if (!out) return 0;
    if (!in || nframes > kMaxFrames) {
      std::fill_n(out, nframes, 0.0f);
      if (nframes > kMaxFrames) engine.oversized_callback.store(true, std::memory_order_relaxed);
      return 0;
    }

    for (jack_nframes_t i = 0; i < nframes; ++i) {
      engine.in_data[i] = static_cast<vttrig::Sample>(in[i]);
    }
    engine.chain.process(engine.in_data.data(), engine.out_data.data(),
                         static_cast<int>(nframes));
    for (jack_nframes_t i = 0; i < nframes; ++i) {
      const double sample = engine.out_data[i];
      out[i] = std::isfinite(sample)
          ? static_cast<float>(std::clamp(sample, -1.0, 1.0))
          : 0.0f;
    }
    return 0;
  }
};

class JackClient {
public:
  explicit JackClient(jack_client_t* client) : client_(client) {}
  ~JackClient() { if (client_) jack_client_close(client_); }
  JackClient(const JackClient&) = delete;
  JackClient& operator=(const JackClient&) = delete;
  jack_client_t* get() const { return client_; }
private:
  jack_client_t* client_;
};
}  // namespace

int main(int argc, char* argv[]) {
  if (argc == 2 && std::string(argv[1]) == "--help") {
    usage();
    return 0;
  }
  try {
    std::vector<PlannedEffect> planned;
    const bool chain_json = argc == 3 &&
      (std::string(argv[1]) == "--chain-json" ||
       std::string(argv[1]) == "--validate-chain-json");
    if (chain_json) {
      planned = vttrig::load_chain_file(argv[2]);
      if (std::string(argv[1]) == "--validate-chain-json") {
        std::cout << "Validated chain v1 with " << planned.size()
                  << " ordered nodes (files not opened; no audio started).\\n";
        return 0;
      }
    } else {
      planned = parse_plan(argc, argv);
    }
    // Prepared graph is immutable after activation.
    Engine engine;
    engine.chain = vttrig::prepare_chain(planned);

    jack_status_t status{};
    JackClient client(jack_client_open("VTTRIG_NAM", JackNoStartServer, &status));
    if (!client.get()) throw std::runtime_error("Unable to connect to PipeWire/JACK");
    if (jack_get_sample_rate(client.get()) != kRequiredSampleRate) {
      throw std::runtime_error("Set PipeWire/JACK to 48000 Hz first");
    }
    if (jack_get_buffer_size(client.get()) > kMaxFrames) {
      throw std::runtime_error("Host audio buffer is larger than 8192 frames");
    }

    engine.input = jack_port_register(client.get(), "input", JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
    engine.output = jack_port_register(client.get(), "output", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
    if (!engine.input || !engine.output) throw std::runtime_error("Failed to register JACK ports");
    if (jack_set_process_callback(client.get(), Engine::callback, &engine) != 0) {
      throw std::runtime_error("Failed to register JACK process callback");
    }
    jack_on_shutdown(client.get(), on_jack_shutdown, nullptr);
    std::signal(SIGINT, on_signal);
    std::signal(SIGTERM, on_signal);
    if (jack_activate(client.get()) != 0) throw std::runtime_error("JACK activation failed");

    std::cout << "VTTRIG ordered effects: ";
    for (const auto& stage : engine.chain.stages()) {
      std::cout << stage.id << "(" << stage.kind << (stage.enabled ? "" : " / BYPASS") << ") ";
    }
    std::cout << "\n48 kHz JACK active. Connect ports with qpwgraph. Ctrl+C exits.\n";

    while (!stop_requested) {
      if (engine.oversized_callback.load(std::memory_order_relaxed)) {
        std::cerr << "Audio buffer exceeds maximum; output was silenced.\n";
        break;
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    jack_deactivate(client.get());
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "VTTRIG engine error: " << error.what() << "\n";
    return 1;
  }
}
