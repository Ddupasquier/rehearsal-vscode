/** Update-choice presentation only. No editor, network or installation capability. */
export interface AutomaticUpdatePreferences {
  readonly extension: boolean;
  readonly cli: boolean;
}

export interface UpdatePromptContent {
  readonly workspaceName: string;
  readonly core: {
    readonly installed: string | null;
    readonly available: string;
    readonly eligible: boolean;
  } | null;
  readonly extension: {
    readonly installed: string;
    readonly available: string;
  } | null;
  readonly channel: "stable" | "preview";
  readonly automatic: AutomaticUpdatePreferences;
}

export type UpdatePromptChoice =
  "core" | "extension" | "preferences" | "later" | "skip" | "disable";

export interface UpdatePromptResult {
  readonly choice: UpdatePromptChoice;
  readonly automatic: AutomaticUpdatePreferences;
}

export interface UpdatePromptAssets {
  readonly resourceSource: string;
  readonly stylesheetUri: string;
  readonly scriptNonce: string;
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const automaticPreferences = (
  value: unknown,
): value is AutomaticUpdatePreferences =>
  record(value) &&
  exactKeys(value, ["extension", "cli"]) &&
  typeof value.extension === "boolean" &&
  typeof value.cli === "boolean";
const boundedText = (value: unknown, maximum: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximum &&
  !/[\x00-\x1f\x7f]/u.test(value);

export const validateUpdatePromptContent = (
  value: UpdatePromptContent,
): void => {
  if (
    !record(value) ||
    !boundedText(value.workspaceName, 300) ||
    !["stable", "preview"].includes(value.channel) ||
    !automaticPreferences(value.automatic) ||
    (value.core !== null &&
      (!record(value.core) ||
        (value.core.installed !== null &&
          !boundedText(value.core.installed, 80)) ||
        !boundedText(value.core.available, 80) ||
        typeof value.core.eligible !== "boolean")) ||
    (value.extension !== null &&
      (!record(value.extension) ||
        !boundedText(value.extension.installed, 80) ||
        !boundedText(value.extension.available, 80)))
  )
    throw new Error("The update prompt is invalid or too large.");
};

/** A checkbox draft is not consent until a corresponding explicit save/update choice. */
export const parseUpdatePromptMessage = (
  raw: unknown,
  token: string,
  content: UpdatePromptContent,
): UpdatePromptResult | undefined => {
  if (
    !record(raw) ||
    !exactKeys(raw, ["type", "token", "choice", "automatic"]) ||
    raw.type !== "updatePromptChoice" ||
    raw.token !== token ||
    typeof raw.choice !== "string" ||
    !["core", "extension", "preferences", "later", "skip", "disable"].includes(
      raw.choice,
    ) ||
    !automaticPreferences(raw.automatic) ||
    (raw.choice === "core" && content.core === null) ||
    (raw.choice === "extension" && content.extension === null)
  )
    return undefined;
  const savesPreferences =
    raw.choice === "preferences" ||
    raw.choice === "extension" ||
    (raw.choice === "core" && content.core?.eligible === true);
  const automatic = savesPreferences ? raw.automatic : content.automatic;
  return {
    choice: raw.choice as UpdatePromptChoice,
    automatic: { extension: automatic.extension, cli: automatic.cli },
  };
};

export const renderUpdatePromptDocument = (
  content: UpdatePromptContent,
  assets: UpdatePromptAssets,
): string => {
  validateUpdatePromptContent(content);
  if (
    !/^[A-Za-z0-9_-]{16,100}$/u.test(assets.scriptNonce) ||
    !boundedText(assets.resourceSource, 2000) ||
    !boundedText(assets.stylesheetUri, 4000)
  )
    throw new Error("The update prompt assets are invalid.");
  const button = (
    choice: UpdatePromptChoice,
    id: string,
    label: string,
    primary = false,
  ) =>
    `<button id="${id}" type="button" class="button button--${primary ? "primary" : "secondary"}" data-update-choice="${choice}">${label}</button>`;
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escapeHtml(assets.resourceSource)}; script-src 'nonce-${assets.scriptNonce}'; connect-src 'none'; form-action 'none'; base-uri 'none';" />
  <link rel="stylesheet" href="${escapeHtml(assets.stylesheetUri)}" />
  <title>Rehearsal updates</title>
</head><body class="review-panel"><main class="review-panel__main">
  <header class="review-panel__header"><p class="eyebrow">Rehearsal · ${escapeHtml(content.workspaceName)}</p><h1 id="update-prompt-heading" tabindex="-1">Keep Rehearsal up to date</h1><p>Review available updates and choose how future updates work. CLI and extension preferences are independent.</p><p>Release channel: <strong>${content.channel === "preview" ? "Preview" : "Stable"}</strong></p></header>
  <div class="resource-list update-release-list">
    ${content.core === null ? "" : `<section class="surface"><div class="surface-heading"><span><small>Rehearsal CLI</small><h2>${escapeHtml(content.core.installed ?? "Installed version not verified")} → ${escapeHtml(content.core.available)}</h2></span></div><p>${content.core.eligible ? "A compatible published CLI update is available for this project." : "This CLI update needs manual compatibility or installation review. It will not be installed automatically from this prompt."}</p></section>`}
    ${content.extension === null ? "" : `<section class="surface"><div class="surface-heading"><span><small>VS Code extension</small><h2>${escapeHtml(content.extension.installed)} → ${escapeHtml(content.extension.available)}</h2></span></div><p>Only a verified official VSIX is eligible for installation. Updating does not force a reload of this window.</p></section>`}
  </div>
  <section class="surface"><h2>Your update preferences</h2>
    <div class="update-preference"><label class="resource-protection"><input id="automatic-extension" type="checkbox"${content.automatic.extension ? " checked" : ""} aria-describedby="automatic-extension-description" /><span>Automatically keep the Rehearsal extension up to date</span></label>
    <p id="automatic-extension-description" class="control-note">Use verified official VSIX releases for the selected channel. Active sessions keep running; no forced window reload. Editor policy or unsupported environments may defer installation.</p></div>
    <div class="update-preference"><label class="resource-protection"><input id="automatic-cli" type="checkbox"${content.automatic.cli ? " checked" : ""} aria-describedby="automatic-cli-description" /><span>Automatically keep Rehearsal CLI dependencies up to date</span></label>
    <p id="automatic-cli-description" class="control-note">For projects already using Rehearsal, use compatible published npm updates only while the project is idle. An update changes the package manifest and lockfile with install scripts ignored. It performs no database operation. Unsupported package managers, ambiguous project state or policy may require manual review.</p></div>
    <p class="control-note">Enabled options allow checks at project opening and daily while this window stays open. Public npm/GitHub services see ordinary connection information, not your project files, paths, credentials or database data. Extension downloads use GitHub's official release asset service.</p>
    <p class="control-note">These independent preferences are saved in VS Code user settings only when you choose Save preferences or an update button. Later, Skip versions and closing this tab do not save checkbox edits. Reviewing an unsupported CLI update does not save them either. Disable updates turns off both automatic options on this computer and release checks for this project. You can also disable either automatic option in VS Code settings.</p>
  </section>
  <footer class="review-panel__actions"><p id="update-prompt-status" role="status" aria-live="polite" aria-atomic="true">Nothing changes until you choose an action. This prompt itself never installs anything or starts a database.</p><div class="action-group">
    ${content.core === null ? "" : button("core", "update-cli", content.core.eligible ? "Update CLI" : "Review CLI", content.core.eligible)}
    ${content.extension === null ? "" : button("extension", "update-extension", "Update extension", true)}
    ${button("preferences", "save-update-preferences", "Save preferences")}
    ${button("later", "update-later", "Later")}
    ${button("skip", "skip-update-versions", "Skip versions")}
    ${button("disable", "disable-update-checks", "Disable updates")}
  </div></footer>
</main><script nonce="${assets.scriptNonce}">
(() => {
  const vscode=typeof acquireVsCodeApi==='function'?acquireVsCodeApi():null;
  const token=${JSON.stringify(assets.scriptNonce)};
  let submitted=false;
  const controls=[...document.querySelectorAll('[data-update-choice]')];
  controls.forEach(control=>control.addEventListener('click',()=>{
    if(submitted)return;
    if(!vscode){document.querySelector('#update-prompt-status').textContent='Preview only. No update preferences or installations were changed.';return;}
    submitted=true;
    const automatic={extension:document.querySelector('#automatic-extension').checked,cli:document.querySelector('#automatic-cli').checked};
    controls.forEach(button=>button.disabled=true);
    vscode.postMessage({type:'updatePromptChoice',token,choice:control.dataset.updateChoice,automatic});
  }));
  document.querySelector('#update-prompt-heading').focus();
})();
</script></body></html>`;
};
