# Rea Guitar NAM

A native, open-source guitar-effects rack built with **Tauri 2**, designed first for Fedora/Linux and later for Windows/macOS.

## Vision

A responsive pedalboard with drag-and-drop signal chains, interactive controls, editable presets, and a low-latency audio engine. Amp and overdrive tones come from **Neural Amp Modeler** captures; chorus, delay, and reverb use properly licensed open-source DSP.

## Implementation status

**Research and project initialization.** This repository does **not yet process live audio**. The planned first development branch introduces a UI prototype and a Tauri shell. The real-time DSP and device I/O are separate follow-up milestones. UI meters are not to be presented as live audio until connected to a verified engine.

## DSP candidates (licenses must be preserved)

- [NeuralAmpModelerCore](https://github.com/sdatkinson/NeuralAmpModelerCore) — MIT, amp/pedal captures.
- [CloudSeedCore](https://github.com/GhostNoteAudio/CloudSeedCore) — MIT, lush modulated reverb.
- [Airwindows](https://github.com/airwindows/airwindows) — MIT, TapeDelay2/StereoChorus and other effects.
- [Dragonfly Reverb](https://github.com/michaelwillis/dragonfly-reverb) — GPL-3.0; sound reference or separately distributed compatible derivative, **not** copied into MIT-only source.
- [LSP Plugins](https://github.com/lsp-plugins/lsp-plugins) — LGPL-3.0; optional reference and potential external plugin host, under its own conditions.

No third-party DSP is vendored yet. Each upstream has its own copyright and licensing obligations.

## Planned architecture

```text
Tauri 2 + React + TypeScript
  └─ visual pedalboard, presets, library and non-realtime controls
Rust controller (Tauri commands)
  ├─ persistence / preset management
  ├─ command queue to audio engine
  └─ telemetry snapshots to UI
Native real-time DSP engine (separate library/process boundary)
  ├─ PipeWire/JACK backend (Linux)
  ├─ reorderable audio chain, bypass and smooth parameters
  ├─ C++ NAM core through explicit C ABI
  ├─ convolution cabinet IR + native DSP for effects
  └─ RT-safe processing (no allocation/locks/logging in audio callback)
```

**REAPER integration:** the first version is a standalone application routable with PipeWire/JACK. A native CLAP/VST3 plugin is a later target and requires a separate plugin host entry point; Tauri itself is not a VST.

## Roadmap

1. UI and UX prototype: reorder, add/remove and bypass pedals; adjust settings, save/load presets.
2. Testable audio-core contracts: processing graph and effect metadata.
3. Native JACK/PipeWire low-latency capture/playback and hardware monitoring.
4. NAM model loading, sample-rate handling, cabinet IR and input/headroom controls.
5. Integrate MIT-licensed chorus, delay and reverb code with attribution and DSP testing.
6. Cross-platform release packaging and REAPER-plugin workstream.

## Attribution

Project code remains independently authored unless specifically credited. Keep all copyright notices from imported source code and do not imply association with NAM, Airwindows, or Ghost Note Audio.
