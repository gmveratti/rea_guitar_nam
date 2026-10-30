import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPedal } from "./pedals";
import { loadPresets, savePresets, type Preset } from "./presets";

describe("presets: never silently discard saved configurations (issue #29)", () => {
  let stored: Map<string, string>;
  beforeEach(() => {
    stored = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
      clear: () => { stored.clear(); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const makePresets = (count: number): Preset[] =>
    Array.from({ length: count }, (_, n) => ({
      id: `preset-${n + 1}`,
      name: `Rig ${n + 1}`,
      chain: [createPedal("chorus")],
      ampPath: `/models/amp-${n + 1}.nam`,
      ampPowered: n % 2 === 0,
    }));

  it.each([99, 100, 101, 250])("roundtrips all %i presets with no data loss", count => {
    const input = makePresets(count);
    expect(savePresets(input)).toBe(true);
    const loaded = loadPresets();
    expect(loaded).toHaveLength(count);
    expect(loaded.map(p => p.id)).toEqual(input.map(p => p.id));
    expect(loaded.at(-1)?.ampPath).toBe(`/models/amp-${count}.nam`);
    expect(savePresets(loaded)).toBe(true);
    const reloaded = loadPresets();
    expect(reloaded).toHaveLength(count);
    expect(reloaded[0].name).toBe("Rig 1");
    expect(reloaded[count - 1].name).toBe(`Rig ${count}`);
  });

  it("does not lose the last preset when updating an earlier one", () => {
    expect(savePresets(makePresets(101))).toBe(true);
    const existing = loadPresets();
    const updated = existing.map(p => p.id === "preset-1" ? { ...p, name: "Modificado" } : p);
    expect(savePresets(updated)).toBe(true);
    const saved = loadPresets();
    expect(saved).toHaveLength(101);
    expect(saved[0].name).toBe("Modificado");
    expect(saved[100].name).toBe("Rig 101");
  });

  it("reports storage quota failures without incorrectly declaring success", () => {
    const data = makePresets(101);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => { throw new Error("QuotaExceededError"); },
    });
    expect(savePresets(data)).toBe(false);
  });
});
