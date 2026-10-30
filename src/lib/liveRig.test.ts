import { describe, expect, it } from "vitest";
import { createPedal, movePedal } from "./pedals";
import { buildLiveBoardSnapshot, validMainAmpPath, validateRigResources } from "./liveRig";

describe("pedalboard and standalone amplifier -> native DSP manifest", () => {
  it("routes only the six effects in visual order, then the standalone main amp", () => {
    const gate = createPedal("gate"), chorus = createPedal("chorus"), delay = createPedal("delay");
    chorus.values.depth = 70;
    delay.enabled = false;
    const chain = movePedal([gate, chorus, delay], chorus.id, 0);
    const plan = buildLiveBoardSnapshot(chain, "/models/Hiwatt_A2.NAM");
    expect(plan.nodes.map(n => n.kind)).toEqual(["chorus", "gate", "delay", "amp"]);
    expect(plan.nodes.map(n => n.enabled)).toEqual([true, true, false, true]);
    expect(plan.nodes[0].parameters.depth).toBe(70);
    expect(plan.nodes[3]).toEqual({
      id: "main-amp", kind: "amp", enabled: true,
      parameters: { input: 0, output: -3 },
      resource: { path: "/models/Hiwatt_A2.NAM" },
    });
    expect(plan.ignored).toEqual([]);
  });

  it("accepts amp-only rigs without adding any virtual pedal", () => {
    const plan = buildLiveBoardSnapshot([], "/models/a.nam");
    expect(plan.nodes).toHaveLength(1);
    expect(plan.nodes[0].kind).toBe("amp");
    expect(plan.nodes[0].id).toBe("main-amp");
  });

  it("master power bypasses only main amp without affecting pedals or presets", () => {
    const gate = createPedal("gate");
    const plan = buildLiveBoardSnapshot([gate], "/models/a.nam", false);
    expect(plan.nodes.map(n => n.enabled)).toEqual([true, false]);
    expect(gate.enabled).toBe(true);
    expect(gate.values.threshold).toBe(-80);
  });

  it("supports repeated effects, independent bypass and real controls", () => {
    const a = createPedal("compressor"), b = createPedal("compressor");
    b.enabled = false;
    a.values.compress = 72;
    a.values.mix = 46;
    const plan = buildLiveBoardSnapshot([a,b], "");
    expect(plan.nodes.map(n => n.kind)).toEqual(["compressor","compressor"]);
    expect(plan.nodes.map(n => n.enabled)).toEqual([true,false]);
    expect(plan.nodes[0].parameters).toEqual({ compress: 72, output: 100, mix: 46 });
  });

  it("keeps Gate, Sustain, Chorus, Delay and Reverb parameters from the UI", () => {
    const effects = ["gate","sustain","chorus","delay","reverb"].map(k => createPedal(k as "gate" | "sustain" | "chorus" | "delay" | "reverb"));
    effects[0].values.threshold = -48;
    effects[1].values.speed = 65;
    effects[2].values.rate = 3.2;
    effects[3].values.time = 780;
    effects[4].values.decay = 8.8;
    const plan = buildLiveBoardSnapshot(effects, "");
    expect(plan.nodes.map(n => n.kind)).toEqual(["gate", "sustain", "chorus", "delay", "reverb"]);
    expect(plan.nodes.map(n => n.parameters)).toEqual(effects.map(p => p.values));
  });

  it("does not turn retired VTTAMP/Drive/IR pedal slots into audio processors", () => {
    const amp = createPedal("amp"), drive = createPedal("drive"), cab = createPedal("cabinet");
    const gate = createPedal("gate");
    const plan = buildLiveBoardSnapshot([amp,drive,gate,cab], "");
    expect(plan.nodes.map(n => n.kind)).toEqual(["gate"]);
    const withMain = buildLiveBoardSnapshot([amp,gate], "/real/amp.nam");
    expect(withMain.nodes.map(n => n.kind)).toEqual(["gate","amp"]);
  });

  it("validates a real model path and never interprets a visual demo as audio", () => {
    expect(validMainAmpPath("/models/Hiwatt.A2.NAM")).toBe(true);
    expect(validMainAmpPath("")).toBe(false);
    expect(validMainAmpPath("/models/invalid.wav")).toBe(false);
    expect(validMainAmpPath("/models/evil.nam\u0000")).toBe(false);
    expect(() => buildLiveBoardSnapshot([], "")).toThrow(/amplificador principal/);
    expect(() => buildLiveBoardSnapshot([], "/wrong.wav")).toThrow(/arquivo .nam/);
    expect(() => buildLiveBoardSnapshot([], "/evil.nam\u0000")).toThrow();
  });

  it("legacy file mappings remain available only to the migration layer", () => {
    const amp = createPedal("amp"), cab = createPedal("cabinet"), drive = createPedal("drive");
    const resources = validateRigResources({
      [amp.id]: "/a.nam", [cab.id]: "/ir.wav", [drive.id]: "/d.nam",
      stale: "/ignored.nam",
    }, [amp, cab, drive]);
    expect(resources).toEqual({ [amp.id]: "/a.nam", [cab.id]: "/ir.wav", [drive.id]: "/d.nam" });
    expect(validateRigResources({ [amp.id]: "/bad.exe" }, [amp])).toEqual({});
  });
});
