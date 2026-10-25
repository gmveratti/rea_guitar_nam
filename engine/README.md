# VTTRIG native NAM / IR JACK engine

**Experimental standalone CLI for Fedora/PipeWire-JACK.** This is not the Tauri UI.
The engine is based on the MIT-licensed NeuralAmpModelerCore used by Gateway,
pinned at commit `0b3d3c97b0859a3a8c92a8628c4dd89a25eb5842` (v0.6.0).

## Principle: signal order always belongs to the user

**Never force NAM → cabinet → effects.** Audio is processed from first to last
node in the exact order the user chooses. NAM captures and IRs can appear in
any position, be repeated, and be bypassed separately. The preset's default
order is only an example; it is not an engine rule.

Current executable accepts the ordered list at startup:

```bash
# Conventional (one possible choice):
./engine/build/vttrig-nam-jack --nam amp.nam --ir cab.wav

# Equally valid: cabinet before amp and repeated NAM models:
./engine/build/vttrig-nam-jack --ir cab.wav --nam amp.nam --nam drive.nam

# Disable the immediately preceding block:
./engine/build/vttrig-nam-jack --nam drive.nam --bypass --nam amp.nam
```

The independent C++ `MonoChain` in `src/effect_chain.hpp` supports ordered
nodes with a unique ID, duplicate kinds, bypass, move-by-ID and preallocated
scratch buffers. Native CTest includes deliberately **noncommutative**
transforms to prove reordering changes the actual processed signal.
The TypeScript contract `src/lib/signalChain.ts` preserves the matching
visual order and identities for future IPC.

**Current limitation:** although the UI already allows live drag/drop and
preset saving, **it is NOT connected to the running engine**. The CLI order
is fixed for that process lifetime. Real-time user changes must build a new
prepared immutable graph outside the callback and swap at a safe audio-block
boundary; never mutate a live processor vector from a UI thread.

## PR #2: versioned offline chain manifest (without Fedora hardware)

A first bridge for the future Tauri → DSP control path is now available:
`src/lib/signalChain.ts` serializes **schemaVersion 1**; the standalone
JACK binary loads a matching JSON file with `--chain-json`. This is
a **startup-time snapshot**, not real-time Tauri integration.

Example: [tests/fixtures/ordered-chain.json](tests/fixtures/ordered-chain.json).
Use *real local* paths to a mono `.nam` or `.wav` for each instance:

```json
{
  "schemaVersion": 1,
  "nodes": [
    {
      "id": "cab-1",
      "kind": "cabinet",
      "enabled": true,
      "parameters": {"mix": 100},
      "resource": {"path": "/home/user/IRs/cab.wav"}
    },
    {
      "id": "amp-1",
      "kind": "amp",
      "enabled": true,
      "parameters": {"input": 0, "output": -3},
      "resource": {"path": "/home/user/NAMs/amp.nam"}
    }
  ]
}
```

```bash
# Validates schema, IDs, type, source paths' extensions, and parameters.
# Does not read the model contents, open JACK or process audio.
./engine/build/vttrig-nam-jack --validate-chain-json my-chain.json

# Loads the specified NAM/IR files and begins JACK processing, in JSON order.
./engine/build/vttrig-nam-jack --chain-json my-chain.json
```

**Rules and present limits:** array order is the exact DSP sequence;
IDs must be unique; up to 24 stages; repeat `amp`, `drive` or `cabinet`
freely, each with independent bypass. Unknown/unsupported effects
(`chorus`, `delay`, `reverb`, `compressor`, `sustain`, `gate`) are
**rejected explicitly** even if disabled; the engine does not silently
pretend to apply them. Version and malformed parameters are rejected.
Parameters are currently **validated only, not applied** to NAM/IR audio:
gain, mix and control automation will be implemented separately.

The React pedalboard can already create ordered snapshots, and an optional
per-instance resource map can be supplied to `createSignalChainSnapshot()`.
It **does not yet manage file paths or send the snapshots to the audio
process**. Tauri UI and the JACK engine are still independent. Existing
legacy `--nam ... --ir ... --bypass` CLI remains supported.

## Build on Fedora

Install Fedora versions of `cmake`, `ninja`, `pkgconf-pkg-config`,
`gcc-c++`, `git`, and JACK development headers
(`pipewire-jack-audio-connection-kit-devel` or appropriate JACK equivalent).
PipeWire's JACK compatibility server should be running at **48 kHz**.

```bash
cmake -S engine -B engine/build -GNinja -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON
cmake --build engine/build -j2
ctest --test-dir engine/build --output-on-failure
./engine/build/vttrig-nam-jack --help
./engine/build/vttrig-nam-jack --nam /path/to/A2-model.nam
```

Connect your interface's hardware capture to `VTTRIG_NAM:input` and
`VTTRIG_NAM:output` to playback using `qpwgraph` (no autoconnect).
Begin with monitor volume low to avoid feedback or high gain.

## Scope and protection

- Currently supports mono-input/mono-output `.nam` or mono `.wav` IR
  nodes, max 24 blocks, 48 kHz JACK, prewarmed DSP outside realtime.
- Stereo IR, arbitrary sample rates for NAM, MIDI, amp-skin DSP mapping,
  chorus, delay, reverb, compressor, sustain and Tauri control are **pending**.
- Each node has its own bypass/identity. Model loads, sample-rate conversions
  of IRs and other expensive operations must occur off the audio callback.
- Output is safety-clamped to [-1, 1]. No claims about final timbre,
  latency or glitch-free realtime performance before measured hardware tests.
- CMake/CTest smoke only checks compile/CLI and graph math. It does **not**
  test real A2 models or a physical sound interface.

## Regression policy

Inherited from the TaxUtil quality discipline. Before changing a behavior,
add a test that reproduces the fault, prove it fails on the former
implementation, then make the smallest fix and run all affected suites.

Required graph regressions: first and last positions, repeated module type,
any permutation of effect kinds, bypass preservation, order after preset load,
invalid graph entries, empty/all-bypassed passthrough, and no mutation on the
realtime thread. Read [../docs/TESTING.md](../docs/TESTING.md).

Future A/B validation: Gateway/TONE3000 with the same capture and
level-matched dry input; CPU/xruns/roundtrip latency at buffers 64/128/256
on Fedora. Keep third-party NAM/Core licenses and attribution.
