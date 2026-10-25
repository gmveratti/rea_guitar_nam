export type AmpFamily = "british" | "american" | "stadium" | "chime" | "modern" | "boutique" | "generic";
export type AmpVisual = {
  id: AmpFamily;
  title: string;
  subtitle: string;
  series: string;
  channel: string;
  controls: string[];
  match: string;
};

const SKINS: Record<AmpFamily, Omit<AmpVisual, "match">> = {
  british: { id: "british", title: "BRITISH 100", subtitle: "Classic British Lead", series: "VT-100", channel: "HIGH / LOW", controls: ["GAIN", "BASS", "MID", "TREBLE", "MASTER", "PRESENCE"] },
  american: { id: "american", title: "AMERICAN DELUXE", subtitle: "Vintage Clean Series", series: "VT-65", channel: "NORMAL / VIBRATO", controls: ["VOLUME", "TREBLE", "BASS", "MID", "REVERB", "MASTER"] },
  stadium: { id: "stadium", title: "STADIUM CUSTOM", subtitle: "Wide Headroom Series", series: "VT-103", channel: "BRILLIANT / NORMAL", controls: ["NORMAL", "BRIGHT", "BASS", "TREBLE", "PRESENCE", "MASTER"] },
  chime: { id: "chime", title: "BRITISH CHIME", subtitle: "Class A Collection", series: "VT-30", channel: "TOP BOOST", controls: ["VOLUME", "BASS", "TREBLE", "CUT", "TONE", "MASTER"] },
  modern: { id: "modern", title: "MODERN HIGH GAIN", subtitle: "Heavy Amplification", series: "VT-RECT", channel: "LEAD", controls: ["GAIN", "BASS", "MID", "TREBLE", "PRESENCE", "MASTER"] },
  boutique: { id: "boutique", title: "BOUTIQUE SERIES", subtitle: "Handwired Tones", series: "VT-BTQ", channel: "CUSTOM", controls: ["GAIN", "BASS", "MID", "TREBLE", "PRESENCE", "MASTER"] },
  generic: { id: "generic", title: "NEURAL AMPLIFIER", subtitle: "Your Capture, Your Sound", series: "VT-NAM", channel: "MODEL", controls: ["INPUT", "BASS", "MID", "TREBLE", "TONE", "OUTPUT"] },
};

const FAMILY_MATCHERS: Array<{ family: AmpFamily; pattern: RegExp }> = [
  { family: "stadium", pattern: /(?:hiwatt|hi[-_ ]?watt|dr[-_ ]?10[34]|sound[ _-]?city)/i },
  { family: "american", pattern: /(?:fender|twin[ _-]?reverb|deluxe[ _-]?reverb|princeton|super[ _-]?reverb|blackface|bassman)/i },
  { family: "chime", pattern: /(?:vox|ac[-_ ]?30|ac[-_ ]?15|top[ _-]?boost)/i },
  { family: "modern", pattern: /(?:mesa|boogie|rectif|dual[ _-]?rec|mark[ _-]?[ivx0-9]+|5150|6505|engl|soldano|slo[-_ ]?100)/i },
  { family: "british", pattern: /(?:marshall|jcm[ _-]?[0-9]+|jtm[ _-]?[0-9]+|plexi|super[ _-]?lead|silver[ _-]?jubilee|british[ _-]?(?:lead|crunch))/i },
  { family: "boutique", pattern: /(?:dumble|two[ _-]?rock|matchless|friedman|bad[ _-]?cat|boutique)/i },
];

export const AMP_FAMILIES = Object.values(SKINS);

/**
 * UI-only classification. A NAM capture is a fixed snapshot, not a parametric amp.
 * Never interpret guessed family as verified metadata or an audio parameter.
 */
export function classifyNamFilename(filename: string, override?: AmpFamily | "auto"): AmpVisual {
  if (override && override !== "auto") return { ...SKINS[override], match: "manual" };
  const normalized = filename.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const matched = FAMILY_MATCHERS.find(({ pattern }) => pattern.test(normalized));
  const family = matched?.family ?? "generic";
  return { ...SKINS[family], match: matched ? "filename" : "fallback" };
}

export function humanizeModelName(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? filename;
  return basename.replace(/\.(?:nam|wav)$/i, "").replace(/[_-]+/g, " ").trim().slice(0, 96) || "NAM não selecionado";
}
