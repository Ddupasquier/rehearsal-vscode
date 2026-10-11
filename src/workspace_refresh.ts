export const PROJECT_REFRESH_PATHS = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "node_modules/@rehearsal-db/core/package.json",
  "rehearsal.config.mjs",
  "infrastructure/rehearsal/rehearsal.config.mjs",
] as const;

export class WorkspaceRefreshScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly refresh: (workspaceKey: string) => void | Promise<void>,
    private readonly delayMs = 900,
  ) {}

  schedule(workspaceKey: string): void {
    const existing = this.timers.get(workspaceKey);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(workspaceKey);
      void this.refresh(workspaceKey);
    }, this.delayMs);
    timer.unref?.();
    this.timers.set(workspaceKey, timer);
  }

  cancel(workspaceKey: string): void {
    const timer = this.timers.get(workspaceKey);
    if (timer) clearTimeout(timer);
    this.timers.delete(workspaceKey);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
