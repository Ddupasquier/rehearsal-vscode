import type { ProjectSnapshot } from "./project_snapshot.js";
const escape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export const coreConfigurationControls = (
  snapshot: ProjectSnapshot,
): string => {
  const metadata = snapshot.configurationMetadata;
  if (!metadata) return "";
  const fields = metadata.fields.filter((field) => field.kind !== "profiles");
  const idlePolicyVisible = fields.some(
    (field) =>
      field.path === "application.activity.url" ||
      field.path === "lifecycle.openIdleTimeoutSeconds",
  );
  return `<details class="technical-details"><summary>All supported structured settings</summary><p>${escape(metadata.pathResolution)}</p><form id="core-configuration-controls" class="configuration-controls">${fields
    .map((field) => {
      const id = `core-${field.path.replaceAll(".", "-")}`;
      const activity = field.path === "application.activity.url";
      const idleTimeout = field.path === "lifecycle.openIdleTimeoutSeconds";
      const options =
        field.kind === "boolean"
          ? ["true", "false"]
          : field.kind === "run-persistence"
            ? ["keep-until-stop", "stop-after-run"]
            : field.kind === "open-persistence"
              ? ["keep-until-stop", "stop-on-application-exit"]
              : field.kind === "review-schedule"
                ? ["manual", "daily-preview", "weekly-preview"]
                : null;
      const value = field.value === null ? "" : String(field.value);
      const input = options
        ? `<select id="${id}" name="${field.path}">${options.map((option) => `<option${option === value ? " selected" : ""}>${option}</option>`).join("")}</select>`
        : `<input id="${id}" name="${field.path}" aria-describedby="${id}-help" type="${["integer", "nullable-integer"].includes(field.kind) ? "number" : activity ? "url" : "text"}" value="${escape(value)}"${idleTimeout ? ' min="30" max="86400" step="1"' : ["integer", "nullable-integer"].includes(field.kind) ? ' min="0" step="1"' : activity ? ' maxlength="500"' : ' maxlength="1000"'} />`;
      const label = activity
        ? "Application activity endpoint (opt-in)"
        : idleTimeout
          ? "Foreground idle timeout (seconds)"
          : field.path;
      const explanation = activity
        ? "Empty disables this signal. Your application must implement the documented activity response at the same local origin as readiness; Rehearsal does not add instrumentation."
        : idleTimeout
          ? "Empty disables automatic idle stop. 30–86,400 seconds; requires a valid activity signal, readiness URL, and stop-on-application-exit. Core validates these together."
          : `Saved/default value · validated by core · review required${field.kind === "nullable-integer" ? " · empty disables this optional limit" : ""}`;
      return `<label><span>${escape(label)}</span>${input}<small id="${id}-help">${escape(explanation)}</small></label>`;
    })
    .join(
      "",
    )}<button type="submit" class="button button--primary">Review exact configuration diff</button></form>${idlePolicyVisible ? '<p class="control-note">Idle observation is opt-in and runs only during a package-owned rehearsal open session. Health responses, missing activity, and resource age are not proof of inactivity. No background daemon is installed.</p>' : ""}<p>${escape(metadata.manualFields)}</p></details>`;
};
export const namedProfileControls = (snapshot: ProjectSnapshot): string => {
  const metadata = snapshot.configurationMetadata;
  if (!metadata)
    return '<p class="control-note">Named project profiles require a core release advertising configuration review.</p>';
  const targets = snapshot.runtime?.targets.map((target) => target.name) ??
    snapshot.candidates?.targets.map((target) => target.name) ?? ["primary"];
  return `<details class="technical-details"><summary>Save a named project profile</summary><form id="named-profile-controls" class="configuration-controls"><label><span>Profile name</span><input name="name" maxlength="80" required placeholder="Feature branch" /></label><fieldset><legend>Targets to display</legend>${targets.map((target) => `<label><input type="checkbox" name="target" value="${escape(target)}"${target === "primary" ? " checked" : ""} /> ${escape(target)}</label>`).join("")}</fieldset><label><span>Optional local application URL</span><input name="applicationUrl" type="url" maxlength="500" placeholder="http://localhost:5175" /></label><button type="submit" class="button button--primary">Review profile diff</button><p>Saved in the active project configuration. Selecting a profile never starts, stops, resets, or changes data. Reusing a name explicitly replaces only that profile after diff review.</p></form></details>`;
};
export const CONFIGURATION_CONTROLS_SCRIPT = `
  document.querySelector('#core-configuration-controls')?.addEventListener('submit', event => { event.preventDefault(); vscode?.postMessage({type:'reviewConfiguration', values:{fields:Object.fromEntries(new FormData(event.currentTarget).entries())}}); });
  document.querySelector('#named-profile-controls')?.addEventListener('submit', event => { event.preventDefault(); const data = new FormData(event.currentTarget); const profile = {name:data.get('name'),targets:data.getAll('target'), ...(data.get('applicationUrl') ? {applicationUrl:data.get('applicationUrl')} : {})}; const profiles = namedProfiles.filter(item => item.name !== profile.name).map(({name,targets,applicationUrl})=>({name,targets,...(applicationUrl ? {applicationUrl} : {})})); profiles.push(profile); vscode?.postMessage({type:'reviewConfiguration',values:{fields:{profiles:JSON.stringify(profiles)}}}); });
`;
