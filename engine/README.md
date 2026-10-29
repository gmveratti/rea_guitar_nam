# VTTRIG native NAM / IR JACK engine

## VTTCHORUS Classic: DaisySP ChorusEngine em mono

`kind: "chorus"` é um nó nativo sem `resource`, com três parâmetros
validados: `rate` (0.1–8 Hz, padrão 1.2), `depth` (0–100%, padrão 48)
e `mix` (0–100%, padrão 30). O algoritmo C++20 `daisy_chorus.hpp`
adapta as linhas de delay, interpolação linear, LFO triangular e feedback
(20%) do DaisySP ChorusEngine (MIT), em duas vozes com fases diferentes.
A saída do VTTRIG permanece **mono 48 kHz**; os dois canais e pan da
interface estéreo do DaisySP original não são utilizados. `mix: 0`
preserva o sinal de entrada exatamente.

Não há alocação nem bloqueio no callback. A memória dos delays está
prealocada em cada instância, o bypass preserva o sinal e a ordem pode
ser modificada apenas antes de iniciar o processamento ao vivo.
Testes do efeito e parâmetros no CTest/TypeScript/Rust. Ainda não
avaliado em interface física, nem homologado para estéreo ou múltiplas
frequências de amostragem.

## VTTSUSTAIN: Pressure5 dynamics (Airwindows MIT)

`kind: "sustain"` is a file-free `schemaVersion: 1` native DSP node
with optional parameters `sustain` 0–100%, `speed` 0–100%,
`level` -18/+18 dB and `mix` 0–100%. Defaults are 65/25/0/100.
The Pressure5-inspired mu envelope uses the original interleaved A/B
compressor and program-dependent speed. Its original 24 kHz anti-ultrasonic
biquads are bypassed at the current 48 kHz rate, as upstream does.
VST, dithering and the ClipOnly2 sample delay were deliberately omitted;
a smooth, zero-latency peak ceiling protects the wet signal. At 0% Mix,
the pedal is a true dry passthrough.

The `Pressure5` name is used only for source attribution, not the visual
pedal's brand. This is an adapted dynamics core, not the complete plugin.
The prior visual-only `attack` knob has no equivalent Pressure5 control:
old presets retain Sustain and Level but default Speed to 25%.
Tests: `ctest --test-dir engine/build --output-on-failure` includes
`sustain_airwindows_pressure_envelope_and_bypass`. Hardware A/B,
noise amplification and latency still require verification.

## VTT Compressor Smooth: Airwindows ButterComp2

The VTTRIG stompbox is only the UI. The sound uses a native C++20
[Airwindows ButterComp2](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/ButterComp2/ButterComp2Proc.cpp)
adaptation (MIT). It is **not** a generic threshold/ratio compressor:
the original DSP has **Compress** (0–100%), **Output** (0–200%) and
**Dry/Wet** (0–100%), with defaults 35%, 100%, 100%, respectively.
These three controls are real and saved per instance.

The `schemaVersion: 1` native chain supports `kind: "compressor"` with
no `resource` and a `parameters` map with those three keys. Compressor,
Gate, NAM and IR can be freely repeated/reordered and independently bypassed.
The A/B bipolar detector and its signal-dependent recovery are retained from
the original algorithm; there is no additional lookahead or VST/JUCE dependency.
The algorithm is implemented for the current **mono, 48 kHz** audio path.

Before this integration, Compressor's *Threshold, Ratio, Attack, Release*
controls were **visual-only**. They do not exist in the original ButterComp2
core and were intentionally replaced by actual source controls. Old presets
remain loadable, but historic visual-only compressor controls fall back
to the new Smooth defaults rather than misleadingly driving an unrelated
algorithm. A future **Transparent/VCA** mode can offer real threshold, ratio,
attack and release as a separate algorithm.

Effects and bypass changes still take effect only after **Stop / Start**,
as in the current audio pipeline. CTest
`compressor_airwindows_smooth_and_bypass` checks transparency at Compress=0,
real change at Compress>0, output/mix, silence and block independence.
A/B listening and CPU profiling with a real guitar/interface remain pending.
License: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## VTTGATE: open-source audio effect (TONE3000 NoiseGate)

**Real native DSP, not merely a visual pedal.** The VTTRIG pedal chassis is
a presentation component; the audio is computed by a C++20 algorithm
adapted from TONE3000's MIT-licensed
[`NoiseGate.h`](https://github.com/tone-3000/tone3000-plugin/blob/main/plugin/include/NoiseGate.h).
JUCE types were removed; the algorithm runs in the shared `MonoChain` on
Windows and Linux. License and attribution: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The native manifest accepts `kind: "gate"` with **no** `resource` and
the optional `parameters` below:

| Parameter | Range | Default | Meaning |
|---|---:|---:|---|
| `threshold` | -100..0 dB | -80 dB | Open threshold; close threshold is 5 dB lower |
| `release` | 5..500 ms | 50 ms | Smooth gain closing |
| `hold` | 0..200 ms | 20 ms | How long to remain open below the close threshold |
| `range` | 20..80 dB | 80 dB | Closed attenuation / expander floor |

The gate uses a band-passed sidechain, fast envelope follower, 5 dB
hysteresis, configurable hold and a smooth cubic downward expander. It does
not introduce lookahead latency. There can be multiple gate instances
anywhere in the user-controlled chain, and each can be bypassed. As in PR #15,
parameters/order/bypass are applied at **Start**; live changes still require
**Stop / Start**. Other NAM and IR knobs remain visually configured but not
mapped to audio DSP.

CTest `noise_gate_envelope_hold_and_bypass` checks audible-path signal,
attenuation, hold, independent instances and bypass. Manifest and UI tests
cover malformed values, missing resources and exact source order. As always,
passing CI is not the same as a quality/latency test with a real guitar.


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
(`delay`, `reverb`) are
**rejected explicitly** even if disabled; the engine does not silently
pretend to apply them. Version and malformed parameters are rejected.
Parameters are currently **validated only, not applied** to NAM/IR audio:
gain, mix and control automation will be implemented separately.

The React pedalboard can already create ordered snapshots, and an optional
per-instance resource map can be supplied to `createSignalChainSnapshot()`.
It **does not yet manage file paths or send the snapshots to the audio
process**. Tauri UI and the JACK engine are still independent. Existing
legacy `--nam ... --ir ... --bypass` CLI remains supported.

## PR #9: shared native NAM/IR core + offline renderer on Windows and Linux

The NAM model loader and block chain are now in
[`src/nam_processing.hpp`](src/nam_processing.hpp), **without JACK
headers**. Both `vttrig-nam-jack` (Linux only) and the new
`vttrig-nam-offline` (Windows/Linux) use the same pinned NeuralAmpModelerCore,
same 48 kHz model preparation and identical ordered `MonoChain`.

**This is a genuinely portable DSP processing path, but it is *offline*.**
It does not access Windows audio interfaces, play sound live, run the React
app or introduce WASAPI/ASIO. Those host integrations are subsequent work.

### Build offline processor

Linux with installed JACK headers:

```bash
cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON
cmake --build engine/build --config Release --parallel 2
ctest --test-dir engine/build -C Release --output-on-failure
./engine/build/vttrig-nam-offline --help
```

Windows using Visual Studio 2022, CMake, Git and MSVC:

```powershell
cmake -S engine -B engine/build -DBUILD_TESTING=ON
cmake --build engine/build --config Release --parallel 2
ctest --test-dir engine/build -C Release --output-on-failure
.\engine\build\Release\vttrig-nam-offline.exe --help
```

On Windows, this project **does not require JACK** to compile the offline
processor. GitHub Actions validates the same C++ with both toolchains and
publishes `VTTRIG-NAM-Offline-Windows-x64` and
`VTTRIG-NAM-Offline-Linux-x64` as standalone command-line builds.
These are **not** part of the Tauri installer yet.

### Render an actual NAM chain to WAV

Record or export a **mono 48 kHz** dry guitar file `dry.wav` (PCM16 or
IEEE float32). Create a versioned JSON chain. The `nodes` array is the
user's true DSP order, and repeated effects keep separate IDs and bypass
states:

```json
{
  "schemaVersion": 1,
  "nodes": [
    {
      "id": "drive-1", "kind": "drive", "enabled": true,
      "parameters": {}, "resource": {"path": "models/drive.nam"}
    },
    {
      "id": "amp-1", "kind": "amp", "enabled": true,
      "parameters": {}, "resource": {"path": "models/amp.nam"}
    },
    {
      "id": "cab-1", "kind": "cabinet", "enabled": true,
      "parameters": {}, "resource": {"path": "irs/cab.wav"}
    }
  ]
}
```

```bash
vttrig-nam-offline --validate-chain-json rig.json
vttrig-nam-offline --chain-json rig.json --input dry.wav --output processed.wav

# Diagnostic audio roundtrip WITHOUT any model; for testing WAV I/O only:
vttrig-nam-offline --passthrough --input dry.wav --output passthrough.wav
```

Input: **mono 48 kHz PCM16/float32 WAV**; output: **mono 48 kHz float32
WAV**, finite samples safely clamped to ±1. The renderer processes 128-frame
blocks including the final short block. Very large inputs (over ~128 MiB
sample data) and unsupported channels/rates/formats fail explicitly;
no implicit resampling or stereo downmixing. **No prerecorded proprietary
NAM captures are bundled.** Supply compatible local, legitimately obtained
models and IRs.

### Validation limits

The portable CTest suite protects WAV data integrity, PCM16/float32 reading,
mono/48 kHz invariants, missing/malformed files, order and bypass behavior
using synthetic processors. The CLI help and manifest validation require
no audio device.

This alone does **not** prove A2 Lite/Full compatibility for every real
capture, DSP tone matching, seamless graph swaps, low latency, stereo, or
live input on Windows. The future live Windows backend must adopt prepared
graphs and meet the same callback-safety rules as JACK. All model loads,
WAV I/O and graph construction here happen outside any realtime callback.

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
  delay and reverb are **pending**.
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

## Live sidecar for VTTRIG (PR #11)

The `vttrig-nam-live` executable accepts `--chain-json` with a schemaVersion
1 chain (each node has id, kind amp/drive/cabinet, enabled, parameters and
resource.path). All models are loaded and Reset(48000, 8192) before writing a
single byte `R` handshake on stdout. After the handshake, stdin/stdout are
reserved exclusively for blocks of **128 mono little-endian float32 samples**
(512 bytes), with exactly one output block per input block. Errors go to
stderr; no normal diagnostic output is mixed with binary PCM.

The Rust CPAL host uses a worker thread with blocking stdin/stdout pipes,
isolated from SPSC queues feeding the audio callbacks. This prototype has
nonzero buffering and no hardware latency guarantee. The standalone stream
test uses a synthetic one-tap cabinet impulse response and checks bypass,
active processing, invalid manifest behavior and finite samples.

`-DVTTRIG_BUILD_JACK=OFF` permits compiling the sidecar on Linux without
requiring JACK headers. Linux/JACK remains available by default for its
separate host target. The Tauri workflows stage the sidecar with the correct
target-triple suffix required by externalBin bundling on Windows and Linux.
