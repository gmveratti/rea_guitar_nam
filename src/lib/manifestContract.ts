import { PEDALS, type PedalKind } from "./pedals";

/**
 * Structural v1 manifest preflight only, no filesystem or NAM I/O.
 * Parameter ranges come from the existing UI pedal metadata, rather than
 * maintaining another TypeScript copy of the native DSP parameter limits.
 * C++ and Rust consume the same acceptance/rejection fixtures.
 */
type ManifestNode = {
  id: string;
  kind: PedalKind;
  enabled: boolean;
  parameters: Record<string, number>;
  resource?: { path: string };
};
export type NativeManifestV1 = { schemaVersion: 1; nodes: ManifestNode[] };

const NATIVE_EFFECT_KINDS = new Set<PedalKind>([
  "gate", "compressor", "sustain", "chorus", "delay", "reverb",
]);
const MODEL_KINDS = new Set<PedalKind>(["amp", "drive", "cabinet"]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isNativeManifestV1(value: unknown): value is NativeManifestV1 {
  if (!record(value) || value.schemaVersion !== 1 ||
      !Array.isArray(value.nodes) || value.nodes.length > 24) {
    return false;
  }
  const ids = new Set<string>();
  for (const node of value.nodes) {
    if (!record(node) || typeof node.id !== "string" || !node.id ||
        node.id.length > 128 || ids.has(node.id) ||
        node.enabled !== true && node.enabled !== false ||
        typeof node.kind !== "string" ||
        !(NATIVE_EFFECT_KINDS.has(node.kind as PedalKind) || MODEL_KINDS.has(node.kind as PedalKind)) ||
        !record(node.parameters)) return false;
    ids.add(node.id);
    const kind = node.kind as PedalKind;
    if (NATIVE_EFFECT_KINDS.has(kind)) {
      if ("resource" in node) return false;
    } else {
      if (!record(node.resource) || typeof node.resource.path !== "string" ||
          !node.resource.path || node.resource.path.length > 4096 ||
          node.resource.path.includes("\0")) return false;
      const ext = kind === "cabinet" ? ".wav" : ".nam";
      if (!node.resource.path.toLowerCase().endsWith(ext)) return false;
    }
    const allowed = new Map(PEDALS[kind].parameters.map(p => [p.key, p]));
    for (const [name, raw] of Object.entries(node.parameters)) {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return false;
      const control = allowed.get(name);
      // Native model processing currently validates numeric shape, not
      // amplifier parameter bounds. File-free DSP does enforce ranges.
      if (NATIVE_EFFECT_KINDS.has(kind) &&
          (!control || raw < control.min || raw > control.max)) return false;
    }
  }
  return true;
}
