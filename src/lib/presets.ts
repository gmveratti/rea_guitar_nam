import { factoryChain, validateChain, type PedalInstance } from "./pedals";

export type Preset = {
  id: string;
  name: string;
  chain: PedalInstance[];
};

const STORAGE_PREFIX = "rea-guitar-nam:v1:";
const DRAFT_KEY = STORAGE_PREFIX + "draft";
const PRESETS_KEY = STORAGE_PREFIX + "presets";

function safeRead(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadDraft(): PedalInstance[] {
  return validateChain(safeRead(DRAFT_KEY)) ?? factoryChain();
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
    return chain ? [{ id: data.id, name: data.name, chain }] : [];
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
