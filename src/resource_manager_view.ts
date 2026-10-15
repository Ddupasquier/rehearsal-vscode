import type { ResourceInventoryData } from "./contracts.js";
import type { WorkspacePreferences } from "./workspace_preferences.js";

const html = (value: unknown): string =>
  String(value ?? "Not reported")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const size = (bytes: number | null): string =>
  bytes === null
    ? "Size unavailable"
    : bytes < 1024 ** 3
      ? `${(bytes / 1024 ** 2).toFixed(1)} MiB`
      : `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
const time = (value: string | null): string => value ?? "Not observable";
const environmentProvenanceMarkup = (
  provenance: ResourceInventoryData["environments"][number]["provenance"],
): string => {
  if (!provenance)
    return "<div><dt>Runtime provenance</dt><dd>Not supplied by this core version. Refresh after updating Rehearsal; do not infer it from the environment name.</dd></div>";
  const runtime = provenance.runtime;
  const unavailable =
    provenance.runtimeReason === "receipt-invalid"
      ? "The local runtime receipt is incompatible or invalid. Use Verify to inspect the prepared runtime before relying on it."
      : "A readable local runtime receipt is unavailable. This does not prove the database is absent.";
  return `<div><dt>Inspecting Rehearsal version</dt><dd><code>${html(provenance.inspectorVersion)}</code></dd></div>
    <div><dt>Recorded runtime Rehearsal version</dt><dd>${runtime?.rehearsalVersion ? `<code>${html(runtime.rehearsalVersion)}</code>` : runtime ? "Not recorded by this older runtime. The inspecting version is not its creator version." : html(unavailable)}</dd></div>
    <div><dt>Recorded baseline generation</dt><dd>${runtime ? `<code>${html(runtime.baselineGenerationId)}</code>` : "Unavailable without a valid local receipt"}</dd></div>
    <div><dt>Recorded baseline data SHA-256</dt><dd>${runtime ? `<code>${html(runtime.baselineDataSha256)}</code>` : "Unavailable without a valid local receipt"}</dd></div>
    <div><dt>Recorded candidate migration digest</dt><dd>${runtime?.candidateSha256 ? `<code>${html(runtime.candidateSha256)}</code>` : runtime?.migrationReason === "receipt-does-not-match-baseline" ? "Unavailable: migration receipt does not match this runtime's baseline and provider." : "Unavailable: no matching migration receipt was recorded."}</dd></div>
    <div><dt>Configured loopback ports</dt><dd>${provenance.configuredPorts.map((endpoint) => `<span><code>${html(endpoint.service)} · ${html(endpoint.host)}:${endpoint.port}</code></span>`).join("<br />") || "Not supplied"}<small>Configuration facts, not a probe that these addresses are listening.</small></dd></div>
    <div><dt>Provenance scope</dt><dd>Recorded local receipts only. This inspection did not reverify database contents, migration history, or baseline checksums; use Verify for fresh evidence.</dd></div>`;
};
const attributes = (
  kind: string,
  name: string,
  state: string,
  ownership: string,
  bytes: number | null,
  createdAt: string | null,
  lastActivityAt: string | null,
  target: string | null = null,
): string =>
  `data-resource-row data-kind="${kind}" data-view-target="${html(target ?? "")}" data-name="${html(name.toLowerCase())}" data-state="${html(state)}" data-ownership="${ownership}" data-size="${bytes ?? -1}" data-created="${createdAt ? Date.parse(createdAt) : 0}" data-last="${lastActivityAt ? Date.parse(lastActivityAt) : 0}"`;
const action = (
  target: string,
  action: string,
  label: string,
  disabled = false,
): string =>
  `<button class="button button--${action === "discardRuntime" ? "danger" : "secondary"}" type="button" data-resource-target="${html(target)}" data-resource-action="${action}"${disabled ? " disabled" : ""}>${label}</button>`;
export const resourceManagerMarkup = (
  inventory: ResourceInventoryData,
  preferences: WorkspacePreferences,
): string => {
  const observedCatalog = inventory.catalog;
  if (observedCatalog === undefined)
    return '<div class="empty-state">Individual resource browsing needs a core release that advertises the resource-manager contract. Update Rehearsal to use it.</div>';
  const catalog = observedCatalog ?? {
    schemaVersion: 1,
    images: [],
    volumes: [],
    otherContainers: [],
  };
  const select = (
    name: string,
    options: readonly (readonly [string, string])[],
    value: string,
  ) =>
    `<label><span>${html(name)}</span><select id="resource-${name.toLowerCase()}">${options.map(([key, label]) => `<option value="${key}"${value === key ? " selected" : ""}>${label}</option>`).join("")}</select></label>`;
  return `<div class="local-resource-manager">
    ${observedCatalog === null ? '<div class="empty-state"><strong>Docker is stopped; resource contents are not checked.</strong><span>You can still review environment names and protection. Start your engine explicitly, then refresh to inspect images and volume attachments.</span></div>' : ""}
    <p id="resource-preview-notice" class="control-note" role="status" hidden></p>
    <nav class="resource-categories" aria-label="Local resource categories">${[
      ["all", "All resources"],
      ["environment", "Environments"],
      ["volume", "Data volumes"],
      ["image", "Images"],
      ["other", "Other projects"],
    ]
      .map(
        ([kind, label]) =>
          `<button type="button" class="button button--secondary" data-resource-kind="${kind}" aria-pressed="${preferences.resourceKind === kind}">${label}</button>`,
      )
      .join("")}</nav>
    <div class="resource-toolbar">
      <label><span>Search resources</span><input id="resource-search" type="search" maxlength="120" placeholder="Name, tag, service, or ID" value="${html(preferences.resourceQuery)}" /></label>
      ${select(
        "Kind",
        [
          ["all", "All resources"],
          ["environment", "Environments"],
          ["volume", "Data volumes"],
          ["image", "Images"],
          ["other", "Other containers"],
        ],
        preferences.resourceKind,
      )}
      ${select(
        "State",
        [
          ["all", "Any state"],
          ["running", "Running"],
          ["stopped", "Stopped"],
          ["candidate", "Safe image candidates"],
          ["protected", "Protected"],
          ["attached", "Attached volumes"],
          ["detached", "Detached volumes"],
        ],
        preferences.resourceState,
      )}
      ${select(
        "Ownership",
        [
          ["all", "All ownership"],
          ["project", "This project"],
          ["shared", "Shared images"],
          ["other", "Other / unknown"],
        ],
        preferences.resourceOwnership,
      )}
      ${select(
        "Sort",
        [
          ["name", "Name"],
          ["size", "Largest first"],
          ["age", "Oldest first"],
          ["activity", "Last observable use"],
        ],
        preferences.resourceSort,
      )}
    </div>
    <div class="resource-summary"><span id="resource-visible-count" role="status"></span><button id="resource-largest" class="button button--secondary" type="button">Show largest first</button></div>
    <section class="resource-section" aria-labelledby="resource-environments-heading"><div class="surface-heading"><span><small>Environments</small><h3 id="resource-environments-heading">Your project sandboxes</h3></span><span class="state-chip">${inventory.environments.length}</span></div><div class="resource-list">${inventory.environments
      .map(
        (
          entry,
        ) => `<article class="resource-card" ${attributes("environment", `${entry.displayName ?? entry.target} ${entry.projectId}`, `${entry.state}${entry.protected ? " protected" : ""}`, "project", entry.diskUsageBytes, entry.createdAt, entry.lastActivityAt, entry.target)}>
      <div class="resource-card__heading"><strong>${html(entry.displayName ?? entry.target)}</strong><span class="state-chip">${html(entry.state)}${entry.protected ? " · protected" : ""}</span></div>
      <p>${html(entry.provider)} · ${entry.containerCount} containers · ${entry.volumeCount} data volumes · ${size(entry.diskUsageBytes)}</p>
      <p>Last observable resource activity: ${html(time(entry.lastActivityAt))}</p>
      <details><summary>Inspect environment</summary><dl class="resource-facts"><div><dt>Immutable ID</dt><dd><code>${html(entry.projectId)}</code></dd></div><div><dt>Target</dt><dd>${html(entry.target)}</dd></div><div><dt>CPU / memory</dt><dd>${entry.cpuPercent === null ? "Unknown" : `${entry.cpuPercent.toFixed(2)}%`} / ${size(entry.memoryUsageBytes)}</dd></div><div><dt>Oldest owned resource created</dt><dd>${html(time(entry.createdAt))}</dd></div><div><dt>Last inspected</dt><dd>${html(inventory.inspectedAt)}</dd></div>${environmentProvenanceMarkup(entry.provenance)}<div><dt>Restart policy</dt><dd>${html(entry.restartPolicies.join(", ") || "Not present")}</dd></div><div><dt>Images used across this project</dt><dd>${html(
        catalog.images
          .filter((image) =>
            image.references.some((ref) => ref.ownership === "project"),
          )
          .flatMap((image) => image.tags)
          .join(", ") || "Not observed",
      )}</dd></div></dl><p class="control-note">This is one configured target, not a historical database copy. Named profiles select views of configured targets. Created and last observable activity come from owned container/volume metadata, not database access or user inactivity.</p></details>
      <form class="resource-environment-form" data-resource-target="${html(entry.target)}"><label><span>Friendly name</span><input name="environmentName" maxlength="100" required value="${html(entry.displayName ?? entry.target)}" /></label><label class="resource-protection"><input name="protectEnvironment" type="checkbox"${entry.protected ? " checked" : ""} /><span>Protect this environment’s data</span></label><button class="button button--secondary" type="submit">Review name & protection</button></form>
      <p class="control-note">${entry.protected ? "Protected: reset, rehearsal run, discard, and runtime cleanup are blocked until you explicitly unprotect it." : "Stopping preserves data. Discard removes this environment’s database and Storage volumes after review."}</p>
      <div class="action-group">${action(entry.target, "startRuntime", "Start", !["stopped"].includes(entry.state))}${action(entry.target, "stopRuntime", "Stop", !["running", "mixed"].includes(entry.state))}${action(entry.target, "discardRuntime", "Review discard", entry.protected || ["absent", "unavailable"].includes(entry.state))}</div>
    </article>`,
      )
      .join("")}</div></section>
    <section class="resource-section" aria-labelledby="resource-volumes-heading"><div class="surface-heading"><span><small>Data volumes</small><h3 id="resource-volumes-heading">Database and Storage data</h3></span><span class="state-chip">Individual deletion disabled</span></div><p class="surface-copy">Volumes hold persistent data. Attached includes mounts on stopped containers. Remove project data only through its owning environment’s reviewed discard.</p><div class="resource-list">${catalog.volumes.map((volume) => `<article class="resource-card" ${attributes("volume", volume.name, `${volume.state}${volume.protected ? " protected" : ""}`, volume.ownership === "project" ? "project" : "other", volume.bytes, volume.createdAt, volume.lastActivityAt, volume.ownership === "project" ? volume.target : null)}><div class="resource-card__heading"><strong><code>${html(volume.name)}</code></strong><span class="state-chip">${html(volume.state)}${volume.protected ? " · protected" : ""}</span></div><p>${html(volume.purpose === "unknown" ? "Purpose not proven" : volume.purpose)} · ${size(volume.bytes)} · ${volume.containerCount} container references</p><p>Owner: ${html(volume.target ?? "Other / unknown")} · Last observable use: ${html(time(volume.lastActivityAt))}</p><p class="resource-reason">${html(volume.reason)}</p>${volume.target && volume.ownership === "project" ? `<div class="action-group">${action(volume.target, "discardRuntime", "Review owning environment", volume.protected)}</div>` : ""}</article>`).join("") || '<p class="empty-state">No volumes were observed.</p>'}</div></section>
    <section class="resource-section" aria-labelledby="resource-images-heading"><div class="surface-heading"><span><small>Images</small><h3 id="resource-images-heading">Reusable service software</h3></span><span class="state-chip">${catalog.images.length} images</span></div><p class="surface-copy">Images are templates, not mounted data. Running and stopped container references prevent cleanup. The newest cached service version is retained.</p><div class="resource-list">${catalog.images.map((image) => `<article class="resource-card" ${attributes("image", `${image.service} ${image.id} ${image.tags.join(" ")}`, image.state, "shared", image.bytes, image.createdAt, null)}><div class="resource-card__heading"><label class="resource-image-label"><input type="checkbox" data-image-id="${html(image.id)}" data-image-bytes="${image.bytes}"${image.state !== "candidate" ? " disabled" : ""} aria-label="Select ${html(image.service)} ${html(image.tags[0] ?? image.id)} for image cleanup" /><strong>${html(image.service)}</strong></label><span class="state-chip">${html(image.state === "candidate" ? "Safe cleanup candidate" : image.state.replaceAll("-", " "))}</span></div><p>${size(image.bytes)} · Created ${html(image.createdAt)}</p><div class="resource-tags">${image.tags.map((tag) => `<code>${html(tag)}</code>`).join("") || "No tags"}</div><p class="resource-reason">${html(image.reason)}</p><details><summary>Exact identity and references</summary><code>${html(image.id)}</code>${image.digests.map((digest) => `<code>${html(digest)}</code>`).join("")}<ul>${image.references.map((ref) => `<li>${html(ref.name)} · ${ref.running ? "running" : "stopped"} · ${ref.ownership === "project" ? "this project" : "other project"}</li>`).join("") || "<li>No container references</li>"}</ul></details></article>`).join("") || '<p class="empty-state">No images were observed.</p>'}</div><div class="image-cleanup-review"><p id="image-selection-summary" role="status">Select eligible images to estimate cleanup.</p><p class="control-note">Estimated image size is an upper bound: shared layers may reduce recovered space. This action selects zero containers, data volumes, or baselines.</p><div class="action-group"><button id="select-eligible-images" type="button" class="button button--secondary">Select visible safe candidates</button><button id="clear-image-selection" type="button" class="button button--secondary">Clear selection</button><button id="review-image-cleanup" type="button" class="button button--danger" disabled>Review selected image cleanup</button></div></div></section>
    <section class="resource-section" aria-labelledby="resource-others-heading"><div class="surface-heading"><span><small>Other local resources</small><h3 id="resource-others-heading">Other projects on this engine</h3></span><span class="state-chip">Read only</span></div><p class="surface-copy">These contribute to shared capacity. Rehearsal cannot modify them; manage them through their owning project.</p><div class="resource-list">${catalog.otherContainers.map((container) => `<article class="resource-card" ${attributes("other", `${container.name} ${container.id}`, container.running ? "running" : "stopped", "other", null, null, null)}><div class="resource-card__heading"><strong>${html(container.name)}</strong><span class="state-chip">${container.running ? "running" : "stopped"}</span></div><p class="resource-reason">${html(container.reason)}</p><details><summary>Container ID</summary><code>${html(container.id)}</code></details></article>`).join("") || '<p class="empty-state">No other containers were observed.</p>'}</div></section>
    <p id="resources-empty" class="empty-state" hidden>No resources match these filters. Clear the search or choose All resources.</p>
  </div>`;
};

export const RESOURCE_MANAGER_SCRIPT = `
const postResourceMessage = (message) => {
  if(vscode) { vscode.postMessage(message); return; }
  const notice=document.querySelector('#resource-preview-notice'); if(!notice)return;
  notice.hidden=false;
  notice.textContent=message.type==='cleanupImages' ? 'Preview only: in VS Code, this opens a fresh core review with exact image tags, IDs, estimates, and zero selected data volumes. No resource is changed here.' : message.type==='reviewResourceConfiguration' ? 'Preview only: in VS Code, you review the exact configuration diff before saving the friendly name or protection policy. No file is changed here.' : 'Preview only: in VS Code, this shows the exact command and environment before approval. No runtime is changed here.';
  notice.scrollIntoView({block:'nearest',behavior:'auto'});
};
const resourceRows = [...document.querySelectorAll('[data-resource-row]')];
const resourceSearch = document.querySelector('#resource-search');
const resourceKind = document.querySelector('#resource-kind');
const resourceState = document.querySelector('#resource-state');
const resourceOwnership = document.querySelector('#resource-ownership');
const resourceSort = document.querySelector('#resource-sort');
const updateResourceView = () => {
  const query = resourceSearch?.value.trim().toLowerCase() ?? '';
  const kind = resourceKind?.value ?? 'all';
  const state = resourceState?.value ?? 'all';
  const ownership = resourceOwnership?.value ?? 'all';
  const sort = resourceSort?.value ?? 'name';
  document.querySelectorAll('[data-resource-kind]').forEach(control=>control.setAttribute('aria-pressed',String(control.dataset.resourceKind===kind)));
  const scope = currentViewScope();
  resourceRows.forEach(row => { const scoped = row.dataset.viewTarget ? scope.targets.includes(row.dataset.viewTarget) : !scope.onlyProjectOwned; row.hidden = !(scoped && row.dataset.name.includes(query) && (kind==='all'||row.dataset.kind===kind) && (state==='all'||row.dataset.state.split(' ').includes(state)) && (ownership==='all'||row.dataset.ownership===ownership)); });
  document.querySelectorAll('.resource-list').forEach(list => {
    const rows = [...list.querySelectorAll('[data-resource-row]')];
    rows.sort((a,b) => sort==='size' ? Number(b.dataset.size)-Number(a.dataset.size) : sort==='age' ? (Number(a.dataset.created)||Infinity)-(Number(b.dataset.created)||Infinity) : sort==='activity' ? Number(b.dataset.last)-Number(a.dataset.last) : a.dataset.name.localeCompare(b.dataset.name));
    rows.forEach(row=>list.appendChild(row));
  });
  document.querySelectorAll('.resource-section').forEach(section=>{ section.hidden = resourceRows.length > 0 && ![...section.querySelectorAll('[data-resource-row]')].some(row=>!row.hidden); });
  const visible = resourceRows.filter(row=>!row.hidden).length;
  const count = document.querySelector('#resource-visible-count'); if(count)count.textContent = visible+' of '+resourceRows.length+' resources shown';
  const empty = document.querySelector('#resources-empty'); if(empty)empty.hidden = visible > 0;
  preferences.resourceQuery=query; preferences.resourceKind=kind; preferences.resourceState=state; preferences.resourceOwnership=ownership; preferences.resourceSort=sort; savePreferences();
  updateImageSelection();
};
resourceSearch?.addEventListener('input',updateResourceView);
[resourceKind,resourceState,resourceOwnership,resourceSort].forEach(control=>control?.addEventListener('change',updateResourceView));
document.querySelectorAll('[data-resource-kind]').forEach(control=>control.addEventListener('click',()=>{if(resourceKind)resourceKind.value=control.dataset.resourceKind;updateResourceView();}));
document.querySelector('#resource-largest')?.addEventListener('click',()=>{if(resourceSort)resourceSort.value='size';updateResourceView();});
const imageCheckboxes = [...document.querySelectorAll('[data-image-id]')];
const restoredImageIds = new Set(reconcileImageSelection(savedUi.images,imageCheckboxes.filter(input=>!input.disabled).map(input=>input.dataset.imageId)));
imageCheckboxes.forEach(input=>{input.checked=!input.disabled&&restoredImageIds.has(input.dataset.imageId);});
const updateImageSelection = () => { const selected=imageCheckboxes.filter(input=>input.checked&&!input.disabled); const bytes=selected.reduce((total,input)=>total+Number(input.dataset.imageBytes),0);const hidden=selected.filter(input=>input.closest('[data-resource-row]').hidden).length;const summary=document.querySelector('#image-selection-summary');if(summary)summary.textContent=selected.length+' images selected'+(hidden?' ('+hidden+' outside current filters)':'')+' · up to '+(bytes/1024**3).toFixed(2)+' GiB · zero data volumes'+(selected.length>100?' · Select at most 100 images per review':''); const review=document.querySelector('#review-image-cleanup');if(review)review.disabled=selected.length===0||selected.length>100; rememberUi(); };
imageCheckboxes.forEach(input=>input.addEventListener('change',updateImageSelection));
document.querySelector('#select-eligible-images')?.addEventListener('click',()=>{let remaining=100-imageCheckboxes.filter(input=>input.checked&&!input.disabled).length;imageCheckboxes.forEach(input=>{if(!input.disabled&&!input.checked&&!input.closest('[data-resource-row]').hidden&&remaining>0){input.checked=true;remaining--;}});updateImageSelection();});
document.querySelector('#clear-image-selection')?.addEventListener('click',()=>{imageCheckboxes.forEach(input=>input.checked=false);updateImageSelection();});
document.querySelector('#review-image-cleanup')?.addEventListener('click',()=>{postResourceMessage({type:'cleanupImages',ids:imageCheckboxes.filter(input=>input.checked&&!input.disabled).map(input=>input.dataset.imageId)});});
document.querySelectorAll('[data-resource-action]').forEach(control=>control.addEventListener('click',()=>{postResourceMessage({type:'resourceAction',target:control.dataset.resourceTarget,action:control.dataset.resourceAction});}));
document.querySelectorAll('.resource-environment-form').forEach(form=>form.addEventListener('submit',event=>{event.preventDefault();postResourceMessage({type:'reviewResourceConfiguration',target:form.dataset.resourceTarget,values:{environmentName:form.elements.environmentName.value,protectEnvironment:form.elements.protectEnvironment.checked}});}));
updateResourceView(); updateImageSelection();
`;
