/** Exact non-destructive stale-stop preview. Container age is not proof of inactivity. */
export interface StaleStopReview {
  readonly digest: string;
  readonly context: string;
  readonly targets: readonly {
    target: string;
    projectId: string;
    displayName: string;
    containerCount: number;
    lastActivityAt: string;
  }[];
}
export const parseStaleStopReview = (
  value: unknown,
  configured: readonly { target: string; projectId: string }[],
): StaleStopReview => {
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid stale-environment preview.");
    return value as Record<string, unknown>;
  };
  const text = (value: unknown, max = 120): string => {
    if (
      typeof value !== "string" ||
      !value ||
      value.length > max ||
      /[\x00-\x1f\x7f]/u.test(value)
    )
      throw new Error("Invalid stale-environment evidence.");
    return value;
  };
  const hash = (value: unknown): string => {
    const v = text(value, 64);
    if (!/^[a-f0-9]{64}$/u.test(v))
      throw new Error("Invalid stale-environment digest.");
    return v;
  };
  const data = object(value);
  const plan = object(data.plan);
  if (
    data.mode !== "preview" ||
    plan.schemaVersion !== 1 ||
    plan.action !== "stop-stale" ||
    !Array.isArray(plan.targets) ||
    plan.targets.length > 32 ||
    !Array.isArray(plan.preserves) ||
    ![
      "database contents",
      "Storage contents",
      "containers",
      "volumes",
      "images",
      "immutable baselines",
      "shared engine",
      "other projects",
    ].every((item) => (plan.preserves as unknown[]).includes(item))
  )
    throw new Error("Unsafe stale-environment preview.");
  hash(plan.engineIdentity);
  hash(plan.projectRootSha256);
  const seen = new Set<string>();
  const allIds = new Set<string>();
  const observableTime = (value: unknown): string => {
    const time = text(value, 50);
    if (
      !Number.isFinite(Date.parse(time)) ||
      Date.parse(time) <= 0 ||
      Date.parse(time) > Date.now()
    )
      throw new Error("Invalid observable activity.");
    return time;
  };
  const targets = plan.targets.map((raw) => {
    const target = object(raw);
    const name = text(target.target);
    const projectId = text(target.projectId);
    const known = configured.find(
      (entry) => entry.target === name && entry.projectId === projectId,
    );
    if (
      !known ||
      seen.has(name) ||
      !["postgresql", "supabase"].includes(String(target.provider)) ||
      !Number.isSafeInteger(target.staleAfterSeconds) ||
      Number(target.staleAfterSeconds) < 1 ||
      !Array.isArray(target.containers) ||
      !target.containers.length ||
      target.containers.length > 1000
    )
      throw new Error("A stale target is not proven owned by this project.");
    seen.add(name);
    hash(target.configurationSha256);
    const activity = observableTime(target.lastObservableActivityAt);
    const ids = new Set<string>();
    const times: string[] = [];
    let running = false;
    for (const rawContainer of target.containers) {
      const container = object(rawContainer);
      const id = hash(container.id);
      if (
        ids.has(id) ||
        allIds.has(id) ||
        typeof container.running !== "boolean"
      )
        throw new Error("Incomplete container bindings.");
      ids.add(id);
      allIds.add(id);
      if (container.startedAt !== null)
        times.push(observableTime(container.startedAt));
      if (container.finishedAt !== null)
        times.push(observableTime(container.finishedAt));
      if (container.running && container.startedAt === null)
        throw new Error("A running container has no observable start time.");
      running ||= container.running;
    }
    if (!running)
      throw new Error(
        "Already stopped targets cannot be requested for stale-stop.",
      );
    if (
      !times.length ||
      Math.max(...times.map(Date.parse)) !== Date.parse(activity)
    )
      throw new Error("Container activity contradicts its review summary.");
    return {
      target: name,
      projectId,
      displayName: text(target.displayName),
      containerCount: ids.size,
      lastActivityAt: activity,
    };
  });
  return { digest: hash(plan.digest), context: text(plan.context), targets };
};
