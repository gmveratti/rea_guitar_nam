import { describe, expect, it } from "vitest";
import { createPedal, movePedal } from "./pedals";
import { buildLiveBoardSnapshot, validateRigResources } from "./liveRig";

describe("PR15: canonical pedalboard -> live NAM/IR manifest", () => {
  it("retains EXACT user order, duplicate kinds and independent bypass", () => {
    const amp1 = createPedal("amp"), ir = createPedal("cabinet"), amp2 = createPedal("amp");
    amp2.enabled = false;
    const chain = movePedal([amp1, ir, amp2], ir.id, 0);
    const paths = { [amp1.id]: "/models/a.NAM", [amp2.id]: "/models/b.nam", [ir.id]: "/irs/front.WAV" };
    const result = buildLiveBoardSnapshot(chain, paths);
    expect(result.nodes.map(n => n.id)).toEqual([ir.id, amp1.id, amp2.id]);
    expect(result.nodes.map(n => n.kind)).toEqual(["cabinet", "amp", "amp"]);
    expect(result.nodes.map(n => n.enabled)).toEqual([true, true, false]);
    expect(result.nodes.map(n => n.resource.path)).toEqual(["/irs/front.WAV", "/models/a.NAM", "/models/b.nam"]);
  });

  it("master amp power disables amps without modifying pedal instances", () => {
    const amp = createPedal("amp"), ir = createPedal("cabinet");
    const snapshot = buildLiveBoardSnapshot([amp, ir], { [amp.id]: "/amp.nam", [ir.id]: "/ir.wav" }, false);
    expect(snapshot.nodes.map(n => n.enabled)).toEqual([false, true]);
    expect(amp.enabled).toBe(true);
  });

  it("does not claim unsupported visual pedals are running in DSP", () => {
    const gate = createPedal("gate"), amp = createPedal("amp"), delay = createPedal("delay");
    const result = buildLiveBoardSnapshot([gate, amp, delay], { [amp.id]: "/amp.nam" });
    expect(result.nodes).toHaveLength(1);
    expect(result.ignored.map(n => n.kind)).toEqual(["gate", "delay"]);
  });

  it("refuses missing active resources and unsupported extensions", () => {
    const amp = createPedal("amp"), cabinet = createPedal("cabinet");
    expect(() => buildLiveBoardSnapshot([amp], {})).toThrow(/NAM.*arquivo/i);
    expect(() => buildLiveBoardSnapshot([cabinet], { [cabinet.id]: "C:/bad.exe" }))
      .toThrow(/IR.*arquivo/i);
    expect(() => buildLiveBoardSnapshot([amp], { [amp.id]: "/a.nam\u0000" })).toThrow();
  });

  it("omits disabled model without a resource but keeps a prepared bypassed model", () => {
    const amp = createPedal("amp"), cab = createPedal("cabinet");
    amp.enabled = false;
    const result = buildLiveBoardSnapshot([amp, cab], { [cab.id]: "/cab.wav" });
    expect(result.nodes.map(n => n.id)).toEqual([cab.id]);
    const withResource = buildLiveBoardSnapshot([amp, cab], { [amp.id]: "/amp.nam", [cab.id]: "/cab.wav" });
    expect(withResource.nodes.map(n => n.enabled)).toEqual([false, true]);
  });

  it("rejects silent output when there are no prepared NAM/IR nodes", () => {
    expect(() => buildLiveBoardSnapshot([createPedal("gate")], {})).toThrow(/NAM.*IR/);
  });

  it("validates and filters stale/corrupt resource mappings by node identity", () => {
    const amp = createPedal("amp"), ir = createPedal("cabinet");
    const values = validateRigResources(
      { [amp.id]: "/rig/model.NAM", [ir.id]: "/rig/file.wav", stale: "/ghost.nam", constructor: "/evil.nam" },
      [amp, ir],
    );
    expect(values).toEqual({ [amp.id]: "/rig/model.NAM", [ir.id]: "/rig/file.wav" });
    expect(validateRigResources({ [amp.id]: "/rig/incorrect.wav", [ir.id]: 55 }, [amp, ir])).toEqual({});
  });
});
