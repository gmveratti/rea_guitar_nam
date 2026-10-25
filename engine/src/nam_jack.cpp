// VTTRIG NAM JACK: standalone mono proof-of-concept for Fedora/PipeWire.
// NAM inference is provided by Steven Atkinson's MIT-licensed NeuralAmpModelerCore.
// The audio callback does not allocate, log, lock or load files.
// This executable does not integrate into Tauri yet and does not host VTT pedals.
#include <jack/jack.h>

#include <NAM/get_dsp.h>
#include <NAM/dsp.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <csignal>
#include <filesystem>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <thread>

namespace {
constexpr jack_nframes_t kMaxFrames = 8192;
constexpr jack_nframes_t kRequiredSampleRate = 48000;
volatile std::sig_atomic_t stop_requested = 0;

void on_signal(int) { stop_requested = 1; }

struct Engine {
  std::unique_ptr<nam::DSP> model;
  jack_port_t* input = nullptr;
  jack_port_t* output = nullptr;
  std::array<NAM_SAMPLE, kMaxFrames> in_data{};
  std::array<NAM_SAMPLE, kMaxFrames> out_data{};
  std::atomic<bool> oversized_callback{false};

  static int callback(jack_nframes_t nframes, void* user_data) noexcept {
    auto& engine = *static_cast<Engine*>(user_data);
    auto* input = static_cast<const jack_default_audio_sample_t*>(
        jack_port_get_buffer(engine.input, nframes));
    auto* output = static_cast<jack_default_audio_sample_t*>(
        jack_port_get_buffer(engine.output, nframes));
    if (!output) return 0;
    if (!input || nframes > kMaxFrames || !engine.model) {
      std::fill_n(output, nframes, 0.0f);
      if (nframes > kMaxFrames) {
        engine.oversized_callback.store(true, std::memory_order_relaxed);
      }
      return 0;
    }

    for (jack_nframes_t i = 0; i < nframes; ++i) {
      engine.in_data[i] = static_cast<NAM_SAMPLE>(input[i]);
    }
    NAM_SAMPLE* ins[] = { engine.in_data.data() };
    NAM_SAMPLE* outs[] = { engine.out_data.data() };
    // The NAM model must be fully initialized before jack_activate().
    engine.model->process(ins, outs, static_cast<int>(nframes));

    for (jack_nframes_t i = 0; i < nframes; ++i) {
      const double sample = static_cast<double>(engine.out_data[i]);
      // Avoid propagating NaNs/infinities or unsafe output levels.
      output[i] = std::isfinite(sample)
          ? static_cast<float>(std::clamp(sample, -1.0, 1.0))
          : 0.0f;
    }
    return 0;
  }
};

void on_jack_shutdown(void*) { stop_requested = 1; }

void usage() {
  std::cout
    << "VTTRIG NAM JACK engine (experimental)\n"
    << "Usage: vttrig-nam-jack /path/to/model.nam\n"
    << "Connect your guitar input and playback using qjackctl/qpwgraph.\n"
    << "Requires a JACK/PipeWire server running at 48000 Hz.\n"
    << "MONO ONLY: no IR, chorus, delay, reverb or UI controls yet.\n";
}

class JackClient {
public:
  explicit JackClient(jack_client_t* client): client_(client) {}
  ~JackClient() { if (client_) jack_client_close(client_); }
  JackClient(const JackClient&) = delete;
  JackClient& operator=(const JackClient&) = delete;
  jack_client_t* get() const { return client_; }
private:
  jack_client_t* client_;
};

} // namespace

int main(int argc, char* argv[]) {
  if (argc == 2 && std::string(argv[1]) == "--help") {
    usage();
    return 0;
  }
  if (argc != 2 || !std::filesystem::is_regular_file(argv[1])
      || std::filesystem::path(argv[1]).extension() != ".nam") {
    usage();
    std::cerr << "Error: provide an existing .nam file.\n";
    return 2;
  }

  try {
    // All file I/O, model creation and memory allocation happen before JACK activation.
    Engine engine;
    engine.model = nam::get_dsp(std::filesystem::path(argv[1]));
    if (!engine.model) throw std::runtime_error("NAM core failed to load model");
    if (engine.model->NumInputChannels() != 1 || engine.model->NumOutputChannels() != 1) {
      throw std::runtime_error("This first engine supports mono-input/mono-output NAM models only");
    }
    const double trained_rate = engine.model->GetExpectedSampleRate();
    if (trained_rate > 0.0 && std::abs(trained_rate - kRequiredSampleRate) > 1.0) {
      throw std::runtime_error("Model sample rate is not 48000 Hz; resampling not yet implemented");
    }

    jack_status_t status{};
    JackClient client(jack_client_open("VTTRIG_NAM", JackNoStartServer, &status));
    if (!client.get()) throw std::runtime_error("Unable to connect to PipeWire/JACK");
    if (jack_get_sample_rate(client.get()) != kRequiredSampleRate) {
      throw std::runtime_error("Set the PipeWire/JACK engine to 48000 Hz before launching VTTRIG");
    }
    if (jack_get_buffer_size(client.get()) > kMaxFrames) {
      throw std::runtime_error("Host buffer exceeds the supported maximum of 8192 frames");
    }

    // Reset/prewarm may allocate: perform strictly before jack_activate().
    engine.model->Reset(kRequiredSampleRate, static_cast<int>(kMaxFrames));

    engine.input = jack_port_register(client.get(), "input",
      JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
    engine.output = jack_port_register(client.get(), "output",
      JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
    if (!engine.input || !engine.output) {
      throw std::runtime_error("Unable to register JACK input/output ports");
    }
    if (jack_set_process_callback(client.get(), Engine::callback, &engine) != 0) {
      throw std::runtime_error("Unable to register JACK processing callback");
    }
    jack_on_shutdown(client.get(), on_jack_shutdown, nullptr);
    std::signal(SIGINT, on_signal);
    std::signal(SIGTERM, on_signal);

    if (jack_activate(client.get()) != 0) {
      throw std::runtime_error("Unable to activate JACK audio");
    }
    std::cout << "VTTRIG NAM running at 48000 Hz.\n"
              << "Connect system capture -> VTTRIG_NAM:input -> playback in qpwgraph.\n"
              << "Press Ctrl+C to exit.\n";
    while (!stop_requested) {
      if (engine.oversized_callback.load(std::memory_order_relaxed)) {
        std::cerr << "Audio buffer exceeded configured maximum; silence emitted.\n";
        break;
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    jack_deactivate(client.get());
    // Engine destructs before JackClient? local variables destruct in reverse
    // order (client first, then engine), so callback has already stopped.
    return 0;
  } catch (const std::exception& ex) {
    std::cerr << "VTTRIG NAM error: " << ex.what() << "\n";
    return 1;
  }
}
