/** Local-only settings for the standalone NAM/IR monitor.
 * This is deliberately NOT a saved pedalboard preset or a command to start audio.
 * The native backend verifies that saved model paths still exist at Start time.
 */
export type LiveAudioSettings = {
  version: 1;
  mode: "dry" | "wet";
  bufferFrames: number;
  inputChannel: number;
  ampPath: string;
  cabPath: string;
  irBeforeAmp: boolean;
  bypassAmp: boolean;
  bypassCab: boolean;
};

export const DEFAULT_AUDIO_SETTINGS: LiveAudioSettings = {
  version: 1,
  mode: "dry",
  bufferFrames: 256,
  inputChannel: 0,
  ampPath: "",
  cabPath: "",
  irBeforeAmp: false,
  bypassAmp: false,
  bypassCab: false,
};

const KEY = "rea-guitar-nam:v1:live-audio-settings";
const BUFFERS = new Set([64, 128, 256, 512, 1024]);

type SettingsStore = Pick<Storage, "getItem" | "setItem">;

function validPath(value: unknown, extension: string): string {
  return typeof value === "string" && value.length <= 4096 &&
    !value.includes("\0") && value.trim() !== "" &&
    value.toLowerCase().endsWith(extension) ? value : "";
}

export function parseAudioSettings(value: unknown): LiveAudioSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) return { ...DEFAULT_AUDIO_SETTINGS };

  return {
    version: 1,
    mode: raw.mode === "wet" ? "wet" : "dry",
    bufferFrames: typeof raw.bufferFrames === "number" && BUFFERS.has(raw.bufferFrames)
      ? raw.bufferFrames : DEFAULT_AUDIO_SETTINGS.bufferFrames,
    inputChannel: typeof raw.inputChannel === "number" && Number.isInteger(raw.inputChannel) &&
      raw.inputChannel >= 0 && raw.inputChannel < 32 ? raw.inputChannel : 0,
    ampPath: validPath(raw.ampPath, ".nam"),
    cabPath: validPath(raw.cabPath, ".wav"),
    irBeforeAmp: raw.irBeforeAmp === true,
    bypassAmp: raw.bypassAmp === true,
    bypassCab: raw.bypassCab === true,
  };
}

export function loadAudioSettings(store?: SettingsStore): LiveAudioSettings {
  try {
    const text = (store ?? globalThis.localStorage).getItem(KEY);
    return text ? parseAudioSettings(JSON.parse(text) as unknown) : { ...DEFAULT_AUDIO_SETTINGS };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function saveAudioSettings(settings: LiveAudioSettings, store?: SettingsStore): boolean {
  try {
    (store ?? globalThis.localStorage).setItem(KEY, JSON.stringify(parseAudioSettings(settings)));
    return true;
  } catch {
    // A blocked or full WebView storage must never prevent a guitar session.
    return false;
  }
}
