#pragma once

#include <json.hpp>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <filesystem>
#include <istream>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

namespace vttrig {

// Versioned offline exchange format between the future Tauri controller and
// the JACK engine. An array's order is the user's signal order.
struct ManifestEffect {
  std::string id;
  std::string kind; // "amp", "drive", "cabinet", "gate", "compressor" or "sustain"
  std::filesystem::path path; // empty for a file-free effect
  bool enabled = true;
  std::map<std::string, double> parameters; // evaluated during graph preparation
};

inline std::vector<ManifestEffect> parse_chain_manifest(std::istream& stream) {
  using nlohmann::json;
  auto manifest = json::parse(stream);
  if (!manifest.is_object() || !manifest.contains("schemaVersion") ||
      !manifest["schemaVersion"].is_number_integer() ||
      manifest["schemaVersion"].get<int>() != 1) {
    throw std::invalid_argument("Unsupported chain manifest schemaVersion (expected 1)");
  }
  if (!manifest.contains("nodes") || !manifest["nodes"].is_array()) {
    throw std::invalid_argument("Chain manifest nodes must be an array");
  }
  const auto& nodes = manifest["nodes"];
  if (nodes.empty() || nodes.size() > 24) {
    throw std::invalid_argument("Chain manifest must contain 1 to 24 nodes");
  }

  std::set<std::string> seen_ids;
  std::vector<ManifestEffect> plan;
  plan.reserve(nodes.size()); // This happens only during setup, never in callback.

  for (std::size_t i = 0; i < nodes.size(); ++i) {
    const auto& node = nodes[i];
    const std::string prefix = "Chain node " + std::to_string(i + 1) + ": ";
    if (!node.is_object() ||
        !node.contains("id") || !node["id"].is_string() ||
        !node.contains("kind") || !node["kind"].is_string() ||
        !node.contains("enabled") || !node["enabled"].is_boolean()) {
      throw std::invalid_argument(prefix + "id/kind/enabled are required with correct types");
    }
    const auto id = node["id"].get<std::string>();
    const auto kind = node["kind"].get<std::string>();
    if (id.empty() || id.size() > 128 || !seen_ids.insert(id).second) {
      throw std::invalid_argument(prefix + "duplicate, empty or oversized effect id");
    }

    if (kind != "amp" && kind != "drive" && kind != "cabinet" && kind != "gate" && kind != "compressor" && kind != "sustain") {
      throw std::invalid_argument(prefix + "DSP not implemented for effect kind: " + kind);
    }
    std::filesystem::path path;
    if (kind == "gate" || kind == "compressor" || kind == "sustain") {
      // Native dynamics effects never load .nam/.wav files.
      if (node.contains("resource")) {
        throw std::invalid_argument(prefix + "native dynamics effect must not have a resource");
      }
    } else {
      if (!node.contains("resource") || !node["resource"].is_object() ||
          !node["resource"].contains("path") || !node["resource"]["path"].is_string()) {
        throw std::invalid_argument(prefix + "a local model/IR resource.path is required");
      }
      const auto path_string = node["resource"]["path"].get<std::string>();
      if (path_string.empty() || path_string.size() > 4096) {
        throw std::invalid_argument(prefix + "model/IR resource.path is invalid");
      }
      path = std::filesystem::path(path_string);
      const std::string extension = (kind == "cabinet") ? ".wav" : ".nam";
      auto actual_extension = path.extension().string();
      // Case-insensitive extension; never change the actual file path.
      std::transform(actual_extension.begin(), actual_extension.end(),
                     actual_extension.begin(), [](unsigned char c) {
                       return static_cast<char>(std::tolower(c));
                     });
      if (actual_extension != extension) {
        throw std::invalid_argument(prefix + "expected " + extension + " file for " + kind);
      }
    }
    if (!node.contains("parameters") || !node["parameters"].is_object()) {
      throw std::invalid_argument(prefix + "parameters must be a map");
    }
    std::map<std::string, double> parameters;
    for (const auto& [name, value] : node["parameters"].items()) {
      if (!value.is_number() || !std::isfinite(value.get<double>())) {
        throw std::invalid_argument(prefix + "invalid parameter: " + name);
      }
      const double number = value.get<double>();
      if (kind == "gate") {
        const bool valid =
            (name == "threshold" && number >= -100.0 && number <= 0.0) ||
            (name == "release" && number >= 5.0 && number <= 500.0) ||
            (name == "hold" && number >= 0.0 && number <= 200.0) ||
            (name == "range" && number >= 20.0 && number <= 80.0);
        if (!valid) {
          throw std::invalid_argument(prefix + "unknown or out-of-range gate parameter: " + name);
        }
      }
      if (kind == "compressor") {
        const bool valid =
            (name == "compress" && number >= 0.0 && number <= 100.0) ||
            (name == "output" && number >= 0.0 && number <= 200.0) ||
            (name == "mix" && number >= 0.0 && number <= 100.0);
        if (!valid) {
          throw std::invalid_argument(prefix + "unknown or out-of-range compressor parameter: " + name);
        }
      }
      if (kind == "sustain") {
        const bool valid =
            (name == "sustain" && number >= 0.0 && number <= 100.0) ||
            (name == "speed" && number >= 0.0 && number <= 100.0) ||
            (name == "level" && number >= -18.0 && number <= 18.0) ||
            (name == "mix" && number >= 0.0 && number <= 100.0);
        if (!valid) {
          throw std::invalid_argument(prefix + "unknown or out-of-range sustain parameter: " + name);
        }
      }
      parameters.emplace(name, number);
    }
    plan.push_back({id, kind, path, node["enabled"].get<bool>(), std::move(parameters)});
  }
  return plan;
}

} // namespace vttrig
