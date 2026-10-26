import { describe, expect, it } from "vitest";
import { audioFaultReason } from "./audioFaults";

describe("audio device failure diagnostics", () => {
  it("identifies disconnected guitar input", () => {
    expect(audioFaultReason({ inputFailed: true, outputFailed: false }))
      .toBe("entrada de áudio");
  });

  it("identifies playback failure without accusing the NAM sidecar", () => {
    expect(audioFaultReason({ inputFailed: false, outputFailed: true, engineFailed: false }))
      .toBe("saída de áudio");
  });

  it("identifies DSP engine failure independently from a device failure", () => {
    expect(audioFaultReason({ inputFailed: false, outputFailed: false, engineFailed: true }))
      .toBe("motor NAM/IR");
  });

  it("lists simultaneous failures and handles unknown causes safely", () => {
    expect(audioFaultReason({ inputFailed: true, outputFailed: true, engineFailed: true }))
      .toBe("entrada de áudio, saída de áudio, motor NAM/IR");
    expect(audioFaultReason({ inputFailed: false, outputFailed: false }))
      .toBe("origem não identificada");
  });
});
