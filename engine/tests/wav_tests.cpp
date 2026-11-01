#include "../src/wav_mono.hpp"
#include "../src/classic_delay.hpp"
#include "../src/room_reverb.hpp"

#include <cassert>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
struct Gain final : vttrig::MonoProcessor {
  explicit Gain(double value) : value(value) {}
  double value;
  void process(vttrig::Sample* input, vttrig::Sample* output, int frames) noexcept override {
    for (int i = 0; i < frames; ++i) output[i] = input[i] * value;
  }
};

template<class Operation>
bool throws_invalid(Operation action) {
  try {
    action();
    return false;
  } catch (const std::invalid_argument&) {
    return true;
  }
}

void approx(double actual, double expected, double tolerance = 1e-6) {
  assert(std::abs(actual - expected) < tolerance);
}

void patch_u16(const std::filesystem::path& file, std::streamoff offset,
               std::uint16_t value) {
  std::fstream f(file, std::ios::binary | std::ios::in | std::ios::out);
  f.seekp(offset);
  vttrig::wav_write_u16(f, value);
}
void patch_u32(const std::filesystem::path& file, std::streamoff offset,
               std::uint32_t value) {
  std::fstream f(file, std::ios::binary | std::ios::in | std::ios::out);
  f.seekp(offset);
  vttrig::wav_write_u32(f, value);
}

void write_pcm16_test(const std::filesystem::path& path) {
  std::ofstream f(path, std::ios::binary);
  f.write("RIFF", 4);
  vttrig::wav_write_u32(f, 36 + 8);
  f.write("WAVEfmt ", 8);
  vttrig::wav_write_u32(f, 16);
  vttrig::wav_write_u16(f, 1);
  vttrig::wav_write_u16(f, 1);
  vttrig::wav_write_u32(f, 48000);
  vttrig::wav_write_u32(f, 96000);
  vttrig::wav_write_u16(f, 2);
  vttrig::wav_write_u16(f, 16);
  f.write("data", 4);
  vttrig::wav_write_u32(f, 8);
  for (const std::uint16_t word : {std::uint16_t{0}, std::uint16_t{16384},
                                    std::uint16_t{32768}, std::uint16_t{49152}}) {
    vttrig::wav_write_u16(f, word);
  }
}
}  // namespace

int main() {
  const auto base = std::filesystem::current_path() / "vttrig-wav-regression";
  const auto float_file = base.string() + "-float.wav";
  const auto pcm_file = base.string() + "-pcm16.wav";
  const auto bad_file = base.string() + "-bad.wav";

  // 257 samples exercise two full 128-sample blocks AND a 1-frame tail.
  std::vector<vttrig::Sample> input(257);
  for (std::size_t i = 0; i < input.size(); ++i) {
    input[i] = static_cast<double>(static_cast<int>(i) - 128) / 256.0;
  }
  vttrig::write_mono_float_wav(float_file, input);
  auto loaded = vttrig::read_mono_wav(float_file);
  assert(loaded.size() == 257);
  for (std::size_t i = 0; i < input.size(); ++i) approx(loaded[i], input[i]);

  vttrig::MonoChain chain;
  chain.append({"gain", "test", true, std::make_unique<Gain>(2.0)});
  auto processed = vttrig::render_offline(chain, loaded, 128);
  for (std::size_t i = 0; i < input.size(); ++i) {
    approx(processed[i], input[i] * 2.0);
  }

  assert(chain.set_enabled("gain", false));
  const auto dry = vttrig::render_offline(chain, loaded, 128);
  for (std::size_t i = 0; i < input.size(); ++i) approx(dry[i], loaded[i]);

  vttrig::MonoChain empty;
  auto passthrough = vttrig::render_offline(empty, loaded, 256);
  assert(passthrough.size() == loaded.size());
  approx(passthrough[256], loaded[256]);
  assert(throws_invalid([&] { (void)vttrig::render_offline(empty, loaded, 0); }));
  assert(throws_invalid([&] { (void)vttrig::render_offline(empty, loaded, 8193); }));

  // Reproduces #31: a 128-frame dry impulse yielded silence when its first
  // 40 ms echo (frame 1920) fell beyond the exact-length output.
  std::vector<vttrig::Sample> impulse(128, 0.0);
  impulse[0] = 0.7;
  vttrig::MonoChain exact_delay;
  exact_delay.append({"echo", "delay", true,
      std::make_unique<vttrig::ClassicDelayMonoProcessor>(
          vttrig::DelayParams{40.0, 0.0, 100.0})});
  const auto exact = vttrig::render_offline(exact_delay, impulse);
  assert(exact.size() == impulse.size());
  for (const auto sample : exact) approx(sample, 0.0);

  vttrig::MonoChain tailed_delay;
  tailed_delay.append({"echo", "delay", true,
      std::make_unique<vttrig::ClassicDelayMonoProcessor>(
          vttrig::DelayParams{40.0, 0.0, 100.0})});
  const auto tailed = vttrig::render_offline(tailed_delay, impulse, 128, 2048);
  assert(tailed.size() == 2176);
  approx(tailed[1920], 0.7);
  approx(tailed[1919], 0.0);

  vttrig::MonoChain feedback_delay;
  feedback_delay.append({"echo", "delay", true,
      std::make_unique<vttrig::ClassicDelayMonoProcessor>(
          vttrig::DelayParams{40.0, 50.0, 100.0})});
  const auto repeats = vttrig::render_offline(feedback_delay, impulse, 64, 4000);
  approx(repeats[1920], 0.7);
  assert(repeats[3840] > 0.1);

  vttrig::MonoChain reverb;
  reverb.append({"room", "reverb", true,
      std::make_unique<vttrig::RoomReverbMonoProcessor>(
          vttrig::RoomReverbParams{67.0, 2.0, 100.0})});
  const auto room_tail = vttrig::render_offline(reverb, impulse, 128, 96000);
  assert(room_tail.size() == 96128);
  bool heard_reflection = false;
  for (std::size_t i = impulse.size(); i < room_tail.size(); ++i) {
    if (std::abs(room_tail[i]) > 1e-5) { heard_reflection = true; break; }
  }
  assert(heard_reflection);

  // A simple synthetic two-tap convolution stand-in exercises a delayed
  // impulse response without depending on external NAM captures or WAV IRs.
  struct DelayedTap final : vttrig::MonoProcessor {
    std::vector<vttrig::Sample> delay = std::vector<vttrig::Sample>(256, 0.0);
    std::size_t head = 0;
    void process(vttrig::Sample* input, vttrig::Sample* output, int frames) noexcept override {
      for (int i = 0; i < frames; ++i) {
        output[i] = delay[head];
        delay[head] = input[i];
        head = (head + 1) % delay.size();
      }
    }
  };
  vttrig::MonoChain ir;
  ir.append({"synthetic-ir", "cabinet", true, std::make_unique<DelayedTap>()});
  const auto ir_tail = vttrig::render_offline(ir, impulse, 128, 512);
  approx(ir_tail[256], 0.7);
  assert(throws_invalid([&] {
    (void)vttrig::render_offline(ir, impulse, 128,
                                 vttrig::kMaxAudioDataBytes / 4);
  }));

  write_pcm16_test(pcm_file);
  auto pcm = vttrig::read_mono_wav(pcm_file);
  assert(pcm.size() == 4);
  approx(pcm[0], 0.0);
  approx(pcm[1], 0.5);
  approx(pcm[2], -1.0);
  approx(pcm[3], -0.5);

  std::filesystem::copy_file(float_file, bad_file,
      std::filesystem::copy_options::overwrite_existing);
  patch_u32(bad_file, 24, 44100);
  assert(throws_invalid([&] { (void)vttrig::read_mono_wav(bad_file); }));

  std::filesystem::copy_file(float_file, bad_file,
      std::filesystem::copy_options::overwrite_existing);
  patch_u16(bad_file, 22, 2);
  assert(throws_invalid([&] { (void)vttrig::read_mono_wav(bad_file); }));

  std::filesystem::copy_file(float_file, bad_file,
      std::filesystem::copy_options::overwrite_existing);
  patch_u32(bad_file, 4, 0x7fffffff);
  assert(throws_invalid([&] { (void)vttrig::read_mono_wav(bad_file); }));

  std::filesystem::copy_file(float_file, bad_file,
      std::filesystem::copy_options::overwrite_existing);
  patch_u32(bad_file, 44, 0x7fc00000);  // Nonfinite IEEE float.
  assert(throws_invalid([&] { (void)vttrig::read_mono_wav(bad_file); }));

  assert(throws_invalid([&] { vttrig::write_mono_float_wav(bad_file, {}); }));
  std::filesystem::remove(float_file);
  std::filesystem::remove(pcm_file);
  std::filesystem::remove(bad_file);
  std::cout << "VTTRIG portable mono WAV and offline render tests passed\n";
  return 0;
}
