import { describe, expect, it } from "vitest";
import { createPedal } from "./pedals";
import { buildLiveBoardSnapshot } from "./liveRig";
import { loadDraftResources, loadPresets, saveDraftResources, savePresets, type Preset } from "./presets";

describe("PR15: native resource presets and draft migration", () => {
  it("saves and reloads ordered preset with model IDs, paths and bypass", () => {
    const amp = createPedal("amp"), ir = createPedal("cabinet");
    ir.enabled = false;
    const preset: Preset = {
      id: "test", name: "IR first", chain: [ir, amp], modelName: "Custom.nam",
      ampFamily: "modern", ampPowered: false,
      resources: { [amp.id]: "/models/hi.NAM", [ir.id]: "/ir/cab.wav" },
    };
    expect(savePresets([preset])).toBe(true);
    const loaded = loadPresets()[0];
    expect(loaded.resources).toEqual(preset.resources);
    expect(loaded.ampPowered).toBe(false);
    expect(buildLiveBoardSnapshot(loaded.chain, loaded.resources ?? {}, loaded.ampPowered)
      .nodes.map(n => [n.id, n.enabled])).toEqual([[ir.id, false], [amp.id, false]]);
  });

  it("migrates a legacy preset without resource paths or power setting", () => {
    const amp = createPedal("amp");
    expect(savePresets([{ id: "legacy", name: "Legacy", chain: [amp], modelName: "demo.nam" }])).toBe(true);
    expect(loadPresets()[0].resources).toEqual({});
    expect(loadPresets()[0].ampPowered).toBe(true);
  });

  it("drops orphan mappings after a pedal is deleted or reordered", () => {
    const a = createPedal("amp"), b = createPedal("cabinet");
    expect(saveDraftResources({ [a.id]: "/a.nam", [b.id]: "/b.wav" }, [a, b])).toBe(true);
    expect(loadDraftResources([b])).toEqual({ [b.id]: "/b.wav" });
  });
});
