export type AudioFaultStatus = {
  inputFailed: boolean;
  outputFailed: boolean;
  engineFailed?: boolean;
};

// CPAL callbacks only publish atomic fault bits. Build user-facing text
// on the React thread; never format strings on an audio callback.
export function audioFaultReason(status: AudioFaultStatus): string {
  const causes: string[] = [];
  if (status.inputFailed) causes.push("entrada de áudio");
  if (status.outputFailed) causes.push("saída de áudio");
  if (status.engineFailed) causes.push("motor NAM/IR");
  return causes.length ? causes.join(", ") : "origem não identificada";
}
