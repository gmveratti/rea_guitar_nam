#pragma once

#include <json.hpp>

#include <cmath>
#include <filesystem>
#include <istream>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

namespace vttrig {

// Versioned offline exchange format between the future Tauri controller and
// the JACK engine. An array's order is the user's signal order.
struct ManifestEffect {
  std::string id;
  std::string kind; // "amp", "drive" or "cabinet"
  std::filesystem::path path;
  bool enabled = true;
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

    if (kind != "amp" && kind != "drive" && kind != "cabinet") {
      throw std::invalid_argument(prefix + "DSP not implemented for effect kind: " + kind);
    }
    if (!node.contains("resource") || !node["resource"].is_object() ||
        !node["resource"].contains("path") || !node["resource"]["path"].is_string()) {
      throw std::invalid_argument(prefix + "a local model/IR resource.path is required");
    }
    const auto path_string = node["resource"]["path"].get<std::string>();
    if (path_string.empty() || path_string.size() > 4096) {
      throw std::invalid_argument(prefix + "model/IR resource.path is invalid");
    }
    const std::filesystem::path path(path_string);
    const std::string extension = (kind == "cabinet") ? ".wav" : ".nam";
    if (path.extension() != extension) {
      throw std::invalid_argument(prefix + "expected " + extension + " file for " + kind);
    }
    // Parameters will be connected to the DSP adapter in a subsequent PR.
    // Reject malformed values rather than silently accepting unusable presets.
    if (!node.contains("parameters") || !node["parameters"].is_object()) {
      throw std::invalid_argument(prefix + "parameters must be a map");
    }
    for (const auto& [name, value] : node["parameters"].items()) {
      if (!value.is_number() || !std::isfinite(value.get<double>())) {
        throw std::invalid_argument(prefix + "invalid parameter: " + name);
      }
    }
    plan.push_back({id, kind, path, node["enabled"].get<bool>()});
  }
  return plan;
}

} // namespace vttrig
