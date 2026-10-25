# VTTRIG NAM JACK experimental engine

This is the **first working-target Linux sound engine**, standalone from Tauri.
It is based on the same MIT NAM core used by Gateway. It is **not Gateway itself**.
The GUI at the repository root remains a visual prototype and is not yet wired to this process.

## Features and limits

- Loads one **mono NAM `.nam`** and processes live JACK audio with the official NeuralAmpModelerCore.
- Uses a pinned NAM Core **v0.6.0** source commit `0b3d3c97b0859a3a8c92a8628c4dd89a25eb5842`.
- Linux/PipeWire-JACK, 48 kHz required. Prepares and prewarms the DSP before the JACK realtime callback.
- Single in/out, no IR, no reverb, no chorus, no compressor, no model switching or UI synchronization yet.
- Stops with a meaningful error on unsupported input and fails closed rather than attempting unsafe resampling.
- JACK ports are deliberately **not autoconnected**. Make the physical capture/playback connections in qpwgraph or your routing app.
- Assumes NAM core `process` is safe for the audio callback after `Reset` / prewarm. Validate through RT instrumentation before live use.
- Output is clipped to ±1.0 to prevent dangerously large values; start with interface/monitor gain low.
- No external software licenses have been changed. Core remains MIT; retain third-party licenses.

## Fedora dependencies

Install Fedora packages that provide `cmake`, `ninja`, `pkgconf-pkg-config`,
`gcc-c++`, `git`, and JACK headers (`pipewire-jack-audio-connection-kit-devel`
or the appropriate `jack-audio-connection-kit-devel` provider depending on Fedora).
The PipeWire-JACK runtime must be active; Fedora can route it through PipeWire.

```bash
cmake -S engine -B engine/build -GNinja -DCMAKE_BUILD_TYPE=Release
cmake --build engine/build -j2
ctest --test-dir engine/build --output-on-failure
./engine/build/vttrig-nam-jack --help
./engine/build/vttrig-nam-jack /path/to/A2-capture.nam
```

Use `qpwgraph` (or qjackctl) to patch your interface's input into
`VTTRIG_NAM:input` and `VTTRIG_NAM:output` to your interface output.
**Start with your hardware monitor volume low to avoid feedback or hearing damage.**

## Validation checklist

1. CI builds on Ubuntu Linux and runs CLI help without an audio device.
2. Manually load known A2 Lite and Full NAM captures and verify no crash.
3. Record the loopback signal and compare against official Gateway/TONE3000 for a matching capture and gain.
4. Instrument xruns and latency under 64/128/256 buffers; monitor CPU and memory.
5. Move to a separate state-swap control worker to support model changes and the visual Tauri UI.
6. Implement native IR, pedal DSP, stereo and CLAP/VST3 host targets after callback correctness.

This proof-of-concept does **not** guarantee artifact or plugin compatibility and has
not been tested on an actual Fedora interface until confirmed manually.
