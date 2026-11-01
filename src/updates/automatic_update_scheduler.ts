/** Runs only while the host confirms at least one automatic-update opt-in. */
export class AutomaticUpdateScheduler {
  private enabled = false;
  private disposed = false;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly callback: () => Promise<void>,
    private readonly intervalMs = 86_400_000,
  ) {
    if (
      !Number.isFinite(intervalMs) ||
      intervalMs <= 0 ||
      intervalMs > 2_147_483_647
    )
      throw new RangeError(
        "Automatic update interval must be a positive timer duration.",
      );
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    this.clearTimer();
    if (enabled) void this.check();
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async check(): Promise<void> {
    if (this.disposed || !this.enabled || this.running) return;
    this.running = true;
    try {
      await this.callback();
    } catch {
      // A failed advisory is not an unhandled rejection or an immediate retry loop.
    } finally {
      this.running = false;
      if (this.enabled && !this.disposed)
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.check();
        }, this.intervalMs);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.enabled = false;
    this.clearTimer();
  }
}
