#pragma once

#include "effect_chain.hpp"

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace vttrig {

// Deliberately narrow, well-tested offline fixture format: mono, 48 kHz,
// RIFF/WAVE PCM16 or IEEE float32. The app does not yet have resampling,
// multichannel routing or a device backend. All file I/O is OFF the audio
// callback. Reject rather than silently changing unsupported audio.
constexpr std::uint32_t kWavSampleRate = 48000;
constexpr std::uint64_t kMaxAudioDataBytes = 128ULL * 1024ULL * 1024ULL;

inline std::uint16_t wav_u16(const unsigned char* p) {
  return static_cast<std::uint16_t>(p[0] | (p[1] << 8));
}
inline std::uint32_t wav_u32(const unsigned char* p) {
  return static_cast<std::uint32_t>(p[0]) |
         (static_cast<std::uint32_t>(p[1]) << 8) |
         (static_cast<std::uint32_t>(p[2]) << 16) |
         (static_cast<std::uint32_t>(p[3]) << 24);
}
inline void wav_write_u16(std::ostream& output, std::uint16_t value) {
  unsigned char b[2] = {static_cast<unsigned char>(value & 255),
                        static_cast<unsigned char>((value >> 8) & 255)};
  output.write(reinterpret_cast<const char*>(b), 2);
}
inline void wav_write_u32(std::ostream& output, std::uint32_t value) {
  unsigned char b[4] = {static_cast<unsigned char>(value & 255),
                        static_cast<unsigned char>((value >> 8) & 255),
                        static_cast<unsigned char>((value >> 16) & 255),
                        static_cast<unsigned char>((value >> 24) & 255)};
  output.write(reinterpret_cast<const char*>(b), 4);
}

inline std::vector<Sample> read_mono_wav(const std::filesystem::path& path) {
  if (!std::filesystem::is_regular_file(path) ||
      std::filesystem::file_size(path) > kMaxAudioDataBytes + 1024 * 1024) {
    throw std::invalid_argument("Expected an existing WAV file smaller than 129 MiB");
  }
  std::ifstream file(path, std::ios::binary);
  char header[12]{};
  if (!file.read(header, 12) ||
      std::string(header, 4) != "RIFF" ||
      std::string(header + 8, 4) != "WAVE") {
    throw std::invalid_argument("Expected RIFF/WAVE input");
  }
  const auto riff_bytes = wav_u32(reinterpret_cast<unsigned char*>(header + 4));
  const auto physical_size = std::filesystem::file_size(path);
  if (static_cast<std::uint64_t>(riff_bytes) + 8 > physical_size ||
      riff_bytes < 36) {
    throw std::invalid_argument("Malformed RIFF size");
  }

  std::uint16_t encoding = 0, channels = 0, sample_bits = 0, block_align = 0;
  std::uint32_t sample_rate = 0, byte_rate = 0;
  bool have_fmt = false, have_data = false;
  std::vector<unsigned char> audio_bytes;
  std::uint64_t remaining = static_cast<std::uint64_t>(riff_bytes) - 4;

  while (remaining >= 8) {
    char chunk_header[8]{};
    if (!file.read(chunk_header, 8)) throw std::invalid_argument("Truncated WAV chunk header");
    remaining -= 8;
    const auto chunk_size = static_cast<std::uint64_t>(
        wav_u32(reinterpret_cast<unsigned char*>(chunk_header + 4)));
    const auto padded = chunk_size + (chunk_size & 1U);
    if (padded > remaining) throw std::invalid_argument("Truncated WAV chunk payload");
    const std::string name(chunk_header, 4);

    if (name == "fmt ") {
      if (have_fmt || chunk_size < 16 || chunk_size > 4096) {
        throw std::invalid_argument("Expected one valid PCM/float fmt chunk");
      }
      std::vector<unsigned char> fmt(static_cast<std::size_t>(chunk_size));
      if (!file.read(reinterpret_cast<char*>(fmt.data()), static_cast<std::streamsize>(chunk_size))) {
        throw std::invalid_argument("Truncated WAV fmt");
      }
      encoding = wav_u16(fmt.data());
      channels = wav_u16(fmt.data() + 2);
      sample_rate = wav_u32(fmt.data() + 4);
      byte_rate = wav_u32(fmt.data() + 8);
      block_align = wav_u16(fmt.data() + 12);
      sample_bits = wav_u16(fmt.data() + 14);
      have_fmt = true;
    } else if (name == "data") {
      if (have_data || chunk_size == 0 || chunk_size > kMaxAudioDataBytes) {
        throw std::invalid_argument("Invalid WAV data size");
      }
      audio_bytes.resize(static_cast<std::size_t>(chunk_size));
      if (!file.read(reinterpret_cast<char*>(audio_bytes.data()), static_cast<std::streamsize>(chunk_size))) {
        throw std::invalid_argument("Truncated WAV samples");
      }
      have_data = true;
    } else {
      file.seekg(static_cast<std::streamoff>(chunk_size), std::ios::cur);
      if (!file) throw std::invalid_argument("Malformed WAV extra chunk");
    }
    if (padded != chunk_size) {
      file.seekg(1, std::ios::cur);
      if (!file) throw std::invalid_argument("Malformed WAV chunk padding");
    }
    remaining -= padded;
  }
  if (!have_fmt || !have_data || channels != 1 || sample_rate != kWavSampleRate ||
      !((encoding == 1 && sample_bits == 16) ||
        (encoding == 3 && sample_bits == 32))) {
    throw std::invalid_argument("Only 48000 Hz mono PCM16/float32 WAV input is supported");
  }
  const unsigned int bytes_per_sample = sample_bits / 8;
  if (block_align != bytes_per_sample || byte_rate != sample_rate * block_align ||
      audio_bytes.size() % bytes_per_sample != 0) {
    throw std::invalid_argument("Invalid WAV alignment or byte rate");
  }

  std::vector<Sample> samples(audio_bytes.size() / bytes_per_sample);
  for (std::size_t i = 0; i < samples.size(); ++i) {
    const auto* b = audio_bytes.data() + i * bytes_per_sample;
    if (encoding == 1) {
      samples[i] = static_cast<Sample>(
          std::bit_cast<std::int16_t>(wav_u16(b))) / 32768.0;
    } else {
      const auto value = std::bit_cast<float>(wav_u32(b));
      if (!std::isfinite(value)) throw std::invalid_argument("Nonfinite float WAV sample");
      samples[i] = static_cast<Sample>(value);
    }
  }
  return samples;
}

inline void write_mono_float_wav(const std::filesystem::path& path,
                                 const std::vector<Sample>& samples) {
  if (samples.empty() || samples.size() > kMaxAudioDataBytes / 4) {
    throw std::invalid_argument("Output must contain 1 to 33554432 mono samples");
  }
  const auto data_bytes = static_cast<std::uint32_t>(samples.size() * 4);
  std::ofstream output(path, std::ios::binary | std::ios::trunc);
  if (!output) throw std::runtime_error("Cannot open output WAV");
  output.write("RIFF", 4);
  wav_write_u32(output, data_bytes + 36);
  output.write("WAVEfmt ", 8);
  wav_write_u32(output, 16);
  wav_write_u16(output, 3); // IEEE float
  wav_write_u16(output, 1); // mono
  wav_write_u32(output, kWavSampleRate);
  wav_write_u32(output, kWavSampleRate * 4);
  wav_write_u16(output, 4);
  wav_write_u16(output, 32);
  output.write("data", 4);
  wav_write_u32(output, data_bytes);
  for (const auto sample : samples) {
    const auto safe = std::isfinite(sample)
        ? static_cast<float>(std::clamp(sample, -1.0, 1.0))
        : 0.0f;
    wav_write_u32(output, std::bit_cast<std::uint32_t>(safe));
  }
  if (!output) throw std::runtime_error("Failed to write output WAV");
}

// Device-neutral block processing: exactly the same MonoChain used by JACK.
// The caller prepares the graph and allocates buffers ahead of any callback.
inline std::vector<Sample> render_offline(MonoChain& chain,
                                           const std::vector<Sample>& input,
                                           int block_size = 128) {
  if (block_size <= 0 || block_size > static_cast<int>(kMaxFrames)) {
    throw std::invalid_argument("Invalid block size");
  }
  std::vector<Sample> output(input.size());
  std::vector<Sample> scratch_in(static_cast<std::size_t>(block_size));
  std::vector<Sample> scratch_out(static_cast<std::size_t>(block_size));
  for (std::size_t offset = 0; offset < input.size();) {
    const auto frames = static_cast<int>(
        std::min(input.size() - offset, static_cast<std::size_t>(block_size)));
    std::copy_n(input.data() + offset, frames, scratch_in.data());
    chain.process(scratch_in.data(), scratch_out.data(), frames);
    std::copy_n(scratch_out.data(), frames, output.data() + offset);
    offset += static_cast<std::size_t>(frames);
  }
  return output;
}

}  // namespace vttrig
