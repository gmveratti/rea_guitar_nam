import { validateChain, type PedalInstance } from "./pedals";
import { isNativeManifestV1 } from "./manifestContract";

export type RigResources = Record<string, string>; // legacy resource map for migration
export type AmpLevels = { input: number; output: number };
export const DEFAULT_AMP_LEVELS: Readonly<AmpLevels> = { input: 0, output: -3 };
export const MAX_LIVE_RIG_NODES = 24;
export const LIVE_RIG_LIMIT_MESSAGE = "Limite de 24 módulos no áudio, incluindo amplificador e IR. Remova um pedal ou recurso antes de adicionar outro.";

export function countLiveRigNodes(chain: readonly PedalInstance[], mainAmpPath = "", cabinetPath = ""): number {
  return chain.length + Number(Boolean(mainAmpPath)) + Number(Boolean(cabinetPath));
}

export function validAmpLevel(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -24 && value <= 24;
}
export type NativeRigNode =
  | { id: string; kind: "gate" | "compressor" | "sustain" | "chorus" | "delay" | "reverb"; enabled: boolean; parameters: Record<string, number> }
  | { id: string; kind: "amp" | "cabinet"; enabled: boolean; parameters: Record<string, number>; resource: { path: string } };

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

export function validCabinetPath(path: unknown): path is string {
  return typeof path === "string" && path.trim().length > 0 &&
    path.length <= 4096 && !path.includes("\0") &&
    path.toLowerCase().endsWith(".wav");
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
 * The virtual amp head and optional cabinet are dedicated stages, never pedals.
 * Pedal DSP remains in the user's exact visual order, followed by the amp and
 * the explicitly selected IR. A capture that already contains a cabinet does
 * not acquire an extra IR unless the user selects one.
 */
export function buildLiveBoardSnapshot(
  chain: readonly PedalInstance[],
  mainAmpPath = "",
  ampPowered = true,
  cabinetPath = "",
  ampLevels: Readonly<AmpLevels> = DEFAULT_AMP_LEVELS,
): LiveBoardSnapshot {
  const validated = validateChain([...chain]);
  if (!validated) throw new Error("Cadeia visual inválida: verifique IDs e parâmetros.");
  if (countLiveRigNodes(validated, mainAmpPath, cabinetPath) > MAX_LIVE_RIG_NODES) {
    throw new Error(LIVE_RIG_LIMIT_MESSAGE);
  }
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
    if (!validAmpLevel(ampLevels.input) || !validAmpLevel(ampLevels.output)) {
      throw new Error("Os controles de ganho do amplificador devem estar entre -24 e +24 dB.");
    }
    nodes.push({
      id: "main-amp", kind: "amp", enabled: ampPowered,
      parameters: { input: ampLevels.input, output: ampLevels.output },
      resource: { path: mainAmpPath },
    });
  }
  if (cabinetPath) {
    if (!validCabinetPath(cabinetPath)) {
      throw new Error("O gabinete IR exige um arquivo .wav válido.");
    }
    nodes.push({
      id: "main-cabinet", kind: "cabinet", enabled: true,
      parameters: {}, resource: { path: cabinetPath },
    });
  }
  // Clearing the last model produces a real empty graph (dry passthrough),
  // instead of leaving the former amplifier running behind an empty UI.
  const manifest = { schemaVersion: 1, nodes };
  if (!isNativeManifestV1(manifest)) {
    throw new Error("Manifesto nativo inválido: versão, IDs ou parâmetros inconsistentes.");
  }
  return { schemaVersion: 1, nodes, ignored: [] };
}
