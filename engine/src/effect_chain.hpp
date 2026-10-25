#pragma once

#include <algorithm>
#include <array>
#include <cstddef>
#include <memory>
#include <stdexcept>
#include <string>
#include <unordered_set>
#include <utility>
#include <vector>

namespace vttrig {

// A chain is built/prepared on a non-realtime thread and then remains immutable
// for the entire callback lifetime. Editing it while process() runs is forbidden.
// The eventual Tauri bridge will construct a new immutable chain and atomically
// switch the active snapshot at a safe audio-block boundary.
constexpr std::size_t kMaxFrames = 8192;
constexpr std::size_t kMaxStages = 24;
using Sample = double;

class MonoProcessor {
public:
  virtual ~MonoProcessor() = default;
  // Realtime processing contract: pre-initialized, no allocation, no I/O,
  // no locks, no exceptions inside process().
  virtual void process(Sample* input, Sample* output, int frames) noexcept = 0;
};

struct Stage {
  std::string id;
  std::string kind;
  bool enabled = true;
  std::unique_ptr<MonoProcessor> processor;
};

class MonoChain {
public:
  void append(Stage stage) {
    if (!stage.processor || stage.id.empty() || stage.kind.empty()) {
      throw std::invalid_argument("Each effect needs a nonempty id/kind and processor");
    }
    if (stages_.size() >= kMaxStages) throw std::length_error("Maximum chain length is 24");
    if (find(stage.id) != stages_.end()) throw std::invalid_argument("Duplicate effect id");
    stages_.push_back(std::move(stage));
  }

  bool set_enabled(const std::string& id, bool enabled) {
    const auto found = find(id);
    if (found == stages_.end()) return false;
    found->enabled = enabled;
    return true;
  }

  // Move by instance id, not by type. Multiple NAMs/IRs can coexist.
  // If the new index is >= length, move to the last position.
  bool move(const std::string& id, std::size_t new_index) {
    const auto found = find(id);
    if (found == stages_.end()) return false;
    const auto index = static_cast<std::size_t>(found - stages_.begin());
    auto item = std::move(stages_[index]);
    stages_.erase(stages_.begin() + index);
    const auto insertion = std::min(new_index, stages_.size());
    stages_.insert(stages_.begin() + insertion, std::move(item));
    return true;
  }

  std::size_t size() const { return stages_.size(); }

  const std::vector<Stage>& stages() const { return stages_; }

  void process(Sample* input, Sample* output, int frames) noexcept {
    // Host invokes with 0 <= frames <= kMaxFrames; reject out-of-contract buffers.
    if (!input || !output || frames <= 0) return;
    if (frames > static_cast<int>(kMaxFrames)) {
      std::fill_n(output, frames, 0.0);
      return;
    }
    Sample* current = input;
    Sample* destination = scratch_a_.data();
    for (const auto& stage : stages_) {
      if (!stage.enabled) continue;
      stage.processor->process(current, destination, frames);
      current = destination;
      destination = (destination == scratch_a_.data()) ? scratch_b_.data() : scratch_a_.data();
    }
    // Empty or fully bypassed chain is a true passthrough.
    if (current != output) std::copy_n(current, frames, output);
  }

private:
  std::vector<Stage>::iterator find(const std::string& id) {
    return std::find_if(stages_.begin(), stages_.end(),
      [&id](const Stage& stage) { return stage.id == id; });
  }

  std::vector<Stage> stages_;
  std::array<Sample, kMaxFrames> scratch_a_{};
  std::array<Sample, kMaxFrames> scratch_b_{};
};

} // namespace vttrig
