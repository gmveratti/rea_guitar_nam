# Third-party notices (native DSP)

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

Other third-party dependencies of VTTRIG have their own respective licenses;
this file does not supersede or remove those obligations.
