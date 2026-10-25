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
const environmentClassificationMarkup = (
  entry: ResourceInventoryData["environments"][number],
): string => {
  const classification = entry.classification;
  if (!classification)
    return '<p class="control-note">Creation, receipt compatibility and long-running review status are unavailable from this core version. Missing verification is not proof that an environment was never created.</p>';
  const presence =
    classification.presence.state === "created"
      ? "Created"
      : classification.presence.state === "not-created"
        ? "Not created"
        : "Creation unknown";
  const receipt =
    classification.receipt.state === "compatible"
      ? "Recorded format and provider supported"
      : classification.receipt.state === "incompatible"
        ? "Incompatible receipt — inspect before reuse"
        : "Receipt compatibility unknown";
  const review =
    classification.review.state === "due"
      ? "Long-running review due"
      : classification.review.state === "disabled"
        ? "Long-running review disabled"
        : classification.review.state === "unknown"
          ? "Long-running review unavailable"
          : "No long-running review due";
  return `<p class="resource-classification"><strong>${presence}</strong> · Persistent data · ${review}</p><p>${receipt}</p><details><summary>Why these environment states?</summary><dl class="resource-facts"><div><dt>Resource role</dt><dd>Configured environment; not a disposable helper. Stop/start preserves data; reviewed reset/run can replace data and volumes; discard removes volumes. Stop-after-run also preserves data.</dd></div><div><dt>Presence</dt><dd>${presence}. ${classification.presence.state === "created" ? "Exact owned containers or volumes were observed." : classification.presence.state === "not-created" ? "A complete ownership inspection found no containers or volumes for this target." : "Ownership inspection is unavailable; existing resources may still be retained."}</dd></div><div><dt>Receipt compatibility</dt><dd>${receipt}. This checks recorded receipt format and provider only, not writer-version compatibility, current database contents, or fresh verification.${classification.receipt.reason === "provider-not-recorded" ? " The legacy receipt does not record its provider." : ""}</dd></div><div><dt>Long-running review</dt><dd>${review}${classification.review.staleAfterSeconds === null ? "" : ` · configured cutoff ${classification.review.staleAfterSeconds} seconds`}${classification.review.lastObservableActivityAt ? ` · last observable container start/stop ${html(classification.review.lastObservableActivityAt)}` : ""}. Resource age does not prove application, database or user inactivity; nothing stops automatically.</dd></div></dl></details>`;
};
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
export const resourcePaginationMarkup = (
  kind: string,
  label: string,
  prefix: "resource" | "summary" = "resource",
): string =>
  `<p id="${prefix}-${kind}-empty" class="empty-state" hidden>No ${html(label.toLowerCase())} match this view.</p><nav id="${prefix}-${kind}-pagination" class="resource-pagination" data-${prefix}-pagination="${kind}" aria-label="${html(label)} pages"><span id="${prefix}-${kind}-range" class="resource-pagination__range" role="status" aria-live="polite" aria-atomic="true"></span><div class="resource-pagination__controls"><button id="${prefix}-${kind}-previous" class="button button--secondary" type="button" data-${prefix}-page-kind="${kind}" data-${prefix}-page-action="previous" aria-label="Previous page of ${html(label.toLowerCase())}">Previous</button><button id="${prefix}-${kind}-next" class="button button--secondary" type="button" data-${prefix}-page-kind="${kind}" data-${prefix}-page-action="next" aria-label="Next page of ${html(label.toLowerCase())}">Next</button></div></nav>`;
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
  const pagination = resourcePaginationMarkup;
  return `<div class="local-resource-manager">
    ${observedCatalog === null ? '<div class="empty-state"><strong>Engine inspection is unavailable; resource contents are not checked.</strong><span>You can still review environment names and protection. This does not prove a VM is stopped. Review the engine controls, then refresh to inspect images and volume attachments.</span></div>' : ""}
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
          ["created", "Created environments"],
          ["not-created", "Not created"],
          ["review-due", "Long-running review due"],
          ["incompatible", "Incompatible receipts"],
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
      <label><span>Rows per list</span><select id="resource-page-size"><option value="5" selected>5</option><option value="10">10</option><option value="25">25</option></select></label>
    </div>
    <div class="resource-summary"><span id="resource-visible-count" role="status"></span><button id="resource-largest" class="button button--secondary" type="button">Show largest first</button></div>
    <section class="resource-section" data-resource-section="environment" aria-labelledby="resource-environments-heading"><div class="surface-heading"><span><small>Environments</small><h3 id="resource-environments-heading">Your project sandboxes</h3></span><span class="state-chip">${inventory.environments.length}</span></div><div class="resource-list" data-resource-list="environment">${inventory.environments
      .map(
        (
          entry,
        ) => `<article class="resource-card" ${attributes("environment", `${entry.displayName ?? entry.target} ${entry.projectId}`, `${entry.state}${entry.protected ? " protected" : ""}${entry.classification ? ` ${entry.classification.presence.state}${entry.classification.review.state === "due" ? " review-due" : ""}${entry.classification.receipt.state === "incompatible" ? " incompatible" : ""}` : ""}`, "project", entry.diskUsageBytes, entry.createdAt, entry.lastActivityAt, entry.target)}>
      <div class="resource-card__heading"><strong>${html(entry.displayName ?? entry.target)}</strong><span class="state-chip">${html(entry.state)}${entry.protected ? " · protected" : ""}</span></div>
      <p>${html(entry.provider)} · ${entry.containerCount} containers · ${entry.volumeCount} data volumes · ${size(entry.diskUsageBytes)}</p>
      ${environmentClassificationMarkup(entry)}
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
      .join("")}</div>${pagination("environment", "Environments")}</section>
    <section class="resource-section" data-resource-section="volume" aria-labelledby="resource-volumes-heading"><div class="surface-heading"><span><small>Data volumes</small><h3 id="resource-volumes-heading">Database and Storage data</h3></span><span class="state-chip">Individual deletion disabled</span></div><p class="surface-copy">Volumes hold persistent data. Attached includes mounts on stopped containers. Remove project data only through its owning environment’s reviewed discard.</p><div class="resource-list" data-resource-list="volume">${catalog.volumes.map((volume) => `<article class="resource-card" ${attributes("volume", volume.name, `${volume.state}${volume.protected ? " protected" : ""}`, volume.ownership === "project" ? "project" : "other", volume.bytes, volume.createdAt, volume.lastActivityAt, volume.ownership === "project" ? volume.target : null)}><div class="resource-card__heading"><strong><code>${html(volume.name)}</code></strong><span class="state-chip">${html(volume.state)}${volume.protected ? " · protected" : ""}</span></div><p>${html(volume.purpose === "unknown" ? "Purpose not proven" : volume.purpose)} · ${size(volume.bytes)} · ${volume.containerCount} container references</p><p>Owner: ${html(volume.target ?? "Other / unknown")} · Last observable use: ${html(time(volume.lastActivityAt))}</p><p class="resource-reason">${html(volume.reason)}</p>${volume.target && volume.ownership === "project" ? `<div class="action-group">${action(volume.target, "discardRuntime", "Review owning environment", volume.protected)}</div>` : ""}</article>`).join("")}</div>${pagination("volume", "Data volumes")}</section>
    <section class="resource-section" data-resource-section="image" aria-labelledby="resource-images-heading"><div class="surface-heading"><span><small>Images</small><h3 id="resource-images-heading">Reusable service software</h3></span><span class="state-chip">${catalog.images.length} images</span></div><p class="surface-copy">Images are templates, not mounted data. Running and stopped container references prevent cleanup. The newest cached service version is retained.</p><div class="resource-list" data-resource-list="image">${catalog.images.map((image) => `<article class="resource-card" ${attributes("image", `${image.service} ${image.id} ${image.tags.join(" ")}`, image.state, "shared", image.bytes, image.createdAt, null)}><div class="resource-card__heading"><label class="resource-image-label"><input type="checkbox" data-image-id="${html(image.id)}" data-image-bytes="${image.bytes}"${image.state !== "candidate" ? " disabled" : ""} aria-label="Select ${html(image.service)} ${html(image.tags[0] ?? image.id)} for image cleanup" /><strong>${html(image.service)}</strong></label><span class="state-chip">${html(image.state === "candidate" ? "Safe cleanup candidate" : image.state.replaceAll("-", " "))}</span></div><p>${size(image.bytes)} · Created ${html(image.createdAt)}</p><div class="resource-tags">${image.tags.map((tag) => `<code>${html(tag)}</code>`).join("") || "No tags"}</div><p class="resource-reason">${html(image.reason)}</p><details><summary>Exact identity and references</summary><code>${html(image.id)}</code>${image.digests.map((digest) => `<code>${html(digest)}</code>`).join("")}<ul>${image.references.map((ref) => `<li>${html(ref.name)} · ${ref.running ? "running" : "stopped"} · ${ref.ownership === "project" ? "this project" : "other project"}</li>`).join("") || "<li>No container references</li>"}</ul></details></article>`).join("")}</div>${pagination("image", "Images")}<div class="image-cleanup-review"><p id="image-selection-summary" role="status">Select eligible images to estimate cleanup.</p><p class="control-note">Estimated image size is an upper bound: shared layers may reduce recovered space. This action selects zero containers, data volumes, or baselines.</p><div class="action-group"><button id="select-eligible-images" type="button" class="button button--secondary">Select visible safe candidates</button><button id="clear-image-selection" type="button" class="button button--secondary">Clear selection</button><button id="review-image-cleanup" type="button" class="button button--danger" disabled>Review selected image cleanup</button></div></div></section>
    <section class="resource-section" data-resource-section="other" aria-labelledby="resource-others-heading"><div class="surface-heading"><span><small>Other local resources</small><h3 id="resource-others-heading">Other projects on this engine</h3></span><span class="state-chip">Read only</span></div><p class="surface-copy">These contribute to shared capacity. Rehearsal cannot modify them; manage them through their owning project.</p><div class="resource-list" data-resource-list="other">${catalog.otherContainers.map((container) => `<article class="resource-card" ${attributes("other", `${container.name} ${container.id}`, container.running ? "running" : "stopped", "other", null, null, null)}><div class="resource-card__heading"><strong>${html(container.name)}</strong><span class="state-chip">${container.running ? "running" : "stopped"}</span></div><p class="resource-reason">${html(container.reason)}</p><details><summary>Container ID</summary><code>${html(container.id)}</code></details></article>`).join("")}</div>${pagination("other", "Other containers")}</section>
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
const resourcePageSize = document.querySelector('#resource-page-size');
const resourceKinds = ['environment','volume','image','other'];
const resourceLabels = {environment:'environments',volume:'data volumes',image:'images',other:'other containers'};
const summaryKinds=['targets','resource-targets','baselines','baseline-evidence'];
const resourcePaging = {
  pageSize: [5,10,25].includes(savedUi.resourcePageSize) ? savedUi.resourcePageSize : 5,
  pages: Object.fromEntries(resourceKinds.map(kind=>[kind,Number.isSafeInteger(savedUi.resourcePages?.[kind]) && savedUi.resourcePages[kind]>=0 ? Math.min(1000000,savedUi.resourcePages[kind]) : 0])),
  summaryPages: Object.fromEntries(summaryKinds.map(kind=>[kind,Number.isSafeInteger(savedUi.resourceSummaryPages?.[kind]) && savedUi.resourceSummaryPages[kind]>=0 ? Math.min(1000000,savedUi.resourceSummaryPages[kind]) : 0]))
};
let updateSummaryResourceView=()=>{};
if(resourcePageSize) resourcePageSize.value=String(resourcePaging.pageSize);
const resourceCollections = resourceKinds.map(kind=>({
  kind,
  rows:resourceRows.filter(row=>row.dataset.kind===kind),
  list:document.querySelector('[data-resource-list="'+kind+'"]'),
  section:document.querySelector('[data-resource-section="'+kind+'"]'),
  pager:document.querySelector('#resource-'+kind+'-pagination'),
  range:document.querySelector('#resource-'+kind+'-range'),
  empty:document.querySelector('#resource-'+kind+'-empty'),
  previous:document.querySelector('#resource-'+kind+'-previous'),
  next:document.querySelector('#resource-'+kind+'-next')
}));
let resourceFilterIdentity=null;
const updateResourceView = () => {
  const query = resourceSearch?.value.trim().toLowerCase() ?? '';
  const kind = resourceKind?.value ?? 'all';
  const state = resourceState?.value ?? 'all';
  const ownership = resourceOwnership?.value ?? 'all';
  const sort = resourceSort?.value ?? 'name';
  document.querySelectorAll('[data-resource-kind]').forEach(control=>control.setAttribute('aria-pressed',String(control.dataset.resourceKind===kind)));
  const scope = currentViewScope();
  const identity=JSON.stringify([query,kind,state,ownership,sort,scope.targets,scope.onlyProjectOwned]);
  if(resourceFilterIdentity!==null && identity!==resourceFilterIdentity) resourceKinds.forEach(key=>resourcePaging.pages[key]=0);
  resourceFilterIdentity=identity;
  let matched=0;
  resourceCollections.forEach(collection => {
    const matches=collection.rows.filter(row=>{
      const scoped=row.dataset.viewTarget ? scope.targets.includes(row.dataset.viewTarget) : !scope.onlyProjectOwned;
      return scoped && row.dataset.name.includes(query) && (kind==='all'||row.dataset.kind===kind) && (state==='all'||row.dataset.state.split(' ').includes(state)) && (ownership==='all'||row.dataset.ownership===ownership);
    });
    matches.sort((a,b) => sort==='size' ? Number(b.dataset.size)-Number(a.dataset.size) : sort==='age' ? (Number(a.dataset.created)||Infinity)-(Number(b.dataset.created)||Infinity) : sort==='activity' ? Number(b.dataset.last)-Number(a.dataset.last) : a.dataset.name.localeCompare(b.dataset.name));
    matched+=matches.length;
    const pages=Math.max(1,Math.ceil(matches.length/resourcePaging.pageSize));
    const page=Math.min(resourcePaging.pages[collection.kind],pages-1);
    resourcePaging.pages[collection.kind]=page;
    const start=page*resourcePaging.pageSize;
    const visibleRows=matches.slice(start,start+resourcePaging.pageSize);
    const visibleSet=new Set(visibleRows);
    collection.rows.forEach(row=>row.hidden=!visibleSet.has(row));
    if(collection.list && (collection.list.children.length!==visibleRows.length || visibleRows.some((row,index)=>collection.list.children[index]!==row))) collection.list.replaceChildren(...visibleRows);
    if(collection.section) collection.section.hidden=(kind!=='all' && kind!==collection.kind) || (kind==='all' && resourceRows.length>0 && matches.length===0);
    if(collection.pager) collection.pager.hidden=matches.length===0;
    if(collection.range) collection.range.textContent=matches.length ? (start+1)+'–'+(start+visibleRows.length)+' of '+matches.length+' '+resourceLabels[collection.kind]+' · Page '+(page+1)+' of '+pages : '0 '+resourceLabels[collection.kind];
    if(collection.empty) {
      collection.empty.hidden=matches.length>0;
      collection.empty.textContent=collection.rows.length ? 'No '+resourceLabels[collection.kind]+' match these filters. Clear the search or change the selected view.' : 'No '+resourceLabels[collection.kind]+' were observed.';
    }
    if(collection.previous) { collection.previous.disabled=page===0; collection.previous.parentElement.hidden=pages<=1; }
    if(collection.next) collection.next.disabled=page>=pages-1;
  });
  const visible = resourceRows.filter(row=>!row.hidden).length;
  const count = document.querySelector('#resource-visible-count'); if(count)count.textContent = visible+' shown on current pages · '+matched+' of '+resourceRows.length+' resources match';
  const empty = document.querySelector('#resources-empty'); if(empty)empty.hidden = matched > 0;
  preferences.resourceQuery=query; preferences.resourceKind=kind; preferences.resourceState=state; preferences.resourceOwnership=ownership; preferences.resourceSort=sort; savePreferences();
  updateSummaryResourceView();
  updateImageSelection();
};
resourceSearch?.addEventListener('input',updateResourceView);
[resourceKind,resourceState,resourceOwnership,resourceSort].forEach(control=>control?.addEventListener('change',updateResourceView));
document.querySelectorAll('[data-resource-kind]').forEach(control=>control.addEventListener('click',()=>{if(resourceKind)resourceKind.value=control.dataset.resourceKind;updateResourceView();}));
document.querySelector('#resource-largest')?.addEventListener('click',()=>{if(resourceSort)resourceSort.value='size';updateResourceView();});
resourcePageSize?.addEventListener('change',()=>{
  const value=Number(resourcePageSize.value);
  resourcePaging.pageSize=[5,10,25].includes(value) ? value : 5;
  resourcePageSize.value=String(resourcePaging.pageSize);
  resourceKinds.forEach(kind=>resourcePaging.pages[kind]=0);
  updateResourceView();
});
document.querySelectorAll('[data-resource-page-action]').forEach(control=>control.addEventListener('click',()=>{
  const kind=control.dataset.resourcePageKind;
  if(control.disabled || !resourceKinds.includes(kind)) return;
  resourcePaging.pages[kind]=Math.max(0,resourcePaging.pages[kind]+(control.dataset.resourcePageAction==='next' ? 1 : -1));
  updateResourceView();
}));
const imageCheckboxes = [...document.querySelectorAll('[data-image-id]')];
const restoredImageIds = new Set(reconcileImageSelection(savedUi.images,imageCheckboxes.filter(input=>!input.disabled).map(input=>input.dataset.imageId)));
imageCheckboxes.forEach(input=>{input.checked=!input.disabled&&restoredImageIds.has(input.dataset.imageId);});
const updateImageSelection = () => { const selected=imageCheckboxes.filter(input=>input.checked&&!input.disabled); const bytes=selected.reduce((total,input)=>total+Number(input.dataset.imageBytes),0);const hidden=selected.filter(input=>input.closest('[data-resource-row]').hidden).length;const summary=document.querySelector('#image-selection-summary');if(summary)summary.textContent=selected.length+' images selected'+(hidden?' ('+hidden+' outside current page or filters)':'')+' · up to '+(bytes/1024**3).toFixed(2)+' GiB · zero data volumes'+(selected.length>100?' · Select at most 100 images per review':''); const review=document.querySelector('#review-image-cleanup');if(review)review.disabled=selected.length===0||selected.length>100; rememberUi(); };
imageCheckboxes.forEach(input=>input.addEventListener('change',updateImageSelection));
document.querySelector('#select-eligible-images')?.addEventListener('click',()=>{let remaining=100-imageCheckboxes.filter(input=>input.checked&&!input.disabled).length;imageCheckboxes.forEach(input=>{if(!input.disabled&&!input.checked&&!input.closest('[data-resource-row]').hidden&&remaining>0){input.checked=true;remaining--;}});updateImageSelection();});
document.querySelector('#clear-image-selection')?.addEventListener('click',()=>{imageCheckboxes.forEach(input=>input.checked=false);updateImageSelection();});
document.querySelector('#review-image-cleanup')?.addEventListener('click',()=>{postResourceMessage({type:'cleanupImages',ids:imageCheckboxes.filter(input=>input.checked&&!input.disabled).map(input=>input.dataset.imageId)});});
document.querySelectorAll('[data-resource-action]').forEach(control=>control.addEventListener('click',()=>{postResourceMessage({type:'resourceAction',target:control.dataset.resourceTarget,action:control.dataset.resourceAction});}));
document.querySelectorAll('.resource-environment-form').forEach(form=>form.addEventListener('submit',event=>{event.preventDefault();postResourceMessage({type:'reviewResourceConfiguration',target:form.dataset.resourceTarget,values:{environmentName:form.elements.environmentName.value,protectEnvironment:form.elements.protectEnvironment.checked}});}));
updateResourceView(); updateImageSelection();
`;

/** Supplemental Environments lists share row size, not resource filters or operation scope. */
export const SUMMARY_LIST_SCRIPT = `
const summaryRows=[...document.querySelectorAll('[data-summary-row]')];
const summaryLabels={targets:'database targets','resource-targets':'target resource summaries',baselines:'baseline versions','baseline-evidence':'baseline versions'};
const summaryLists=summaryKinds.map(kind=>({
  kind,
  rows:summaryRows.filter(row=>row.dataset.summaryRow===kind),
  list:document.querySelector('[data-summary-list="'+kind+'"]'),
  pager:document.querySelector('#summary-'+kind+'-pagination'),
  range:document.querySelector('#summary-'+kind+'-range'),
  empty:document.querySelector('#summary-'+kind+'-empty'),
  previous:document.querySelector('#summary-'+kind+'-previous'),
  next:document.querySelector('#summary-'+kind+'-next')
}));
let summaryScopeIdentity=null;
updateSummaryResourceView=()=>{
  const scope=currentViewScope();
  const identity=JSON.stringify([scope.targets,scope.onlyProjectOwned,resourcePaging.pageSize]);
  if(summaryScopeIdentity!==null && summaryScopeIdentity!==identity) summaryKinds.forEach(kind=>resourcePaging.summaryPages[kind]=0);
  summaryScopeIdentity=identity;
  summaryLists.forEach(collection=>{
    const matches=collection.rows.filter(row=>!row.dataset.summaryTarget || scope.targets.includes(row.dataset.summaryTarget));
    const pages=Math.max(1,Math.ceil(matches.length/resourcePaging.pageSize));
    const page=Math.min(resourcePaging.summaryPages[collection.kind],pages-1);
    resourcePaging.summaryPages[collection.kind]=page;
    const start=page*resourcePaging.pageSize;
    const visibleRows=matches.slice(start,start+resourcePaging.pageSize);
    const visible=new Set(visibleRows);
    collection.rows.forEach(row=>row.hidden=!visible.has(row));
    if(collection.list && (collection.list.children.length!==visibleRows.length || visibleRows.some((row,index)=>collection.list.children[index]!==row))) collection.list.replaceChildren(...visibleRows);
    if(collection.pager) collection.pager.hidden=matches.length===0;
    if(collection.range) collection.range.textContent=matches.length ? (start+1)+'–'+(start+visibleRows.length)+' of '+matches.length+' '+summaryLabels[collection.kind]+' · Page '+(page+1)+' of '+pages : '0 '+summaryLabels[collection.kind];
    if(collection.empty) collection.empty.hidden=matches.length>0;
    if(collection.previous) {collection.previous.disabled=page===0;collection.previous.parentElement.hidden=pages<=1;}
    if(collection.next) collection.next.disabled=page>=pages-1;
  });
};
document.querySelectorAll('[data-summary-page-action]').forEach(control=>control.addEventListener('click',()=>{
  const kind=control.dataset.summaryPageKind;
  if(control.disabled || !summaryKinds.includes(kind)) return;
  resourcePaging.summaryPages[kind]=Math.max(0,resourcePaging.summaryPages[kind]+(control.dataset.summaryPageAction==='next' ? 1 : -1));
  updateSummaryResourceView();rememberUi();
}));
updateSummaryResourceView();rememberUi();
`;
