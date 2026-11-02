import { describe, expect, it } from "vitest";
import valid from "../../engine/tests/fixtures/contracts/valid-file-free.json";
import empty from "../../engine/tests/fixtures/contracts/valid-empty.json";
import duplicate from "../../engine/tests/fixtures/contracts/invalid-duplicate-id.json";
import missingBypass from "../../engine/tests/fixtures/contracts/invalid-missing-enabled.json";
import invalidRange from "../../engine/tests/fixtures/contracts/invalid-parameter-range.json";
import invalidVersion from "../../engine/tests/fixtures/contracts/invalid-version.json";
import { isNativeManifestV1 } from "./manifestContract";
import { buildLiveBoardSnapshot } from "./liveRig";
import { type PedalInstance, type PedalKind } from "./pedals";

describe("v1 native Rig contract shared by UI, Rust and C++ (#34)", () => {
  it("accepts an empty rig as intentional dry passthrough", () => {
    expect(isNativeManifestV1(empty)).toBe(true);
    expect(buildLiveBoardSnapshot([])).toMatchObject(empty);
  });
  it("preserves order, duplicate effect kinds, independent bypass and controls", () => {
    expect(isNativeManifestV1(valid)).toBe(true);
    const chain: PedalInstance[] = valid.nodes.map(node => ({
      id: node.id,
      kind: node.kind as PedalKind,
      enabled: node.enabled,
      values: Object.fromEntries(Object.entries(node.parameters)),
    }));
    const plan = buildLiveBoardSnapshot(chain);
    expect({ schemaVersion: plan.schemaVersion, nodes: plan.nodes }).toEqual(valid);
    expect(plan.nodes.map(n => n.id)).toEqual(["gate-1", "delay-bypassed", "gate-2"]);
    expect(plan.nodes[1].enabled).toBe(false);
  });

  it("rejects the same invalid fixtures as Rust and C++", () => {
    for (const fixture of [duplicate, missingBypass, invalidRange, invalidVersion]) {
      expect(isNativeManifestV1(fixture)).toBe(false);
    }
  });
});
