from __future__ import annotations

import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import wave
from pathlib import Path


def run():
    binary = sys.argv[1]
    with tempfile.TemporaryDirectory() as temp:
        impulse = Path(temp) / 'cab.wav'
        with wave.open(str(impulse), 'wb') as file:
            file.setnchannels(1)
            file.setsampwidth(2)
            file.setframerate(48000)
            file.writeframes(struct.pack('<' + 'h' * 128, 16384, *([0] * 127)))
        nodes = [{'id': 'cab-1', 'kind': 'cabinet', 'enabled': False, 'parameters': {}, 'resource': {'path': str(impulse)}}]
        chain = json.dumps({'schemaVersion': 1, 'nodes': nodes}, separators=(',', ':'))
        process = subprocess.Popen([binary, '--chain-json', chain], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if process.stdout.read(1) != b'R':
            stderr = process.stderr.read().decode(errors='replace')
            raise AssertionError('Expected READY handshake; native error: ' + stderr)
        samples = [0.25] + [0.0] * 127
        out, err = process.communicate(struct.pack('<128f', *samples), timeout=15)
        assert process.returncode == 0, err.decode()
        assert len(out) == 512, len(out)
        actual = struct.unpack('<128f', out)
        assert all(math.isfinite(s) for s in actual)
        assert max(abs(a - b) for a,b in zip(actual, samples)) < 1e-6, 'Bypass must preserve input'
        nodes[0]['enabled'] = True
        chain = json.dumps({'schemaVersion': 1, 'nodes': nodes}, separators=(',', ':'))
        process = subprocess.Popen([binary, '--chain-json', chain], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert process.stdout.read(1) == b'R', 'Expected READY handshake for active impulse'
        out, err = process.communicate(struct.pack('<128f', *samples), timeout=15)
        assert process.returncode == 0, err.decode()
        assert len(out) == 512
        actual = struct.unpack('<128f', out)
        assert all(math.isfinite(s) for s in actual)
        assert max(abs(s) for s in actual) > 0.01, 'Active cabinet must return sound'
        invalid = subprocess.run([binary, '--chain-json', '{bad}'], capture_output=True, timeout=10)
        assert invalid.returncode != 0 and not invalid.stdout.startswith(b'R')


if __name__ == '__main__':
    run()
