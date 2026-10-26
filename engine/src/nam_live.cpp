// VTTRIG live audio sidecar. stdin/stdout are reserved for binary audio frames.
// The control thread (Tauri) passes the complete versioned ordered manifest as
// a single command argument. Everything is prepared before sending READY.
// 128 mono IEEE-float32 samples per message, little endian, indefinitely.
// This process is controlled by Rust, not called inside a device callback.
#include "nam_processing.hpp"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {
constexpr std::size_t kFrames = 128;
constexpr std::size_t kBytes = kFrames * sizeof(float);
bool is_little_endian() {
  const std::uint16_t v = 1;
  return *reinterpret_cast<const unsigned char*>(&v) == 1;
}
} // namespace

int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "--help") {
    std::cout << "vttrig-nam-live --chain-json <schema-v1-json>\n"
              << "Protocol: READY\\n then 128 float32 LE samples each way.\n";
    return 0;
  }
  if (argc != 3 || std::string(argv[1]) != "--chain-json") {
    std::cerr << "Expected --chain-json with a versioned manifest\n";
    return 2;
  }
  if (!is_little_endian()) {
    std::cerr << "Only little-endian float32 PCM is supported\n";
    return 2;
  }
  try {
    std::string json(argv[2]);
    if (json.size() > 32 * 1024) throw std::invalid_argument("Manifest too large");
    std::istringstream stream(json);
    const auto specs = vttrig::parse_chain_manifest(stream);
    auto chain = vttrig::prepare_chain(specs);
#ifdef _WIN32
    if (_setmode(_fileno(stdin), _O_BINARY) == -1 ||
        _setmode(_fileno(stdout), _O_BINARY) == -1) {
      throw std::runtime_error("Cannot set binary pipe mode");
    }
#endif
    // Handshake is a single byte; after 'R', stdout is ONLY binary.
    std::cout.put('R');
    std::cout.flush();
    std::array<float, kFrames> in{};
    std::array<float, kFrames> out{};
    std::array<vttrig::Sample, kFrames> native_in{};
    std::array<vttrig::Sample, kFrames> native_out{};
    while (true) {
      std::cin.read(reinterpret_cast<char*>(in.data()), kBytes);
      if (std::cin.gcount() == 0 && std::cin.eof()) break;
      if (std::cin.gcount() != static_cast<std::streamsize>(kBytes)) {
        throw std::runtime_error("Truncated input audio block");
      }
      for (std::size_t i = 0; i < kFrames; ++i) {
        native_in[i] = std::isfinite(in[i]) ? static_cast<double>(in[i]) : 0.0;
      }
      chain.process(native_in.data(), native_out.data(), static_cast<int>(kFrames));
      for (std::size_t i = 0; i < kFrames; ++i) {
        out[i] = std::isfinite(native_out[i]) ? static_cast<float>(native_out[i]) : 0.0f;
      }
      std::cout.write(reinterpret_cast<const char*>(out.data()), kBytes);
      std::cout.flush();
      if (!std::cout) throw std::runtime_error("Audio output pipe closed");
    }
    return 0;
  } catch (const std::exception& e) {
    // Error text is ONLY on stderr, never mixed with PCM.
    std::cerr << "VTTRIG live DSP: " << e.what() << "\n";
    return 1;
  }
}
