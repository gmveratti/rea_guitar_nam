import { describe, expect, it, vi } from "vitest";
import { createLiveRigSync } from "./liveRigSync";

function setup() {
  const waits: { resolve: () => void; reject: (error: Error) => void }[] = [];
  const apply = vi.fn((_manifest: string) => new Promise<void>((resolve, reject) => waits.push({ resolve, reject })));
  const onApplied = vi.fn(), onError = vi.fn(), onBusy = vi.fn();
  return { sync: createLiveRigSync({ apply, onApplied, onError, onBusy }), apply, waits, onApplied, onError, onBusy };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("live rig synchronization", () => {
  it("keeps one load in flight and applies only the latest pending edit", async () => {
    const x = setup(); x.sync.begin("A");
    x.sync.request("B"); x.sync.request("C"); x.sync.request("D");
    expect(x.apply.mock.calls).toEqual([["B"]]);
    x.waits[0].resolve(); await tick();
    expect(x.apply.mock.calls).toEqual([["B"], ["D"]]);
    x.waits[1].resolve(); await tick();
    expect(x.onApplied.mock.calls).toEqual([["B"], ["D"]]);
    expect(x.onBusy).toHaveBeenLastCalledWith(false);
  });

  it("keeps the applied rig after rejection and does not retry it forever", async () => {
    const x = setup(); x.sync.begin("A"); x.sync.request("bad");
    x.waits[0].reject(new Error("invalid NAM")); await tick();
    x.sync.request("bad"); await tick();
    expect(x.apply).toHaveBeenCalledTimes(1);
    expect(x.onApplied).not.toHaveBeenCalled();
    expect(x.onError).toHaveBeenCalledTimes(1);
    x.sync.request("valid"); x.waits[1].resolve(); await tick();
    expect(x.onApplied).toHaveBeenCalledWith("valid");
  });

  it("ignores a stale completion after Stop and can update the next session", async () => {
    const x = setup(); x.sync.begin("A"); x.sync.request("B");
    x.sync.stop(); x.sync.begin("C"); x.sync.request("D");
    x.waits[0].resolve(); await tick();
    expect(x.onApplied).not.toHaveBeenCalled();
    expect(x.apply.mock.calls).toEqual([["B"], ["D"]]);
    x.waits[1].resolve(); await tick();
    expect(x.onApplied.mock.calls).toEqual([["D"]]);
  });

  it("does not reload a rig already applied and restores it after a reverted edit", async () => {
    const x = setup(); x.sync.begin("A"); x.sync.request("A");
    expect(x.apply).not.toHaveBeenCalled();
    x.sync.request("B"); x.sync.request("A");
    x.waits[0].resolve(); await tick();
    expect(x.apply.mock.calls).toEqual([["B"], ["A"]]);
    x.waits[1].resolve(); await tick();
    expect(x.onApplied).toHaveBeenLastCalledWith("A");
  });
});
