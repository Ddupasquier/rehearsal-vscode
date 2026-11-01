export interface AutomaticDashboardRequest {
  readonly enabled: boolean;
  readonly trusted: boolean;
  readonly workspaceKeys: readonly string[];
  readonly updatedWorkspaceKey: string;
}

/**
 * Chooses at most one unambiguous dashboard per extension-host session.
 * Closing that dashboard is respected: later refreshes do not reopen it.
 */
export class AutomaticDashboardController {
  private readonly opened = new Set<string>();

  choose(request: AutomaticDashboardRequest): string | undefined {
    if (!request.enabled || !request.trusted) return undefined;
    if (request.workspaceKeys.length !== 1) return undefined;
    const [workspaceKey] = request.workspaceKeys;
    if (
      !workspaceKey ||
      workspaceKey !== request.updatedWorkspaceKey ||
      this.opened.has(workspaceKey)
    ) {
      return undefined;
    }
    this.opened.add(workspaceKey);
    return workspaceKey;
  }
}
