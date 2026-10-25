import { validateChain, type PedalInstance, type PedalKind } from "./pedals";

/**
 * Canonical ordered UI→engine snapshot.
 *
 * The array order is THE signal order; it must never be sorted by pedal kind.
 * The same effect type can appear many times, each with a unique instance ID.
 * Bypassed effects preserve their position and settings.
 *
 * This is a pure serialization contract, not a live Tauri audio connection.
 * The native engine integration will translate nodes into prepared processors
 * on a worker thread and atomically switch graphs between audio blocks.
 */
export interface SignalChainNode {
  id: string;
  kind: PedalKind;
  enabled: boolean;
  parameters: Record<string, number>;
}

export interface SignalChainSnapshot {
  schemaVersion: 1;
  nodes: SignalChainNode[];
}

export function createSignalChainSnapshot(chain: readonly PedalInstance[]): SignalChainSnapshot {
  const valid = validateChain([...chain]);
  if (!valid) throw new Error("Invalid pedal chain: duplicate id, unknown effect or malformed controls");

  return {
    schemaVersion: 1,
    nodes: valid.map(({ id, kind, enabled, values }) => ({
      id,
      kind,
      enabled,
      parameters: { ...values },
    })),
  };
}
