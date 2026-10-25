import { describe, expect, it } from "vitest";
import { classifyNamFilename, humanizeModelName } from "./ampSkins";

describe("NAM amplifier visual classification", () => {
  it.each([
    ["Marshall_JCM800_HotRod_A2.nam", "british"],
    ["JTM45_Lead.nam", "british"],
    ["Fender_Twin_Reverb_01.nam", "american"],
    ["Hiwatt_DR103_Signature.nam", "stadium"],
    ["VOX_AC30_TopBoost.nam", "chime"],
    ["Mesa_Dual_Rectifier_A2.nam", "modern"],
    ["Friedman_Brown_Eye.nam", "boutique"],
    ["amp_unknown_123.nam", "generic"],
  ] as const)("classifies %s as %s", (filename, expected) => {
    expect(classifyNamFilename(filename).id).toBe(expected);
  });

  it("takes user override over guessed matching", () => {
    expect(classifyNamFilename("Marshall_JCM800.nam", "stadium").id).toBe("stadium");
    expect(classifyNamFilename("Marshall_JCM800.nam", "stadium").match).toBe("manual");
  });

  it("does not mistake generic CUSTOM for hiwatt", () => {
    expect(classifyNamFilename("custom_amp.nam").id).toBe("generic");
  });

  it("shows readable names without changing file content", () => {
    expect(humanizeModelName("models/JCM800_Custom_A2.nam")).toBe("JCM800 Custom A2");
  });
});
