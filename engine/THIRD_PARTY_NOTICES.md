# Third-party notices (native DSP)

## Pinned NeuralAmpModelerCore and transitive sources

The offline/live NAM processors embed NeuralAmpModelerCore, pinned in
`engine/CMakeLists.txt` to commit
`0b3d3c97b0859a3a8c92a8628c4dd89a25eb5842` by Steven Atkinson.
Original MIT terms are shipped in `engine/NAM_CORE_LICENSE.txt`
and in the release archives. Source:
https://github.com/sdatkinson/NeuralAmpModelerCore/tree/0b3d3c97b0859a3a8c92a8628c4dd89a25eb5842

NeuralAmpModelerCore references Eigen, nlohmann/json and AudioDSPTools.
Their upstream copyright/license terms remain applicable independently;
this document describes the DSP adaptations and does not replace those
third-party licenses.

NeuralAmpModelerCore embeds/transitively uses three additional pinned libraries.
The copies distributed in `engine/third_party_licenses/` are from these
specific upstream revisions, and are included with installed Tauri resources
and standalone ZIPs:

- Eigen submodule `bc3b39870ecb690a623a3f49149a358b95c5781d`:
  MPL-2.0 plus its upstream COPYING.README, COPYING.BSD,
  COPYING.APACHE, and COPYING.MINPACK supplemental notices.
  Source: https://gitlab.com/libeigen/eigen
- nlohmann/json `json.hpp` header **3.12.0** copied in pinned NAM Core:
  MIT copyright (c) 2013-2025 Niels Lohmann.
  Source: https://github.com/nlohmann/json/tree/v3.12.0
- AudioDSPTools submodule `0827c6c2fc0deced568536142ea86f189e0b98a1`:
  MIT copyright (c) 2023 Steven Atkinson.
  Source: https://github.com/sdatkinson/AudioDSPTools/tree/0827c6c2fc0deced568536142ea86f189e0b98a1

These files convey upstream terms; they do not claim algorithms originated with
VTTRIG. Review actual installer contents and source-availability obligations
before publishing a public release.

## VTTRIG original algorithms (not ports)

`engine/src/classic_delay.hpp` (VTTDELAY Classic) and
`engine/src/room_reverb.hpp` (VTTREVERB Room) are original VTTRIG
algorithms and are **not** Airwindows TapeDelay2 or CloudSeed ports.
Their attribution must not be confused with the adapted third-party
compressor, sustain, chorus or noise gate below.


## TONE3000 Plugin — Noise Gate

Source: https://github.com/tone-3000/tone3000-plugin/blob/main/plugin/include/NoiseGate.h

The VTTRIG VTTGATE algorithm in `engine/src/noise_gate.hpp` is adapted
from the TONE3000 Plugin `NoiseGate.h`, with JUCE data structures and math
helpers replaced by a standalone C++20 mono processor. The original detector
band-pass, envelope follower, hysteresis, hold, downward expander and gain
smoothing were retained. VTTRIG provides its own pedal chassis and UI.

Original copyright (c) 2026 TONE3000.

Licensed under the MIT License:

Copyright (c) 2026 TONE3000.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


## Airwindows — ButterComp2 compressor

Source: https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/ButterComp2/ButterComp2Proc.cpp

The VTTRIG VTT Compressor Smooth in `engine/src/butter_comp2.hpp`
adapts the 64-bit Airwindows ButterComp2 core to a mono, header-only
C++20 `MonoProcessor`. Its bipolar positive/negative detector, A/B
alternation, program-dependent release, and Compress/Output/Dry-Wet
controls retain the source algorithm. VST2 integration and stereo
duplication were removed; output dithering is omitted because the
VTTRIG internal chain processes float64 samples. All pedal artwork
and UI are original VTTRIG work.

Original copyright (c) 2016 Airwindows / Chris Johnson.
Root license copyright (c) 2018 Chris Johnson.

Licensed under the MIT License:

Copyright (c) 2018 Chris Johnson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Airwindows — Pressure5 dynamics for VTTSUSTAIN

Source: https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Pressure5/Pressure5Proc.cpp

VTTRIG's `engine/src/pressure_sustain.hpp` adapts the Airwindows Pressure5
mono mu-compression core. It keeps the original non-linear Pressure/Speed
mapping, A/B interleaved mu envelope and positive Mewiness branch at original
C=1.0 and D=0.5 defaults. Output is an independent decibel trim. The VST2
adapter, stereo paths, 64-bit dither and ClipOnly2 delayed hard-clipping stage
are not copied. At the current 48 kHz rate, the upstream 24 kHz biquads are
bypassed as well. VTTRIG substitutes a zero-latency soft peak ceiling. This
adaptation is not a bit-exact reproduction of the complete Pressure5 plugin.

Original copyright (c) 2016 Airwindows / Chris Johnson.
Root license copyright (c) 2018 Chris Johnson.

MIT License

Copyright (c) 2018 Chris Johnson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## DaisySP ChorusEngine — VTTCHORUS Classic mono

Sources:
- https://github.com/daisyaudio/DaisySP/blob/master/Source/Effects/chorus.cpp
- https://github.com/daisyaudio/DaisySP/blob/master/Source/Effects/chorus.h
- https://github.com/daisyaudio/DaisySP/blob/master/Source/Utility/delayline.h

The VTTRIG C++20 mono implementation in `engine/src/daisy_chorus.hpp`
adapts the DaisySP ChorusEngine's triangle LFO, modulated fractional
delay (linear interpolation), and default 0.2 feedback, with two
independent voices. Its stereo wrapper and panning are deliberately
not ported: the current VTTRIG audio chain is mono. VTTRIG owns all
pedal chassis, labels, artwork and UI. This is an adaptation, not a
bit-identical copy of the complete DaisySP Chorus.

DaisySP copyright (c) 2020 Electrosmith, Corp.
Licensed under the MIT license:

Copyright (c) 2020 Electrosmith, Corp.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Other third-party dependencies of VTTRIG have their own respective licenses;
this file does not supersede or remove those obligations.
