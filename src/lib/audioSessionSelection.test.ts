import { describe, expect, it } from "vitest";
import {
  EMPTY_AUDIO_SESSION_SELECTION, isAudioSessionSelectionValid,
  reconcileAudioSessionSelection, selectAudioHost, type AudioHost,
} from "./audioSessionSelection";

const hosts: AudioHost[] = [
  { id: "ALSA", inputs: [{ index: 0, name: "ALSA in", channels: 2, supportsMonitor: true }],
    outputs: [{ index: 0, name: "ALSA out", channels: 2, supportsMonitor: true }] },
  { id: "JACK",
    inputs: [{ index: 3, name: "Virtual", channels: 2, supportsMonitor: true },
             { index: 6, name: "USB guitar", channels: 2, supportsMonitor: true }],
    outputs: [{ index: 4, name: "Virtual", channels: 2, supportsMonitor: true },
              { index: 8, name: "USB phones", channels: 2, supportsMonitor: true }] },
];

describe("native audio session selection, issue #30", () => {
  it("chooses a usable default only on the first enumeration", () => {
    const first = reconcileAudioSessionSelection(EMPTY_AUDIO_SESSION_SELECTION, hosts);
    expect(first).toEqual({ hostId: "ALSA", inputIndex: "0", outputIndex: "0", inputChannel: 0 });
    expect(isAudioSessionSelectionValid(first, hosts)).toBe(true);
  });

  it("preserves JACK and non-default USB interfaces across view remounts/refresh", () => {
    const chosen = { hostId: "JACK", inputIndex: "6", outputIndex: "8", inputChannel: 1 };
    const refreshed = reconcileAudioSessionSelection(chosen, hosts);
    expect(refreshed).toBe(chosen);
    expect(isAudioSessionSelectionValid(refreshed, hosts)).toBe(true);
  });

  it("shows a disconnected device as invalid, never silently choosing another", () => {
    const chosen = { hostId: "JACK", inputIndex: "6", outputIndex: "8", inputChannel: 0 };
    const withoutUsb: AudioHost[] = hosts.map((host) => host.id === "JACK"
      ? { ...host, inputs: host.inputs.slice(0, 1) } : host);
    expect(reconcileAudioSessionSelection(chosen, withoutUsb)).toBe(chosen);
    expect(isAudioSessionSelectionValid(chosen, withoutUsb)).toBe(false);
    expect(reconcileAudioSessionSelection(chosen, hosts)).toBe(chosen);
  });

  it("keeps a missing backend selected but unavailable, until explicitly changed", () => {
    const chosen = { hostId: "JACK", inputIndex: "6", outputIndex: "8", inputChannel: 0 };
    expect(reconcileAudioSessionSelection(chosen, hosts.slice(0, 1))).toBe(chosen);
    expect(isAudioSessionSelectionValid(chosen, hosts.slice(0, 1))).toBe(false);
    expect(selectAudioHost(hosts, "ALSA")).toEqual({
      hostId: "ALSA", inputIndex: "0", outputIndex: "0", inputChannel: 0,
    });
  });

  it("displays the backend and indices of the actual running native session", () => {
    const actual = { hostId: "JACK", inputIndex: 6, outputIndex: 8, inputChannel: 1, bufferFrames: 128 };
    const restored = reconcileAudioSessionSelection(EMPTY_AUDIO_SESSION_SELECTION, hosts, actual);
    expect(restored).toEqual({ hostId: "JACK", inputIndex: "6", outputIndex: "8", inputChannel: 1 });
    expect(isAudioSessionSelectionValid(restored, hosts)).toBe(true);
  });
});
