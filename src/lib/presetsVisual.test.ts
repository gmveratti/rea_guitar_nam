import { describe, expect, it } from "vitest";
import { loadDraftVisual, parseDraftVisual, saveDraftVisual } from "./presets";

describe("legacy visual rig draft", () => {
  it("parses a visual amp without treating a demo filename as a DSP resource", () => {
    expect(parseDraftVisual({ modelName: "My_AMP.NAM", ampFamily: "american" }))
      .toEqual({ modelName: "My_AMP.NAM", ampFamily: "american" });
  });

  it("rejects invalid family and corrupted drafts with safe defaults", () => {
    expect(parseDraftVisual({ modelName: 123, ampFamily: "unknown" }))
      .toEqual({ modelName: "", ampFamily: "british" });
    expect(parseDraftVisual(null))
      .toEqual({ modelName: "", ampFamily: "british" });
  });

  it("stores and restores the visual draft without changing saved presets", () => {
    const memory = new Map<string, string>();
    const store = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
    };
    expect(saveDraftVisual({ modelName: "Clean.nam", ampFamily: "auto" }, store)).toBe(true);
    expect(loadDraftVisual(store)).toEqual({ modelName: "Clean.nam", ampFamily: "auto" });
  });
});
