import { describe, expect, it } from "vitest";
import { clampValue, createPedal, movePedal, validateChain, PEDALS } from "./pedals";

describe("pedal chain", () => {
  it("reorders immutably and preserves pedal IDs", () => {
    const a = createPedal("gate");
    const b = createPedal("amp");
    const c = createPedal("delay");
    const chain = [a, b, c];
    const moved = movePedal(chain, a.id, 2);
    expect(moved.map((p) => p.id)).toEqual([b.id, c.id, a.id]);
    expect(chain.map((p) => p.id)).toEqual([a.id, b.id, c.id]);
  });

  it("ignores an unknown source ID", () => {
    const chain = [createPedal("amp")];
    expect(movePedal(chain, "unknown", 0)).toBe(chain);
  });

  it("clamps invalid or out-of-range parameters", () => {
    const p = PEDALS.reverb.parameters[0];
    expect(clampValue(200, p)).toBe(100);
    expect(clampValue(-100, p)).toBe(0);
    expect(clampValue(Number.NaN, p)).toBe(p.defaultValue);
  });

  it("rejects malformed presets without running unsafe code", () => {
    expect(validateChain([{ id: "x", kind: "invalid", enabled: true, values: {} }])).toBeNull();
    expect(validateChain([{ id: "x", kind: "amp", enabled: true, values: {} },
                          { id: "x", kind: "amp", enabled: true, values: {} }])).toBeNull();
    expect(validateChain("not an array")).toBeNull();
    // Prototype properties must not masquerade as supported pedal kinds.
    expect(validateChain([{ id: "x", kind: "constructor", enabled: true, values: {} }])).toBeNull();
    expect(validateChain([{ id: "y", kind: "__proto__", enabled: true, values: {} }])).toBeNull();
  });

  it("migrates visual-only legacy compressor knobs to real ButterComp2 defaults", () => {
    const legacy = [{
      id: "compressor-old", kind: "compressor", enabled: false,
      values: { threshold: -25, ratio: 8, attack: 15, release: 90 },
    }];
    const migrated = validateChain(legacy);
    expect(migrated?.[0].id).toBe("compressor-old");
    expect(migrated?.[0].enabled).toBe(false);
    expect(migrated?.[0].values).toEqual({ compress: 35, output: 100, mix: 100 });
    const fresh = createPedal("compressor");
    fresh.values.compress = 75;
    fresh.values.mix = 45;
    expect(validateChain([fresh])?.[0].values).toEqual(fresh.values);
  });

  it("restores valid parameters from a saved chain", () => {
    const raw = [{ id: "amp-1", kind: "amp", enabled: true, values: { input: 45, output: -4 } }];
    const parsed = validateChain(raw);
    expect(parsed).not.toBeNull();
    expect(parsed![0].values.input).toBe(24);
    expect(parsed![0].values.output).toBe(-4);
  });
});
