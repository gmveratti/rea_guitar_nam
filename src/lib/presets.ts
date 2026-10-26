import { validateChain, type PedalInstance } from "./pedals";
import type { AmpFamily } from "./ampSkins";
import { validateRigResources, type RigResources } from "./liveRig";

export type Preset = {
  id: string;
  name: string;
  chain: PedalInstance[];
  modelName?: string;
  ampFamily?: AmpFamily | "auto";
  ampPowered?: boolean;
  resources?: RigResources;
};

const STORAGE_PREFIX = "rea-guitar-nam:v1:";
const DRAFT_KEY = STORAGE_PREFIX + "draft";
const PRESETS_KEY = STORAGE_PREFIX + "presets";
const DRAFT_VISUAL_KEY = STORAGE_PREFIX + "draft-visual";
const DRAFT_RESOURCES_KEY = STORAGE_PREFIX + "draft-resources";

export type DraftVisual = { modelName: string; ampFamily: AmpFamily | "auto"; ampPowered?: boolean };
const DEFAULT_DRAFT_VISUAL: DraftVisual = { modelName: "", ampFamily: "british" };
const AMP_FAMILY_OPTIONS = new Set([
  "auto", "british", "american", "stadium", "chime", "modern", "boutique", "generic",
]);

type VisualStore = Pick<Storage, "getItem" | "setItem">;

export function parseDraftVisual(value: unknown): DraftVisual {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_DRAFT_VISUAL };
  }
  const raw = value as Record<string, unknown>;
  return {
    modelName: typeof raw.modelName === "string" ? raw.modelName.slice(0, 200) : "",
    ampFamily: typeof raw.ampFamily === "string" && AMP_FAMILY_OPTIONS.has(raw.ampFamily)
      ? raw.ampFamily as AmpFamily | "auto" : DEFAULT_DRAFT_VISUAL.ampFamily,
    ...(typeof raw.ampPowered === "boolean" ? { ampPowered: raw.ampPowered } : {}),
  };
}

export function loadDraftVisual(store?: VisualStore): DraftVisual {
  try {
    const text = (store ?? globalThis.localStorage).getItem(DRAFT_VISUAL_KEY);
    return text ? parseDraftVisual(JSON.parse(text) as unknown) : { ...DEFAULT_DRAFT_VISUAL };
  } catch {
    return { ...DEFAULT_DRAFT_VISUAL };
  }
}

export function saveDraftVisual(value: DraftVisual, store?: VisualStore): boolean {
  try {
    (store ?? globalThis.localStorage).setItem(DRAFT_VISUAL_KEY, JSON.stringify(parseDraftVisual(value)));
    return true;
  } catch {
    return false;
  }
}

function safeRead(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadDraftResources(chain: readonly PedalInstance[]): RigResources {
  return validateRigResources(safeRead(DRAFT_RESOURCES_KEY), chain);
}

export function saveDraftResources(resources: Readonly<RigResources>, chain: readonly PedalInstance[]): boolean {
  try {
    localStorage.setItem(DRAFT_RESOURCES_KEY, JSON.stringify(validateRigResources(resources, chain)));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(): PedalInstance[] {
  return validateChain(safeRead(DRAFT_KEY)) ?? [];
}

export function saveDraft(chain: PedalInstance[]): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(chain));
  } catch {
    // Storage may be unavailable; the session still works in memory.
  }
}

export function loadPresets(): Preset[] {
  const raw = safeRead(PRESETS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: unknown): Preset[] => {
    if (!item || typeof item !== "object") return [];
    const data = item as Partial<Preset>;
    if (typeof data.id !== "string" || typeof data.name !== "string" || data.name.length > 100) return [];
    const chain = validateChain(data.chain);
    if (!chain) return [];
    const modelName = typeof data.modelName === "string" ? data.modelName.slice(0, 200) : undefined;
    const allowed = new Set(["auto", "british", "american", "stadium", "chime", "modern", "boutique", "generic"]);
    const ampFamily = typeof data.ampFamily === "string" && allowed.has(data.ampFamily)
      ? data.ampFamily as AmpFamily | "auto" : undefined;
    const resources = validateRigResources(data.resources, chain);
    const ampPowered = typeof data.ampPowered === "boolean" ? data.ampPowered : true;
    return [{ id: data.id, name: data.name, chain, modelName, ampFamily, resources, ampPowered }];
  }).slice(0, 100);
}

export function savePresets(presets: Preset[]): boolean {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}
