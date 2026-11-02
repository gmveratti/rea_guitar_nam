from __future__ import annotations

import json
import math
import struct
import subprocess
import sys
import tempfile
import wave
from pathlib import Path


def render(binary: str, nodes: list[dict], samples: list[float]) -> list[float]:
    # Match Rust/Tauri: real UTF-8 JSON, not ASCII-escaped paths that can hide
    # the Windows wide-command-line and filesystem conversion regressions.
    chain = json.dumps({'schemaVersion': 1, 'nodes': nodes},
                       separators=(',', ':'), ensure_ascii=False)
    result = subprocess.run(
        [binary, '--chain-json', chain],
        input=struct.pack(f'<{len(samples)}f', *samples),
        capture_output=True, timeout=30,
    )
    native_error = result.stderr.decode('utf-8', errors='replace')
    assert result.returncode == 0, f'Native exit {result.returncode}: {native_error}'
    assert result.stdout[:1] == b'R', f'Expected READY handshake: {native_error}'
    assert len(result.stdout) == 1 + len(samples) * 4, len(result.stdout)
    actual = list(struct.unpack(f'<{len(samples)}f', result.stdout[1:]))
    assert all(math.isfinite(sample) for sample in actual)
    return actual


def model_node(path: Path) -> dict:
    return {'id': 'amp-1', 'kind': 'amp', 'enabled': True,
            'parameters': {}, 'resource': {'path': str(path)}}


def run() -> None:
    binary = sys.argv[1]
    wave_model = Path(sys.argv[2])
    a2_model = Path(sys.argv[3])
    assert wave_model.is_file(), f'Pinned upstream WaveNet model missing: {wave_model}'
    assert a2_model.is_file(), f'Pinned upstream A2 model missing: {a2_model}'
    # Clearing the final model is a real dry graph, not a failed update that
    # leaves the previous amplifier audible. Empty MonoChain must be bit-exact.
    dry_signal = [-0.25, 0.0, 0.125, 0.5] * (128 * 8 // 4)
    dry = render(binary, [], dry_signal)
    assert struct.pack(f'<{len(dry)}f', *dry) == struct.pack(f'<{len(dry_signal)}f', *dry_signal)
    with tempfile.TemporaryDirectory() as temp:
        # This also reproduces filenames under localized Windows user folders.
        root = Path(temp) / 'Usuário' / 'Amplificação_日本語'
        root.mkdir(parents=True)
        impulse = root / 'Gabinete_IR.wav'
        with wave.open(str(impulse), 'wb') as file:
            file.setnchannels(1)
            file.setsampwidth(2)
            file.setframerate(48000)
            file.writeframes(struct.pack('<128h', 16384, *([0] * 127)))
        cab = {'id': 'cab-1', 'kind': 'cabinet', 'enabled': False,
               'parameters': {}, 'resource': {'path': str(impulse)}}
        samples = [0.25] + [0.0] * 127
        actual = render(binary, [cab], samples)
        assert max(abs(a - b) for a, b in zip(actual, samples)) < 1e-6, 'Bypass must preserve input'
        cab['enabled'] = True
        actual = render(binary, [cab], samples)
        assert max(abs(sample) for sample in actual) > 0.01, 'Active cabinet must return sound'
        assert max(abs(a - b) for a, b in zip(actual, samples)) > 0.01

        # Keep coverage for generic WaveNet registration in addition to the A2
        # fast paths. No private captures are committed: these files come from
        # the exact NAM Core revision already pinned by CMake.
        local_wave = root / 'WaveNet.nam'
        local_wave.write_bytes(wave_model.read_bytes())
        render(binary, [model_node(local_wave)], samples)

        # Exercise the real A2 container plus its 3-channel Lite and 8-channel
        # Full models through repeated binary stream blocks. These are load /
        # processing regressions, not timbre comparisons or hardware tests.
        container = json.loads(a2_model.read_text(encoding='utf-8'))
        tiers = container['config']['submodels']
        assert [tier['model']['config']['layers'][0]['channels'] for tier in tiers] == [3, 8]
        models = [('A2_container', container)] + [
            (f'A2_{name}', tier['model'])
            for name, tier in zip(('Lite', 'Full'), tiers)
        ]
        signal = [0.05 * math.sin(2 * math.pi * 223 * i / 48000)
                  for i in range(128 * 8)]
        for name, config in models:
            local_model = root / f'{name}.nam'
            local_model.write_text(json.dumps(config), encoding='utf-8')
            actual = render(binary, [model_node(local_model)], signal)
            assert max(abs(sample) for sample in actual) > 1e-8, f'{name} returned silence'
            assert max(abs(a - b) for a, b in zip(actual, signal)) > 1e-8, f'{name} did not process input'
            render(binary, [model_node(local_model), cab], signal)

        # Gain controls must affect audio, not merely survive JSON validation.
        # Every render starts the same pinned Full model from identical state.
        base_node = model_node(local_model)
        baseline = render(binary, [base_node], signal)
        output_node = model_node(local_model)
        output_node['parameters'] = {'output': 20 * math.log10(2)}
        output_boost = render(binary, [output_node], signal)
        tolerance = max(abs(sample) for sample in baseline) * 1e-5 + 1e-8
        assert max(abs(boost - 2 * dry) for boost, dry in zip(output_boost, baseline)) < tolerance, 'NAM output dB must scale processed audio'
        input_node = model_node(local_model)
        input_node['parameters'] = {'input': 20 * math.log10(2)}
        input_boost = render(binary, [input_node], signal)
        boosted_reference = render(binary, [base_node], [2 * sample for sample in signal])
        assert max(abs(a - b) for a, b in zip(input_boost, boosted_reference)) < tolerance, 'NAM input dB must apply before neural processing'
        assert max(abs(a - b) for a, b in zip(input_boost, baseline)) > 1e-8
        input_node['enabled'] = False
        bypass = render(binary, [input_node], signal)
        assert struct.pack(f'<{len(bypass)}f', *bypass) == struct.pack(f'<{len(signal)}f', *signal), 'Bypassed NAM must ignore input/output gain and preserve dry exactly'

        invalid = subprocess.run([binary, '--chain-json', '{bad}'],
                                 capture_output=True, timeout=10)
        assert invalid.returncode != 0 and not invalid.stdout.startswith(b'R')
        assert b'VTTRIG live DSP:' in invalid.stderr
        missing = json.dumps({'schemaVersion': 1, 'nodes': [model_node(root / 'missing.nam')]},
                             ensure_ascii=False)
        invalid = subprocess.run([binary, '--chain-json', missing],
                                 capture_output=True, timeout=10)
        assert invalid.returncode != 0 and not invalid.stdout.startswith(b'R')
        assert b'VTTRIG live DSP:' in invalid.stderr, 'Model failure must have a diagnostic'


if __name__ == '__main__':
    run()
