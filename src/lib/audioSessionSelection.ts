// Session-only selection shared by both AudioDevices views. Device indices
// are deliberately not persisted across app launches or USB re-enumeration.
export type AudioSessionSelection = {
  hostId: string;
  inputIndex: string;
  outputIndex: string;
  inputChannel: number;
};

export type AudioDevice = { index: number; name: string; channels: number; supportsMonitor: boolean };
export type AudioHost = { id: string; inputs: AudioDevice[]; outputs: AudioDevice[] };

export type NativeAudioSelection = {
  hostId: string;
  inputIndex: number;
  outputIndex: number;
  bufferFrames: number;
  inputChannel: number;
};

export const EMPTY_AUDIO_SESSION_SELECTION: AudioSessionSelection = {
  hostId: "", inputIndex: "", outputIndex: "", inputChannel: 0,
};

function firstSupported(devices: AudioDevice[]): string {
  const first = devices.find((device) => device.supportsMonitor);
  return first ? String(first.index) : "";
}

// Never silently replace an existing, possibly disconnected choice with a
// different backend/device. Invalid choices stay visible as unavailable.
export function reconcileAudioSessionSelection(
  previous: AudioSessionSelection,
  hosts: readonly AudioHost[],
  active: NativeAudioSelection | null = null,
): AudioSessionSelection {
  if (active) {
    const actual = {
      hostId: active.hostId,
      inputIndex: String(active.inputIndex),
      outputIndex: String(active.outputIndex),
      inputChannel: active.inputChannel,
    };
    return sameSelection(previous, actual) ? previous : actual;
  }
  const preferredHost = previous.hostId
    ? hosts.find((host) => host.id === previous.hostId)
    : hosts.find((host) => host.inputs.some((d) => d.supportsMonitor) &&
        host.outputs.some((d) => d.supportsMonitor));
  if (!preferredHost) return previous;
  let next = {
    hostId: preferredHost.id,
    inputIndex: previous.inputIndex || firstSupported(preferredHost.inputs),
    outputIndex: previous.outputIndex || firstSupported(preferredHost.outputs),
    inputChannel: previous.inputChannel,
  };
  if (!previous.outputIndex && preferredHost.id.toLowerCase() === "asio") {
    next = { ...selectAudioInput(next, preferredHost, next.inputIndex), inputChannel: previous.inputChannel };
  }
  return sameSelection(previous, next) ? previous : next;
}

export function selectAudioHost(
  hosts: readonly AudioHost[], hostId: string,
): AudioSessionSelection {
  const host = hosts.find((candidate) => candidate.id === hostId);
  const initial = {
    hostId,
    inputIndex: host ? firstSupported(host.inputs) : "",
    outputIndex: host ? firstSupported(host.outputs) : "",
    inputChannel: 0,
  };
  return host ? selectAudioInput(initial, host, initial.inputIndex) : initial;
}

/** ASIO is duplex: one driver owns both the guitar input and playback. */
export function selectAudioInput(
  previous: AudioSessionSelection, host: AudioHost, inputIndex: string,
): AudioSessionSelection {
  const next = { ...previous, inputIndex, inputChannel: 0 };
  if (host.id.toLowerCase() !== "asio") return next;
  const input = host.inputs.find(d => String(d.index) === inputIndex);
  const output = host.outputs.find(d => d.supportsMonitor && d.name === input?.name);
  return { ...next, outputIndex: output ? String(output.index) : "" };
}

export function isAudioSessionSelectionValid(
  selection: AudioSessionSelection,
  hosts: readonly AudioHost[],
): boolean {
  const host = hosts.find((h) => h.id === selection.hostId);
  if (!host) return false;
  const input = host.inputs.find((d) => d.supportsMonitor && String(d.index) === selection.inputIndex);
  const output = host.outputs.find((d) => d.supportsMonitor && String(d.index) === selection.outputIndex);
  return Boolean(input && output &&
    (host.id.toLowerCase() !== "asio" || input.name === output.name) &&
    selection.inputChannel >= 0 && selection.inputChannel < input.channels);
}

function sameSelection(a: AudioSessionSelection, b: AudioSessionSelection): boolean {
  return a.hostId === b.hostId && a.inputIndex === b.inputIndex &&
    a.outputIndex === b.outputIndex && a.inputChannel === b.inputChannel;
}
