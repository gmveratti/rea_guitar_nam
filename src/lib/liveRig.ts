import { validateChain, type PedalInstance, type PedalKind } from "./pedals";

const RESOURCE_KINDS = new Set<PedalKind>(["amp", "drive", "cabinet"]);
const NATIVE_KINDS = new Set<PedalKind>(["gate", "compressor", "amp", "drive", "cabinet"]);
export type RigResources = Record<string, string>;
export type NativeRigNode =
  | { id: string; kind: "gate" | "compressor"; enabled: boolean; parameters: Record<string, number> }
  | {
    id: string;
    kind: "amp" | "drive" | "cabinet";
    enabled: boolean;
    parameters: Record<string, number>;
    resource: { path: string };
  };
export type LiveBoardSnapshot = {
  schemaVersion: 1;
  nodes: NativeRigNode[];
  ignored: { id: string; kind: PedalKind }[];
};

const expectedExtension = (kind: PedalKind) => kind === "cabinet" ? ".wav" : ".nam";
const displayType = (kind: PedalKind) => kind === "cabinet" ? "IR" : "NAM";

export function validNativePath(path: unknown, kind: PedalKind): path is string {
  return typeof path === "string" && path.trim().length > 0 &&
    path.length <= 4096 && !path.includes("\0") &&
    path.toLowerCase().endsWith(expectedExtension(kind));
}

/** Paths are local-only, keyed by instance ID, not by pedal kind or position. */
export function validateRigResources(value: unknown, chain: readonly PedalInstance[]): RigResources {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: RigResources = {};
  for (const effect of chain) {
    if (!RESOURCE_KINDS.has(effect.kind)) continue;
    const path = Object.prototype.hasOwnProperty.call(source, effect.id) ? source[effect.id] : undefined;
    if (validNativePath(path, effect.kind)) result[effect.id] = path;
  }
  return result;
}

/** Native dynamics, NAM and IR execute in the exact user order. Other pedals are reported. */
export function buildLiveBoardSnapshot(
  chain: readonly PedalInstance[],
  paths: Readonly<RigResources>,
  ampPowered = true,
): LiveBoardSnapshot {
  const validated = validateChain([...chain]);
  if (!validated) throw new Error("Cadeia visual inválida: verifique IDs e parâmetros.");
  const nodes: NativeRigNode[] = [];
  const ignored: LiveBoardSnapshot["ignored"] = [];
  for (const effect of validated) {
    if (!NATIVE_KINDS.has(effect.kind)) {
      if (effect.enabled) ignored.push({ id: effect.id, kind: effect.kind });
      continue;
    }
    if (effect.kind === "gate" || effect.kind === "compressor") {
      nodes.push({
        id: effect.id, kind: effect.kind, enabled: effect.enabled,
        parameters: { ...effect.values },
      });
      continue;
    }
    const path = Object.prototype.hasOwnProperty.call(paths, effect.id) ? paths[effect.id] : undefined;
    const enabled = effect.enabled && (effect.kind !== "amp" || ampPowered);
    if (!validNativePath(path, effect.kind)) {
      // An unconfigured bypassed slot is a UI placeholder, not a native processor.
      if (!enabled) continue;
      throw new Error(`${displayType(effect.kind)} sem arquivo válido no pedal ${effect.id}. Escolha um ${expectedExtension(effect.kind)} na pedalboard.`);
    }
    nodes.push({
      id: effect.id,
      kind: effect.kind as "amp" | "drive" | "cabinet",
      enabled,
      parameters: { ...effect.values },
      resource: { path },
    });
  }
  if (!nodes.length) throw new Error("Adicione um Noise Gate, Compressor, NAM ou IR à pedalboard.");
  return { schemaVersion: 1, nodes, ignored };
}
