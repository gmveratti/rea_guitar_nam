import { validateChain, type PedalInstance } from "./pedals";

export type RigResources = Record<string, string>; // legacy resource map for migration
export type NativeRigNode =
  | { id: string; kind: "gate" | "compressor" | "sustain" | "chorus" | "delay" | "reverb"; enabled: boolean; parameters: Record<string, number> }
  | { id: string; kind: "amp"; enabled: boolean; parameters: Record<string, number>; resource: { path: string } };

export type LiveBoardSnapshot = {
  schemaVersion: 1;
  nodes: NativeRigNode[];
  ignored: { id: string; kind: string }[];
};

export function validMainAmpPath(path: unknown): path is string {
  return typeof path === "string" && path.trim().length > 0 &&
    path.length <= 4096 && !path.includes("\0") &&
    path.toLowerCase().endsWith(".nam");
}

/** Legacy model paths are only used while migrating old draft/preset storage. */
export function validateRigResources(value: unknown, chain: readonly PedalInstance[]): RigResources {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: RigResources = {};
  for (const effect of chain) {
    if (effect.kind !== "amp" && effect.kind !== "drive" && effect.kind !== "cabinet") continue;
    const path = Object.prototype.hasOwnProperty.call(source, effect.id) ? source[effect.id] : undefined;
    const extension = effect.kind === "cabinet" ? ".wav" : ".nam";
    if (typeof path === "string" && path.trim() && path.length <= 4096 &&
        !path.includes("\0") && path.toLowerCase().endsWith(extension)) {
      result[effect.id] = path;
    }
  }
  return result;
}

/**
 * The virtual amp head is a dedicated final stage, never a pedal. Pedal DSP
 * remains in the user's exact visual order. Any model must be a real .nam path,
 * not a visual demo name or an old VTTAMP pedal.
 */
export function buildLiveBoardSnapshot(
  chain: readonly PedalInstance[],
  mainAmpPath = "",
  ampPowered = true,
): LiveBoardSnapshot {
  const validated = validateChain([...chain]);
  if (!validated) throw new Error("Cadeia visual inválida: verifique IDs e parâmetros.");
  const nodes: NativeRigNode[] = validated.map((effect) => ({
    id: effect.id,
    kind: effect.kind as "gate" | "compressor" | "sustain" | "chorus" | "delay" | "reverb",
    enabled: effect.enabled,
    parameters: { ...effect.values },
  }));
  if (mainAmpPath) {
    if (!validMainAmpPath(mainAmpPath)) {
      throw new Error("O amplificador principal exige um arquivo .nam válido.");
    }
    nodes.push({
      id: "main-amp", kind: "amp", enabled: ampPowered,
      parameters: { input: 0, output: -3 },
      resource: { path: mainAmpPath },
    });
  }
  if (!nodes.length) {
    throw new Error("Escolha um amplificador principal .nam ou adicione um pedal de efeito.");
  }
  return { schemaVersion: 1, nodes, ignored: [] };
}
