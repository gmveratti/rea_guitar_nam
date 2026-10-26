import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUDIO_SETTINGS, loadAudioSettings, parseAudioSettings, saveAudioSettings,
} from "./audioSettings";

describe("persistent live audio setup", () => {
  it("restores a complete ordered NAM/IR setup without autostarting audio", () => {
    const settings = {
      version: 1, mode: "wet", bufferFrames: 128, inputChannel: 1,
      ampPath: "C:\\NAM\\crunch.NAM", cabPath: "/home/music/ir/Cab.WAV",
      irBeforeAmp: true, bypassAmp: true, bypassCab: false,
    };
    expect(parseAudioSettings(settings)).toEqual(settings);
    expect(parseAudioSettings(settings)).not.toHaveProperty("running");
  });

  it("rejects older or unrecognized versions safely", () => {
    expect(parseAudioSettings({ version: 2, mode: "wet", ampPath: "/a.nam" }))
      .toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it("sanitizes malformed paths, buffers and input channels without losing valid flags", () => {
    expect(parseAudioSettings({
      version: 1, mode: "wet", bufferFrames: 13, inputChannel: -9,
      ampPath: "../bad.exe", cabPath: "/tmp/ir.wav\u0000",
      irBeforeAmp: true, bypassAmp: "yes", bypassCab: true,
    })).toEqual({
      ...DEFAULT_AUDIO_SETTINGS,
      mode: "wet",
      irBeforeAmp: true,
      bypassCab: true,
    });
  });

  it("persists and reloads a setup from local-only storage", () => {
    const items = new Map<string, string>();
    const store = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => { items.set(key, value); },
    };
    const config = { ...DEFAULT_AUDIO_SETTINGS, mode: "wet" as const, ampPath: "/tmp/test.nam" };
    expect(saveAudioSettings(config, store)).toBe(true);
    expect(loadAudioSettings(store)).toEqual(config);
  });

  it("never throws if local storage is blocked or corrupted", () => {
    const blocked = {
      getItem: (): string | null => { throw new Error("disabled"); },
      setItem: (): void => { throw new Error("disabled"); },
    };
    expect(loadAudioSettings(blocked)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(saveAudioSettings(DEFAULT_AUDIO_SETTINGS, blocked)).toBe(false);
    expect(loadAudioSettings({ getItem: () => "{broken", setItem: () => {} }))
      .toEqual(DEFAULT_AUDIO_SETTINGS);
  });
});
