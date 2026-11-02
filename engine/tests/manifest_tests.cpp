#include "../src/chain_manifest.hpp"
#include <cassert>
#include <filesystem>
#include <fstream>
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

  // JSON resources are UTF-8 even on Windows, whose native paths are UTF-16.
  // Compare UTF-8 output directly; ACP conversion must not corrupt these names.
  std::istringstream localized(R"({"schemaVersion":1,"nodes":[{"id":"unicode","kind":"amp","enabled":true,"parameters":{},"resource":{"path":"C:/Usu\u00e1rio/\u65e5\u672c/Amplifica\u00e7\u00e3o.nam"}}]})");
  const auto localized_nodes = vttrig::parse_chain_manifest(localized);
  assert(localized_nodes[0].path.u8string() ==
         u8"C:/Usu\u00e1rio/\u65e5\u672c/Amplifica\u00e7\u00e3o.nam");

  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"amp","kind":"amp","enabled":true,"parameters":{"input":25},"resource":{"path":"amp.nam"}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"drive","kind":"drive","enabled":true,"parameters":{"output":-25},"resource":{"path":"drive.nam"}}]})"));

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

  // File-free Airwindows ButterComp2 may appear before/after NAM or Gate.
  std::istringstream compressor_stream(R"({"schemaVersion":1,"nodes":[
    {"id":"cp-1","kind":"compressor","enabled":true,
     "parameters":{"compress":55,"output":120,"mix":75}},
    {"id":"g","kind":"gate","enabled":true,"parameters":{}},
    {"id":"cp-2","kind":"compressor","enabled":false,"parameters":{}}
  ]})");
  const auto compressors = vttrig::parse_chain_manifest(compressor_stream);
  assert(compressors.size() == 3);
  assert(compressors[0].kind == "compressor" && compressors[2].kind == "compressor");
  assert(compressors[0].path.empty() && compressors[0].parameters.at("compress") == 55.0);
  assert(!compressors[2].enabled);
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"c","kind":"compressor","enabled":true,"parameters":{"compress":101}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"c","kind":"compressor","enabled":true,"parameters":{"output":201}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"c","kind":"compressor","enabled":true,"parameters":{"attack":20}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"c","kind":"compressor","enabled":true,"parameters":{},"resource":{"path":"fake.nam"}}]})"));

  // VTTSUSTAIN uses Airwindows Pressure5 dynamics with no .nam/.wav.
  std::istringstream sustain_stream(R"({"schemaVersion":1,"nodes":[
    {"id":"su-1","kind":"sustain","enabled":true,
     "parameters":{"sustain":65,"speed":25,"level":-3,"mix":80}},
    {"id":"cp-1","kind":"compressor","enabled":true,"parameters":{}},
    {"id":"su-2","kind":"sustain","enabled":false,"parameters":{}}
  ]})");
  const auto sustains = vttrig::parse_chain_manifest(sustain_stream);
  assert(sustains.size() == 3);
  assert(sustains[0].kind == "sustain" && sustains[2].kind == "sustain");
  assert(sustains[0].parameters.at("level") == -3.0 && sustains[0].path.empty());
  assert(!sustains[2].enabled);
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"s","kind":"sustain","enabled":true,"parameters":{"sustain":101}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"s","kind":"sustain","enabled":true,"parameters":{"speed":-1}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"s","kind":"sustain","enabled":true,"parameters":{"level":19}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"s","kind":"sustain","enabled":true,"parameters":{"attack":10}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"s","kind":"sustain","enabled":true,"parameters":{"mix":101}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"s","kind":"sustain","enabled":true,"parameters":{},"resource":{"path":"test.nam"}}]})"));

  // DaisySP-inspired mono chorus: file-free, ordered, repeated, bypassed.
  std::istringstream chorus_stream(R"({"schemaVersion":1,"nodes":[
    {"id":"ch-a","kind":"chorus","enabled":true,
     "parameters":{"rate":1.2,"depth":48,"mix":30}},
    {"id":"ch-b","kind":"chorus","enabled":false,"parameters":{}},
    {"id":"su","kind":"sustain","enabled":true,"parameters":{}}
  ]})");
  const auto chorus_nodes = vttrig::parse_chain_manifest(chorus_stream);
  assert(chorus_nodes.size() == 3);
  assert(chorus_nodes[0].kind == "chorus");
  assert(chorus_nodes[0].parameters.at("rate") == 1.2);
  assert(chorus_nodes[0].path.empty());
  assert(chorus_nodes[1].kind == "chorus" && !chorus_nodes[1].enabled);
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"c","kind":"chorus","enabled":true,"parameters":{"rate":0}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"c","kind":"chorus","enabled":true,"parameters":{"rate":8.1}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"c","kind":"chorus","enabled":true,"parameters":{"depth":101}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"c","kind":"chorus","enabled":true,"parameters":{"mix":-1}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"c","kind":"chorus","enabled":true,"parameters":{"feedback":50}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"c","kind":"chorus","enabled":true,"parameters":{},"resource":{"path":"invalid.nam"}}]})"));

  // Native file-free delay: time is actual milliseconds at 48 kHz.
  std::istringstream delay_stream(R"({"schemaVersion":1,"nodes":[
    {"id":"dly-a","kind":"delay","enabled":true,
     "parameters":{"time":420,"feedback":38,"mix":28}},
    {"id":"ch","kind":"chorus","enabled":true,"parameters":{}},
    {"id":"dly-b","kind":"delay","enabled":false,"parameters":{}}
  ]})");
  const auto delay_nodes = vttrig::parse_chain_manifest(delay_stream);
  assert(delay_nodes.size() == 3);
  assert(delay_nodes[0].kind == "delay" && delay_nodes[2].kind == "delay");
  assert(delay_nodes[0].path.empty() && delay_nodes[0].parameters.at("time") == 420.0);
  assert(!delay_nodes[2].enabled);
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"d","kind":"delay","enabled":true,"parameters":{"time":39}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"d","kind":"delay","enabled":true,"parameters":{"time":1201}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"d","kind":"delay","enabled":true,"parameters":{"feedback":91}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"d","kind":"delay","enabled":true,"parameters":{"mix":-1}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"d","kind":"delay","enabled":true,"parameters":{"tone":50}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"d","kind":"delay","enabled":true,"parameters":{},"resource":{"path":"fake.nam"}}]})"));

  // Room Reverb uses file-free native DSP and precise UI parameter ranges.
  std::istringstream reverb_stream(R"({"schemaVersion":1,"nodes":[
    {"id":"rv-a","kind":"reverb","enabled":true,
     "parameters":{"size":67,"decay":4.2,"mix":24}},
    {"id":"dl","kind":"delay","enabled":true,"parameters":{}},
    {"id":"rv-b","kind":"reverb","enabled":false,"parameters":{}}
  ]})");
  const auto reverbs = vttrig::parse_chain_manifest(reverb_stream);
  assert(reverbs.size() == 3);
  assert(reverbs[0].kind == "reverb" && reverbs[2].kind == "reverb");
  assert(reverbs[0].path.empty() && reverbs[0].parameters.at("decay") == 4.2);
  assert(!reverbs[2].enabled);
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"r","kind":"reverb","enabled":true,"parameters":{"size":101}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"r","kind":"reverb","enabled":true,"parameters":{"decay":0.1}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"r","kind":"reverb","enabled":true,"parameters":{"decay":15.1}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"r","kind":"reverb","enabled":true,"parameters":{"mix":-1}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"r","kind":"reverb","enabled":true,"parameters":{"predelay":20}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"r","kind":"reverb","enabled":true,"parameters":{},"resource":{"path":"fake.wav"}}]})"));

  // Unsupported DSP may not pretend to work. Fail even if bypassed.
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"flanger","kind":"flanger","enabled":false,"parameters":{},"resource":{"path":"p.nam"}}]})"));
  assert(invalid(R"({"schemaVersion":2,"nodes":[{"id":"x","kind":"amp","enabled":true,"parameters":{},"resource":{"path":"p.nam"}}]})"));
  // An explicitly empty rig is a dry passthrough, e.g. after clearing the amp.
  std::istringstream empty_rig(R"({"schemaVersion":1,"nodes":[]})");
  assert(vttrig::parse_chain_manifest(empty_rig).empty());
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"x","kind":"amp","enabled":true,"parameters":{},"resource":{"path":"p.wav"}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"x","kind":"amp","enabled":true,"parameters":{},"resource":{"path":"p.nam"}},{"id":"x","kind":"amp","enabled":true,"parameters":{},"resource":{"path":"p.nam"}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"x","kind":"amp","enabled":true,"parameters":{"gain":"loud"},"resource":{"path":"p.nam"}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"x","kind":"amp","enabled":true,"parameters":{}}]})"));
  assert(invalid(R"({"schemaVersion":1,"nodes":[{"id":"x","kind":"amp","enabled":"false","parameters":{},"resource":{"path":"p.nam"}}]})"));
  assert(invalid("{"));

  // Shared with Rust and TypeScript: file-free manifest contracts are
  // source fixtures, not generated binaries or proprietary NAM captures.
  const auto fixtures = std::filesystem::path(VTTRIG_CONTRACT_FIXTURE_DIR);
  std::ifstream valid_fixture(fixtures / "valid-file-free.json");
  assert(valid_fixture.good());
  const auto shared = vttrig::parse_chain_manifest(valid_fixture);
  assert(shared.size() == 3);
  assert(shared[0].id == "gate-1" && shared[1].id == "delay-bypassed");
  assert(shared[2].id == "gate-2" && !shared[1].enabled);
  for (const auto name : {
      "invalid-duplicate-id.json",
      "invalid-missing-enabled.json",
      "invalid-parameter-range.json",
      "invalid-version.json",
  }) {
    std::ifstream file(fixtures / name);
    assert(file.good());
    std::ostringstream buffer;
    buffer << file.rdbuf();
    assert(invalid(buffer.str()));
  }
  return 0;
}
