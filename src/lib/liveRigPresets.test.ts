import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPedal } from "./pedals";
import { buildLiveBoardSnapshot } from "./liveRig";
import { loadDraft, loadDraftVisual, loadLegacyDraftAmpPath, loadPresets, saveDraft, saveDraftVisual, savePresets, type Preset } from "./presets";

describe("migrate legacy VTTAMP into separate main amplifier", () => {
  let data: Map<string, string>;
  beforeEach(() => {
    data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
      removeItem: (key: string) => { data.delete(key); },
      clear: () => { data.clear(); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the actual NAM path, bypass and order of effects from an old preset", () => {
    const amp = createPedal("amp"), drive = createPedal("drive"), ir = createPedal("cabinet");
    const delay = createPedal("delay");
    const preset: Preset = {
      id: "legacy", name: "Old A2", chain: [delay, ir, amp, drive],
      modelName: "Hiwatt_A2.nam", ampFamily: "stadium", ampPowered: false,
      resources: { [amp.id]: "/models/Hiwatt_A2.NAM", [ir.id]: "/irs/cab.wav", [drive.id]: "/models/drive.nam" },
    };
    expect(savePresets([preset])).toBe(true);
    const loaded = loadPresets()[0];
    expect(loaded.chain.map(p => p.kind)).toEqual(["delay"]);
    expect(loaded.ampPath).toBe("/models/Hiwatt_A2.NAM");
    expect(loaded.ampPowered).toBe(false);
    expect(loaded.modelName).toBe("Hiwatt_A2.nam");
    expect(buildLiveBoardSnapshot(loaded.chain, loaded.ampPath, loaded.ampPowered)
      .nodes.map(n => [n.kind, n.enabled])).toEqual([["delay", true], ["amp", false]]);
  });

  it("migrates an old draft model without introducing an amp pedal", () => {
    const amp = createPedal("amp"), chorus = createPedal("chorus");
    saveDraft([amp, chorus]);
    data.set("rea-guitar-nam:v1:draft-resources", JSON.stringify({ [amp.id]: "/a.nam" }));
    expect(loadLegacyDraftAmpPath()).toBe("/a.nam");
    expect(loadDraft().map(x => x.kind)).toEqual(["chorus"]);
  });

  it("clearing the dedicated path stays cleared instead of resurrecting legacy storage", () => {
    const amp = createPedal("amp");
    saveDraft([amp]);
    data.set("rea-guitar-nam:v1:draft-resources", JSON.stringify({ [amp.id]: "/old.nam" }));
    expect(saveDraftVisual({ modelName: "", ampFamily: "auto", ampPath: "" })).toBe(true);
    const draft = loadDraftVisual();
    expect(draft.ampPath).toBe("");
    expect(draft.ampPath !== undefined ? draft.ampPath : loadLegacyDraftAmpPath()).toBe("");
  });

  it("new presets keep the main model without creating a pedal", () => {
    const gate = createPedal("gate");
    expect(savePresets([{
      id: "new", name: "New A2", chain: [gate], ampPath: "/models/amp.nam",
      ampPowered: true, modelName: "amp.nam",
    }])).toBe(true);
    const loaded = loadPresets()[0];
    expect(loaded.ampPath).toBe("/models/amp.nam");
    expect(loaded.chain.map(p => p.kind)).toEqual(["gate"]);
    expect(buildLiveBoardSnapshot(loaded.chain, loaded.ampPath)
      .nodes.map(n => n.kind)).toEqual(["gate", "amp"]);
  });

  it("does not use demo names as valid native models", () => {
    expect(savePresets([{ id: "preview", name: "Preview", chain: [], modelName: "demo.nam" }])).toBe(true);
    const preset = loadPresets()[0];
    expect(preset.ampPath).toBe("");
    expect(() => buildLiveBoardSnapshot(preset.chain, preset.ampPath)).toThrow();
  });
});
