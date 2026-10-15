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

/** Exact, workspace-relative files only; never interpret a configured filename as a glob. */
export const projectRefreshPatterns = (
  configuredPath: unknown,
): readonly string[] => {
  const paths = new Set<string>(PROJECT_REFRESH_PATHS);
  if (
    typeof configuredPath === "string" &&
    configuredPath.length <= 500 &&
    !/[\u0000-\u001f\u007f\\]/u.test(configuredPath)
  ) {
    const candidate = configuredPath.trim();
    if (
      candidate &&
      !candidate.startsWith("/") &&
      !candidate.endsWith("/") &&
      !/^[a-z][a-z\d+.-]*:/iu.test(candidate)
    ) {
      const segments: string[] = [];
      let insideWorkspace = true;
      for (const segment of candidate.split("/")) {
        if (segment === "" || segment === ".") continue;
        if (segment === "..") {
          if (segments.length === 0) {
            insideWorkspace = false;
            break;
          }
          segments.pop();
        } else segments.push(segment);
      }
      if (insideWorkspace && segments.length > 0) {
        paths.add(segments.join("/"));
      }
    }
  }
  // VS Code escapes glob metacharacters with single-character ranges, not backslashes.
  // https://code.visualstudio.com/docs/editor/glob-patterns#_why-does-my-glob-pattern-not-work
  return [...paths].map((path) =>
    path.replace(/[\[\]{}*?]/gu, (character) => `[${character}]`),
  );
};

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
