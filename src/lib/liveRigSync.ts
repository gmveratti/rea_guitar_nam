/** Serialize native graph updates and coalesce edits made during model loading. */
export function createLiveRigSync(callbacks: {
  apply: (manifest: string) => Promise<unknown>;
  onApplied: (manifest: string) => void;
  onError: (error: unknown) => void;
  onBusy: (busy: boolean) => void;
}) {
  let active = false;
  let epoch = 0;
  let pending: string | null = null;
  let applied: string | null = null;
  let failed: string | null = null;
  let flushing = false;

  async function flush() {
    if (flushing || !active) return;
    flushing = true;
    const generation = epoch;
    callbacks.onBusy(true);
    try {
      while (active && epoch === generation && pending && pending !== applied && pending !== failed) {
        const requested = pending;
        try {
          await callbacks.apply(requested);
          if (!active || epoch !== generation) break;
          applied = requested;
          failed = null;
          callbacks.onApplied(requested);
        } catch (error) {
          if (!active || epoch !== generation) break;
          failed = requested;
          callbacks.onError(error);
        }
      }
    } finally {
      flushing = false;
      callbacks.onBusy(false);
      // A new session may have begun while the cancelled request completed.
      if (active && epoch !== generation) void flush();
    }
  }

  return {
    begin(manifest: string | null) {
      epoch += 1;
      active = true;
      applied = manifest;
      pending = null;
      failed = null;
    },
    request(manifest: string) {
      pending = manifest;
      if (manifest !== failed) failed = null;
      void flush();
    },
    stop() {
      epoch += 1;
      active = false;
      pending = null;
      failed = null;
    },
  };
}
