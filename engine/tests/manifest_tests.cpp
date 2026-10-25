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
