export type PedalKind =
  | "gate"
  | "drive"
  | "amp"
  | "cabinet"
  | "chorus"
  | "delay"
  | "reverb";

export type Parameter = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  defaultValue: number;
};

export type PedalDefinition = {
  kind: PedalKind;
  title: string;
  caption: string;
  category: string;
  accent: string;
  description: string;
  parameters: Parameter[];
};

export type PedalInstance = {
  id: string;
  kind: PedalKind;
  enabled: boolean;
  values: Record<string, number>;
};

export const PEDALS: Record<PedalKind, PedalDefinition> = {
  gate: {
    kind: "gate",
    title: "Noise Gate",
    caption: "SILENCE",
    category: "UTILITÁRIO",
    accent: "#99b2b3",
    description: "Portão de ruído para controlar hiss e silêncio entre notas.",
    parameters: [
      { key: "threshold", label: "Threshold", min: -80, max: 0, step: 1, unit: "dB", defaultValue: -48 },
      { key: "release", label: "Release", min: 10, max: 500, step: 5, unit: "ms", defaultValue: 120 },
    ],
  },
  drive: {
    kind: "drive",
    title: "NAM Drive",
    caption: "CAPTURE / PRE",
    category: "NEURAL",
    accent: "#efb86f",
    description: "Posição reservada para capturas .nam de overdrives e distorções, antes do amplificador.",
    parameters: [
      { key: "input", label: "Input", min: -24, max: 24, step: 0.5, unit: "dB", defaultValue: 0 },
      { key: "output", label: "Output", min: -24, max: 24, step: 0.5, unit: "dB", defaultValue: 0 },
    ],
  },
  amp: {
    kind: "amp",
    title: "NAM Amplifier",
    caption: "NEURAL / AMP",
    category: "NEURAL",
    accent: "#f47f74",
    description: "Amplificador alimentado por um modelo Neural Amp Modeler (.nam).",
    parameters: [
      { key: "input", label: "Input", min: -24, max: 24, step: 0.5, unit: "dB", defaultValue: 0 },
      { key: "output", label: "Output", min: -24, max: 24, step: 0.5, unit: "dB", defaultValue: -3 },
    ],
  },
  cabinet: {
    kind: "cabinet",
    title: "Cabinet IR",
    caption: "CONVOLUTION",
    category: "RESPOSTA IMPULSO",
    accent: "#b5a5ef",
    description: "Cabinet baseado em impulse response (.wav), a ser conectado ao convolutor nativo.",
    parameters: [
      { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%", defaultValue: 100 },
      { key: "level", label: "Level", min: -24, max: 12, step: 0.5, unit: "dB", defaultValue: 0 },
    ],
  },
  chorus: {
    kind: "chorus",
    title: "Stereo Chorus",
    caption: "MODULATION",
    category: "MODULAÇÃO",
    accent: "#8da8ff",
    description: "Chorus inspirado nos algoritmos abertos do Airwindows StereoChorus.",
    parameters: [
      { key: "rate", label: "Rate", min: 0.1, max: 8, step: 0.1, unit: "Hz", defaultValue: 1.2 },
      { key: "depth", label: "Depth", min: 0, max: 100, step: 1, unit: "%", defaultValue: 48 },
      { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%", defaultValue: 30 },
    ],
  },
  delay: {
    kind: "delay",
    title: "Tape Delay",
    caption: "ECHO / TAPE",
    category: "AMBIÊNCIA",
    accent: "#86dfb7",
    description: "Delay estilo tape inspirado no Airwindows TapeDelay2.",
    parameters: [
      { key: "time", label: "Time", min: 40, max: 1200, step: 10, unit: "ms", defaultValue: 420 },
      { key: "feedback", label: "Feedback", min: 0, max: 90, step: 1, unit: "%", defaultValue: 38 },
      { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%", defaultValue: 28 },
    ],
  },
  reverb: {
    kind: "reverb",
    title: "Cloud Reverb",
    caption: "SPACE / TAIL",
    category: "AMBIÊNCIA",
    accent: "#d7a1ef",
    description: "Reverb espacial inspirado no motor MIT do CloudSeedCore.",
    parameters: [
      { key: "size", label: "Size", min: 0, max: 100, step: 1, unit: "%", defaultValue: 67 },
      { key: "decay", label: "Decay", min: 0.2, max: 15, step: 0.1, unit: "s", defaultValue: 4.2 },
      { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%", defaultValue: 24 },
    ],
  },
};

export const PEDAL_KINDS: PedalKind[] = [
  "gate", "drive", "amp", "cabinet", "chorus", "delay", "reverb",
];

export function createPedal(kind: PedalKind): PedalInstance {
  const definition = PEDALS[kind];
  return {
    id: crypto.randomUUID(),
    kind,
    enabled: true,
    values: Object.fromEntries(definition.parameters.map((p) => [p.key, p.defaultValue])),
  };
}

export function clampValue(value: number, p: Parameter): number {
  if (!Number.isFinite(value)) return p.defaultValue;
  return Math.min(p.max, Math.max(p.min, value));
}

export function movePedal(chain: PedalInstance[], id: string, toIndex: number): PedalInstance[] {
  const fromIndex = chain.findIndex((p) => p.id === id);
  if (fromIndex < 0) return chain;
  const output = [...chain];
  const [item] = output.splice(fromIndex, 1);
  output.splice(Math.min(output.length, Math.max(0, toIndex)), 0, item);
  return output;
}

export function validateChain(value: unknown): PedalInstance[] | null {
  if (!Array.isArray(value) || value.length > 24) return null;
  const ids = new Set<string>();
  const result: PedalInstance[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Partial<PedalInstance>;
    if (typeof item.kind !== "string" || !(item.kind in PEDALS)) return null;
    if (typeof item.id !== "string" || !item.id || ids.has(item.id)) return null;
    if (typeof item.enabled !== "boolean") return null;
    if (!item.values || typeof item.values !== "object" || Array.isArray(item.values)) return null;

    const kind = item.kind as PedalKind;
    ids.add(item.id);
    const values: Record<string, number> = {};
    for (const p of PEDALS[kind].parameters) {
      const rawValue = (item.values as Record<string, unknown>)[p.key];
      values[p.key] = typeof rawValue === "number" ? clampValue(rawValue, p) : p.defaultValue;
    }
    result.push({ id: item.id, kind, enabled: item.enabled, values });
  }
  return result;
}

export function factoryChain(): PedalInstance[] {
  return ["gate", "drive", "amp", "cabinet", "chorus", "delay", "reverb"].map((kind) =>
    createPedal(kind as PedalKind)
  );
}
