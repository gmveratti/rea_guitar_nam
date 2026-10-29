#include "../src/chain_manifest.hpp"
#include <cassert>
#include <sstream>
#include <string>
#include <stdexcept>

static bool invalid(const std::string& input) {
  try {
    std::istringstream stream(input);
    (void)vttrig::parse_chain_manifest(stream);
  } catch (const std::exception&) {
    return true;
  }
  return false;
}

int main() {
  constexpr auto valid = R"({
    "schemaVersion":1,
    "nodes":[
      {"id":"ir-before","kind":"cabinet","enabled":true,"parameters":{"mix":100},"resource":{"path":"/tmp/first.wav"}},
      {"id":"amp-1","kind":"amp","enabled":true,"parameters":{"input":0},"resource":{"path":"/tmp/some.nam"}},
      {"id":"amp-2","kind":"amp","enabled":false,"parameters":{"input":-6},"resource":{"path":"/tmp/other.nam"}}
    ]
  })";
  std::istringstream stream(valid);
  auto plan = vttrig::parse_chain_manifest(stream);
  assert(plan.size() == 3);
  assert(plan[0].kind == "cabinet");
  assert(plan[0].id == "ir-before");
  assert(plan[1].kind == "amp" && plan[2].kind == "amp");
  assert(!plan[2].enabled);
  assert(plan[2].path.string() == "/tmp/other.nam");

  // Uppercase extensions are valid on Windows and other filesystems as well.
  // The Rust preflight already accepts them; native manifest parsing must agree.
  std::istringstream uppercase(R"({"schemaVersion":1,"nodes":[{"id":"upper-nam","kind":"amp","enabled":true,"parameters":{},"resource":{"path":"C:/Models/AMP.NAM"}},{"id":"upper-ir","kind":"cabinet","enabled":false,"parameters":{},"resource":{"path":"/tmp/IR.WAV"}}]})");
  const auto uppercase_nodes = vttrig::parse_chain_manifest(uppercase);
  assert(uppercase_nodes.size() == 2);
  assert(uppercase_nodes[0].kind == "amp");
  assert(uppercase_nodes[1].kind == "cabinet");

  // A native Noise Gate has no file and carries validated real DSP controls.
  std::istringstream gate_stream(R"({"schemaVersion":1,"nodes":[
    {"id":"gate-before","kind":"gate","enabled":true,
      "parameters":{"threshold":-45,"release":50,"hold":20,"range":80}},
    {"id":"amp","kind":"amp","enabled":true,"parameters":{},
      "resource":{"path":"/tmp/some.nam"}},
    {"id":"gate-after","kind":"gate","enabled":false,"parameters":{}}
  ]})");
  const auto gated = vttrig::parse_chain_manifest(gate_stream);
  assert(gated.size() == 3);
  assert(gated[0].kind == "gate" && gated[1].kind == "amp" && gated[2].kind == "gate");
  assert(gated[0].path.empty());
  assert(gated[0].parameters.at("threshold") == -45.0);
  assert(gated[2].parameters.empty());
  assert(!gated[2].enabled);
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"g","kind":"gate","enabled":true,"parameters":{"threshold":1}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"g","kind":"gate","enabled":true,"parameters":{"release":2}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"g","kind":"gate","enabled":true,"parameters":{"attack":10}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"g","kind":"gate","enabled":true,"parameters":{},"resource":{"path":"a.nam"}}]})"));

  // Unsupported DSP may not pretend to work. Fail even if bypassed.
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"chorus","kind":"chorus","enabled":false,"parameters":{},"resource":{"path":"p.nam"}}]})"));
  assert(invalid(R"({"schemaVersion":2,"nodes":[{"id":"x","kind":"amp","enabled":true,"parameters":{},"resource":{"path":"p.nam"}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"x","kind":"amp","enabled":true,"parameters":{},"resource":{"path":"p.wav"}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"x","kind":"amp","enabled":true,"parameters":{},"resource":{"path":"p.nam"}},{"id":"x","kind":"amp","enabled":true,"parameters":{},"resource":{"path":"p.nam"}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"x","kind":"amp","enabled":true,"parameters":{"gain":"loud"},"resource":{"path":"p.nam"}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"x","kind":"amp","enabled":true,"parameters":{}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"x","kind":"amp","enabled":"false","parameters":{},"resource":{"path":"p.nam"}}]})"));
  assert(invalid("{"));
  return 0;
}
