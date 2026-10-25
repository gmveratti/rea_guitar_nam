import { describe, expect, it } from "vitest";
import { createPedal, movePedal } from "./pedals";
import { createSignalChainSnapshot } from "./signalChain";

describe("canonical ordered signal-chain contract", () => {
  it("processes in EXACT visual order rather than sorting by effect type", () => {
    const amp = createPedal("amp");
    const ir = createPedal("cabinet");
    const delay = createPedal("delay");
    const chain = [delay, ir, amp];
    const snapshot = createSignalChainSnapshot(chain);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.nodes.map((node) => node.id)).toEqual([delay.id, ir.id, amp.id]);
    expect(snapshot.nodes.map((node) => node.kind)).toEqual(["delay", "cabinet", "amp"]);
  });

  it("preserves duplicate kinds but assigns each its own identity and bypass", () => {
    const first = createPedal("delay");
    const second = createPedal("delay");
    second.enabled = false;
    second.values.mix = 71;
    const snapshot = createSignalChainSnapshot([first, second]);
    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.nodes[0].id).not.toBe(snapshot.nodes[1].id);
    expect(snapshot.nodes.map((node) => node.enabled)).toEqual([true, false]);
    expect(snapshot.nodes[1].parameters.mix).toBe(71);
  });

  it("captures a reorder without changing the source chain", () => {
    const a = createPedal("reverb");
    const b = createPedal("amp");
    const c = createPedal("drive");
    const original = [a, b, c];
    const reordered = movePedal(original, b.id, 0);
    expect(createSignalChainSnapshot(reordered).nodes.map((node) => node.id))
      .toEqual([b.id, a.id, c.id]);
    expect(original.map((p) => p.id)).toEqual([a.id, b.id, c.id]);
  });

  it("takes a detached parameter snapshot and rejects duplicate identities", () => {
    const a = createPedal("chorus");
    const graph = createSignalChainSnapshot([a]);
    a.values.mix = 88;
    expect(graph.nodes[0].parameters.mix).not.toBe(88);
    expect(() => createSignalChainSnapshot([a, a])).toThrow("Invalid pedal chain");
  });
});
