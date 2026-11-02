/** Browser interaction and safe serialization only; no native authority or state ownership. */
import type { NamedWorkspaceProfile } from "../../configuration/configuration_contract.js";
import type { WorkspacePreferences } from "../state/workspace_preferences.js";
import type { compareEnvironmentEvidence } from "../../runtime/reports/environment_comparison.js";
import {
  applyEngineShutdownUpdate,
  ENGINE_SHUTDOWN_UI_LABELS,
} from "../../runtime/engines/engine_lifecycle_view.js";
import { ENGINE_LIFECYCLE_REASON_LABELS } from "../../runtime/engines/engine_lifecycle_contract.js";
import { applyExtensionReleaseUpdate } from "../../updates/prompts/extension_release_view.js";
import {
  resolveWorkspaceViewScope,
  reconcileImageSelection,
  reconcileMigrationReview,
  MIGRATION_REVIEW_PERSISTENCE_LIMIT,
} from "../state/workspace_view_state.js";
import { CONFIGURATION_CONTROLS_SCRIPT } from "../../configuration/forms/configuration_view.js";
import { reconcileWorkspaceFormDrafts } from "../state/workspace_form_drafts.js";
import {
  RESOURCE_MANAGER_SCRIPT,
  SUMMARY_LIST_SCRIPT,
} from "../../runtime/resources/resource_manager_view.js";
import { applyOperationProgressUpdate } from "./workspace_live_update.js";
import { sandboxSessionPresentation } from "../state/workspace_guidance.js";
import { selectMigrationView } from "../../migrations/review/migration_filter.js";
import { changedConfigurationFormValues } from "../../configuration/forms/configuration_form.js";

export interface WorkspaceControllerContext {
  readonly pages: readonly string[];
  readonly activePage: string;
  readonly preferences: WorkspacePreferences;
  readonly namedProfiles: readonly NamedWorkspaceProfile[];
  readonly configuredTargets: readonly string[];
  readonly comparisonMatrix: readonly ReturnType<
    typeof compareEnvironmentEvidence
  >[];
  readonly comparisonNotice: string | null;
  readonly reviewIdentity: string;
  readonly formDraftIdentity: string | null;
  readonly structuredDraftNames: readonly string[];
  readonly draftResourceTargets: readonly string[];
}

export const renderWorkspaceController = (
  context: WorkspaceControllerContext,
): string => {
  const { pages: WORKSPACE_PAGES, activePage, comparisonNotice } = context;
  const scriptPreferences = JSON.stringify(context.preferences).replaceAll(
    "<",
    "\\u003c",
  );
  const scriptComparisons = JSON.stringify(context.comparisonMatrix).replaceAll(
    "<",
    "\\u003c",
  );
  const scriptNamedProfiles = JSON.stringify(context.namedProfiles).replaceAll(
    "<",
    "\\u003c",
  );
  const scriptTargets = JSON.stringify(context.configuredTargets).replaceAll(
    "<",
    "\\u003c",
  );
  const scriptReviewIdentity = JSON.stringify(
    context.reviewIdentity,
  ).replaceAll("<", "\\u003c");
  const scriptFormDraftIdentity = JSON.stringify(context.formDraftIdentity);
  const scriptStructuredDraftNames = JSON.stringify(
    context.structuredDraftNames,
  ).replaceAll("<", "\\u003c");
  const scriptDraftResourceTargets = JSON.stringify(
    context.draftResourceTargets,
  ).replaceAll("<", "\\u003c");
  return `
      (() => {
        // tsx may retain function names in serialized helpers; naming grants no capability.
        const __name = value => value;
        const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
        const savedUi = vscode?.getState()?.view ?? {};
        const allowedPages = new Set(${JSON.stringify(WORKSPACE_PAGES)});
        const preferences = ${scriptPreferences};
        const namedProfiles = ${scriptNamedProfiles};
        const configuredTargets = ${scriptTargets};
        const resolveViewScope = ${resolveWorkspaceViewScope.toString()};
        const currentViewScope = () => resolveViewScope(configuredTargets,namedProfiles,preferences);
        const reconcileImageSelection = ${reconcileImageSelection.toString()};
        const MIGRATION_REVIEW_PERSISTENCE_LIMIT = ${MIGRATION_REVIEW_PERSISTENCE_LIMIT};
        const reconcileMigrationReview = ${reconcileMigrationReview.toString()};
        const reviewIdentity = ${scriptReviewIdentity};
        ${CONFIGURATION_CONTROLS_SCRIPT}
        const comparisonMatrix = ${scriptComparisons};
        const comparisonNotice = ${JSON.stringify(comparisonNotice)};
        const compactNavigationQuery = window.matchMedia("(max-width: 1050px)");
        const compactNavigationTrigger = document.querySelector("#compact-navigation-trigger");
        const workspaceNavigation = document.querySelector("#workspace-navigation");
        const setCompactNavigation = (open) => {
          compactNavigationTrigger?.setAttribute("aria-expanded", String(open));
          workspaceNavigation?.classList.toggle("primary-nav--open", open);
        };
        const updateCompactNavigation = (page) => {
          const selected = workspaceNavigation?.querySelector('[data-rehearsal-page="' + page + '"]');
          const label = selected?.querySelector(".nav-item__label")?.textContent?.trim() ?? page;
          const glyph = selected?.querySelector(".nav-item__glyph")?.textContent?.trim() ?? "";
          const labelElement = compactNavigationTrigger?.querySelector(".compact-nav-trigger__label");
          const glyphElement = compactNavigationTrigger?.querySelector(".compact-nav-trigger__glyph");
          if (labelElement) labelElement.textContent = label;
          if (glyphElement) glyphElement.textContent = glyph;
          compactNavigationTrigger?.setAttribute("aria-label", "Choose Rehearsal page. Current page: " + label);
        };
        const savePreferences = () => vscode?.postMessage({ type: "preferences", preferences });
        const rememberUi = () => {
          const active = document.activeElement;
          const focus = active instanceof HTMLElement && /^[a-z0-9-]{1,100}$/i.test(active.id) ? active.id : null;
          const reviewed = [...document.querySelectorAll('[data-migration-review]:checked')].slice(0,MIGRATION_REVIEW_PERSISTENCE_LIMIT).map(control=>control.dataset.migrationReview);
          const eligibleImageInputs=imageCheckboxes.filter(control=>!control.disabled);
          const images=reconcileImageSelection(eligibleImageInputs.filter(control=>control.checked).map(control=>control.dataset.imageId),eligibleImageInputs.map(control=>control.dataset.imageId));
          const formFocus=configurationFocusFor(active)??(focus===null?reviewFormFocus:null);
          const formDrafts=reconcileWorkspaceFormDrafts({version:1,identity:formDraftIdentity,forms:configurationDraftForms.filter(entry=>dirtyForms.has(entry.form)).map(draftFormSnapshot),focus:formFocus},formDraftIdentity,configurationDraftForms.map(draftFormSnapshot),configurationDraftFocus);
          vscode?.setState({...vscode?.getState(),view:{focus,scroll:Math.max(0,Math.min(1000000,document.scrollingElement?.scrollTop??0)),reviewed,reviewIdentity,images,resourcePages:{...resourcePaging.pages},resourceSummaryPages:{...resourcePaging.summaryPages},resourcePageSize:resourcePaging.pageSize,formDrafts}});
        };
        document.addEventListener('focusin',rememberUi);
        document.addEventListener('change',rememberUi);
        document.addEventListener('scroll',rememberUi,{passive:true,capture:true});
        const configurationForms = [...document.querySelectorAll('#configuration-controls,#core-configuration-controls,#named-profile-controls,.resource-environment-form')];
        const initialFormValues = new Map(configurationForms.map(form=>[form,JSON.stringify([...new FormData(form).entries()])]));
        const dirtyForms = new Set();
        const formDraftIdentity = ${scriptFormDraftIdentity};
        const reconcileWorkspaceFormDrafts = ${reconcileWorkspaceFormDrafts.toString()};
        const approvedDraftNames = {
          'configuration-controls':['applicationUrl','retainBaselineGenerations','startCommand','proofCommand','runPersistence','openPersistence'],
          'core-configuration-controls':${scriptStructuredDraftNames},
          'named-profile-controls':['name','target','applicationUrl'],
          resource:['environmentName','protectEnvironment']
        };
        const draftResourceTargets=${scriptDraftResourceTargets};
        const configurationDraftForms = configurationForms.flatMap(form=>{
          const target=form.dataset?.resourceTarget;
          const key=Object.hasOwn(approvedDraftNames,form.id)?form.id:typeof target==='string'&&draftResourceTargets.includes(target)&&/^[a-z0-9][a-z0-9-]{0,62}$/.test(target)?'resource:'+target:null;
          if(!key)return[];
          const allowedNames=new Set(approvedDraftNames[key.startsWith('resource:')?'resource':key]);
          const fields=[];const focus=[];const occurrences=new Map();let buttons=0;
          [...(form.elements??[])].forEach(control=>{
            const tag=control.tagName?.toLowerCase();const type=String(control.type??'').toLowerCase();
            if(control.disabled)return;
            if(tag==='button' || (tag==='input'&&['submit','reset','button'].includes(type))) {
              focus.push({key:'button:'+type+':'+buttons++,node:control});return;
            }
            if(!['input','select','textarea'].includes(tag)||!allowedNames.has(control.name)||(tag==='input'&&!['text','url','number','checkbox','radio'].includes(type))||control.multiple)return;
            const kind=['checkbox','radio'].includes(type)?'checked':'value';
            const base=JSON.stringify([kind,control.name,kind==='checked'?String(control.value):'']);
            const occurrence=occurrences.get(base)??0;occurrences.set(base,occurrence+1);
            const key=base+':'+occurrence;
            fields.push({key,kind,node:control});focus.push({key,node:control});
          });
          return[{key,form,fields,focus}];
        });
        const draftFormSnapshot=entry=>({key:entry.key,fields:entry.fields.map(field=>({key:field.key,kind:field.kind,value:field.kind==='checked'?field.node.checked:field.node.value}))});
        const configurationDraftFocus=configurationDraftForms.flatMap(entry=>entry.focus.map(control=>({form:entry.key,control:control.key})));
        const configurationFocusFor=node=>{
          for(const entry of configurationDraftForms){const control=entry.focus.find(control=>control.node===node);if(control)return{form:entry.key,control:control.key};}
          return null;
        };
        const restoredFormDrafts=reconcileWorkspaceFormDrafts(savedUi.formDrafts,formDraftIdentity,configurationDraftForms.map(draftFormSnapshot),configurationDraftFocus);
        let reviewFormFocus=restoredFormDrafts?.focus??null;
        restoredFormDrafts?.forms.forEach(saved=>{
          const entry=configurationDraftForms.find(entry=>entry.key===saved.key);
          saved.fields.forEach(savedField=>{
            const field=entry?.fields.find(field=>field.key===savedField.key);
            if(!field)return;
            if(field.kind==='checked')field.node.checked=savedField.value;
            else if((field.node.maxLength??-1)<0||savedField.value.length<=field.node.maxLength) {
              if(field.node.tagName?.toLowerCase()!=='select'||[...(field.node.options??[])].some(option=>option.value===savedField.value))field.node.value=savedField.value;
            }
          });
        });
        configurationForms.forEach(form=>{if(JSON.stringify([...new FormData(form).entries()])!==initialFormValues.get(form))dirtyForms.add(form);});
        if(dirtyForms.size)vscode?.postMessage({type:'editing',editing:true});
        const updateFormDraft = form => {
          if(JSON.stringify([...new FormData(form).entries()])===initialFormValues.get(form)) dirtyForms.delete(form);
          else dirtyForms.add(form);
          vscode?.postMessage({type:'editing',editing:dirtyForms.size>0});
          rememberUi();
        };
        configurationForms.forEach(form=>{
          form.addEventListener('input',()=>updateFormDraft(form));
          form.addEventListener('change',()=>updateFormDraft(form));
          form.addEventListener('reset',()=>queueMicrotask(()=>updateFormDraft(form)));
          form.addEventListener('submit',event=>{
            const entry=configurationDraftForms.find(entry=>entry.form===form);
            const submit=entry?.focus.find(control=>String(control.node.type).toLowerCase()==='submit');
            reviewFormFocus=configurationFocusFor(event.submitter)??configurationFocusFor(document.activeElement)??(entry&&submit?{form:entry.key,control:submit.key}:null);
            rememberUi();
          },true);
        });
        document.querySelector('#review-stale-stop')?.addEventListener('click',()=>vscode?.postMessage({type:'reviewStaleStop'}));
        document.querySelectorAll('[data-engine-shutdown-control]').forEach(control=>control.addEventListener('click',()=>{if(!control.disabled)vscode?.postMessage({type:'reviewVmShutdown'});}));
        document.querySelector('#discard-form-drafts')?.addEventListener('click',()=>vscode?.postMessage({type:'editing',editing:false}));
        const applyOperationProgressUpdate = ${applyOperationProgressUpdate.toString()};
        const applyExtensionReleaseUpdate = ${applyExtensionReleaseUpdate.toString()};
        const applyEngineShutdownUpdate = ${applyEngineShutdownUpdate.toString()};
        const sandboxSessionPresentation = ${sandboxSessionPresentation.toString()};
        window.addEventListener('message',event=>{ if(event.data?.type==='engineShutdownUpdated'){applyEngineShutdownUpdate(document,event.data,${JSON.stringify({ outcomes: ENGINE_SHUTDOWN_UI_LABELS, reasons: ENGINE_LIFECYCLE_REASON_LABELS })});} else if(event.data?.type==='extensionReleaseUpdated') { applyExtensionReleaseUpdate(document,event.data); } else if(event.data?.type==='operationProgressUpdated') { applyOperationProgressUpdate(document,{type:event.data.type,html:event.data.html}); const session=sandboxSessionPresentation(event.data.sandboxSessionState); if(session) { document.querySelectorAll('[data-sandbox-session-label]').forEach(node=>{node.textContent=session.label;}); document.querySelectorAll('[data-sandbox-session-detail]').forEach(node=>{node.textContent=session.detail;}); document.querySelectorAll('[data-sandbox-session-guidance]').forEach(node=>{node.textContent=session.guidance;}); } } else if(event.data?.type==='inspectionUpdated') { const notice=document.querySelector('#inspection-draft-notice'); if(notice) notice.hidden=false; } });
        ${RESOURCE_MANAGER_SCRIPT}
        ${SUMMARY_LIST_SCRIPT}
        let displayedPage = ${JSON.stringify(activePage)};
        const activate = (page, sourceControl) => {
          if (!allowedPages.has(page)) return;
          const changedPage = page !== displayedPage;
          let selectedSection = null;
          document.querySelectorAll("[data-rehearsal-page]").forEach((control) => {
            const selected = control.dataset.rehearsalPage === page;
            if (control.classList.contains("nav-item")) {
              control.classList.toggle("nav-item--active", selected);
              if (selected) control.setAttribute("aria-current", "page");
              else control.removeAttribute("aria-current");
            }
          });
          document.querySelectorAll(".workspace-page").forEach((section) => {
            const selected = section.id === page;
            section.classList.toggle("workspace-page--active", selected);
            section.hidden = !selected;
            if (selected) selectedSection = section;
          });
          updateCompactNavigation(page);
          setCompactNavigation(false);
          if (sourceControl?.closest("#workspace-navigation") && compactNavigationQuery.matches) {
            compactNavigationTrigger?.focus({preventScroll:true});
          } else if (changedPage && sourceControl && !sourceControl.closest("#workspace-navigation")) {
            selectedSection?.querySelector("h1")?.focus({preventScroll:true});
          }
          if (changedPage) document.scrollingElement?.scrollTo({top:0,left:0,behavior:"instant"});
          displayedPage = page;
          vscode?.postMessage({ type: "navigate", page });
        };
        compactNavigationTrigger?.addEventListener("click", () => {
          setCompactNavigation(compactNavigationTrigger.getAttribute("aria-expanded") !== "true");
        });
        document.addEventListener("click", (event) => {
          if (!(event.target instanceof Element)) return;
          const reviewed = event.target.closest("[data-open-reviewed-migration]");
          if(reviewed){ vscode?.postMessage({type:"openReviewedMigration",sourceId:reviewed.dataset.openReviewedMigration}); return; }
          const insight = event.target.closest("[data-open-migration-insight]");
          if (insight) {
            vscode?.postMessage({type:"openMigrationInsight",findingId:insight.dataset.openMigrationInsight});
            return;
          }
          const failure = event.target.closest("[data-open-migration-failure]");
          if (failure) {
            vscode?.postMessage({type:"openMigrationFailure",operationId:failure.dataset.openMigrationFailure});
            return;
          }
          const control = event.target.closest("[data-rehearsal-page]");
          if (control) activate(control.dataset.rehearsalPage, control);
          else if (!event.target.closest(".sidebar")) setCompactNavigation(false);
        });
        document.addEventListener("keydown", (event) => {
          if (event.key !== "Escape" || compactNavigationTrigger?.getAttribute("aria-expanded") !== "true") return;
          setCompactNavigation(false);
          compactNavigationTrigger.focus();
        });
        compactNavigationQuery.addEventListener("change", () => setCompactNavigation(false));

        const migrationRows = [...document.querySelectorAll("[data-migration-row]")];
        const migrationSearch = document.querySelector("#migration-search");
        const migrationTarget = document.querySelector("#migration-target");
        const migrationStatus = document.querySelector("#migration-status");
        const migrationSort = document.querySelector("#migration-sort");
        const migrationFrom = document.querySelector("#migration-from");
        const migrationTo = document.querySelector("#migration-to");
        const migrationWarning = document.querySelector("#migration-warning");
        const selectMigrationView = ${selectMigrationView.toString()};
        const applyMigrationView = () => {
          const scope = currentViewScope();
          const status = migrationStatus?.value ?? "all";
          const sort = migrationSort?.value ?? "order";
          const selection=selectMigrationView(migrationRows.map(row=>({row,name:String(row.dataset.name),sortName:row.dataset.sortName,target:String(row.dataset.target),status:String(row.dataset.status),version:String(row.dataset.version),...(row.dataset.nativeWhen?{nativeIdentity:{when:Number(row.dataset.nativeWhen),idx:Number(row.dataset.nativeIdx),tag:String(row.dataset.nativeTag)}}:{}),order:Number(row.dataset.order),hasWarning:row.dataset.warning==='warnings'})),{query:migrationSearch?.value??'',targets:scope.targets,status,sort,from:migrationFrom?.value??'',to:migrationTo?.value??'',warning:migrationWarning?.value??'all'});
          const visibleRows=new Set(selection.visible.map(entry=>entry.row));
          const list = document.querySelector("#migration-list");
          selection.ordered.forEach(({row}) => {
            row.hidden = !visibleRows.has(row);
            list?.append(row);
          });
          const visible=selection.visible.length;
          const count = document.querySelector("#migration-visible-count");
          if (count) count.textContent = String(visible);
          const empty = document.querySelector('#migration-filter-empty');
          if(empty) empty.hidden = visible !== 0;
          preferences.migrationQuery = migrationSearch?.value ?? "";
          preferences.migrationSort = sort;
          preferences.migrationStatus = status;
          preferences.migrationFrom = migrationFrom?.value ?? '';
          preferences.migrationTo = migrationTo?.value ?? '';
          preferences.migrationWarning = migrationWarning?.value ?? 'all';
          savePreferences();
        };
        const updateReviewedCount = () => {
          const count=document.querySelector('#migration-reviewed-count');
          const reviewedCount=document.querySelectorAll('[data-migration-review]:checked').length;
          if(count)count.textContent=String(reviewedCount)+' reviewed'+(reviewedCount>MIGRATION_REVIEW_PERSISTENCE_LIMIT?' · Only the first '+MIGRATION_REVIEW_PERSISTENCE_LIMIT+' review checks are remembered after refresh.':'');
        };
        const updateDisplayScope = () => {
          const scope=currentViewScope();
          preferences.profile=scope.profile;preferences.selectedTarget=scope.selectedTarget;
          const targetControls=[migrationTarget,document.querySelector('#environment-target')];
          targetControls.forEach(control=>{if(control&&[...control.options].some(option=>option.value===scope.selectedTarget))control.value=scope.selectedTarget;});
          const profileControl=document.querySelector('#workspace-profile');if(profileControl)profileControl.value=scope.profile;
          document.querySelectorAll('[data-display-target]').forEach(row=>{row.hidden=!scope.targets.includes(row.dataset.displayTarget);});
          const summary=scope.warning??'Displaying '+scope.targets.length+' of '+configuredTargets.length+' targets'+(scope.onlyProjectOwned?' · project-owned resources only':' · shared images and engine totals remain global')+'. Display only; project operations retain the complete plan.';
          document.querySelectorAll('#workspace-scope-summary,[data-scope-summary]').forEach(control=>{control.textContent=summary;});
          applyMigrationView();updateResourceView();savePreferences();rememberUi();
        };
        migrationSearch?.addEventListener("input", applyMigrationView);
        migrationTarget?.addEventListener("change", () => {preferences.selectedTarget=migrationTarget.value;updateDisplayScope();});
        migrationStatus?.addEventListener("change", applyMigrationView);
        migrationSort?.addEventListener("change", applyMigrationView);
        document.querySelector('#clear-migration-filters')?.addEventListener('click',()=>{if(migrationSearch)migrationSearch.value='';preferences.selectedTarget='all';preferences.profile='full';if(migrationStatus)migrationStatus.value='all';if(migrationFrom)migrationFrom.value='';if(migrationTo)migrationTo.value='';if(migrationWarning)migrationWarning.value='all';updateDisplayScope();migrationSearch?.focus();});
        [migrationFrom,migrationTo,migrationWarning].forEach(control => control?.addEventListener('change',applyMigrationView));
        document.querySelectorAll('[data-migration-review]').forEach(control => control.addEventListener('change',updateReviewedCount));

        const environmentTarget = document.querySelector("#environment-target");
        environmentTarget?.addEventListener("change", () => {
          preferences.selectedTarget = environmentTarget.value;
          updateDisplayScope();
        });
        const workspaceProfile = document.querySelector("#workspace-profile");
        workspaceProfile?.addEventListener("change", () => {
          preferences.profile = workspaceProfile.value;
          if (workspaceProfile.value === "primary") preferences.selectedTarget = "primary";
          if (workspaceProfile.value === "full") preferences.selectedTarget = "all";
          const named = namedProfiles.find(profile => 'named:'+profile.name === workspaceProfile.value);
          if (named) { preferences.selectedTarget = named.targets.length === 1 ? named.targets[0] : 'all'; if(named.applicationUrl) { preferences.applicationUrl=named.applicationUrl; ['#application-url','#active-application-url'].forEach(selector=>{const address=document.querySelector(selector);if(address)address.value=named.applicationUrl;}); } }
          updateDisplayScope();
        });

        const applicationUrl = document.querySelector("#application-url");
        const activeApplicationUrl = document.querySelector("#active-application-url");
        const rememberApplicationUrl = (source) => {
          preferences.applicationUrl = source.value;
          [applicationUrl,activeApplicationUrl].forEach(control=>{if(control&&control!==source)control.value=source.value;});
          savePreferences();
        };
        [applicationUrl,activeApplicationUrl].forEach(control=>control?.addEventListener("change",()=>rememberApplicationUrl(control)));
        [["#open-custom-application",applicationUrl],["#open-active-application",activeApplicationUrl]].forEach(([selector,control])=>document.querySelector(selector)?.addEventListener("click",()=>{if(!control)return;rememberApplicationUrl(control);vscode?.postMessage({type:"openApplication",url:control.value});}));

        const simpleConfigurationForm = document.querySelector("#configuration-controls");
        const initialSimpleConfiguration = simpleConfigurationForm ? Object.fromEntries(JSON.parse(initialFormValues.get(simpleConfigurationForm)??'[]')) : {};
        const changedConfigurationFormValues = ${changedConfigurationFormValues.toString()};
        simpleConfigurationForm?.addEventListener("submit", (event) => {
          event.preventDefault();
          const values = changedConfigurationFormValues(initialSimpleConfiguration,Object.fromEntries(new FormData(event.currentTarget).entries()));
          vscode?.postMessage({ type: "reviewConfiguration", values });
        });
        document.querySelectorAll("[data-export-format]").forEach((control) => {
          control.addEventListener("click", () => vscode?.postMessage({ type: "exportReport", format: control.dataset.exportFormat, leftId: document.querySelector("#compare-left")?.value, rightId: document.querySelector("#compare-right")?.value }));
        });
        document.querySelector("#reset-local-state")?.addEventListener("click", () => {
          vscode?.postMessage({ type: "resetLocalState" });
        });

        const compare = () => {
          const leftId = document.querySelector("#compare-left")?.value;
          const rightId = document.querySelector("#compare-right")?.value;
          const result = document.querySelector("#comparison-result");
          if (!result) return;
          if (comparisonNotice) {
            result.textContent = comparisonNotice;
            return;
          }
          if (leftId === rightId) {
            result.textContent = "Choose two distinct environments or baselines. Comparing an entry with itself does not establish a change.";
            return;
          }
          const comparison = comparisonMatrix.find((item) => item.leftId === leftId && item.rightId === rightId);
          if (!comparison) {
            result.textContent = "This selected pair is outside the first 32 environments/versions available for live comparison. Choose entries within that limit or export a report for the larger history.";
            return;
          }
          result.replaceChildren();
          comparison.facts.forEach((fact) => { const row = document.createElement("p"); row.textContent = fact.label + ": " + fact.state + " — " + String(fact.left ?? "Unavailable") + " / " + String(fact.right ?? "Unavailable"); result.append(row); });
          const note = document.createElement("p"); note.textContent = comparison.limitations.join(" "); result.append(note);
        };
        document.querySelector("#compare-left")?.addEventListener("change", compare);
        document.querySelector("#compare-right")?.addEventListener("change", compare);
        compare();
        const migrationReviewControls=[...document.querySelectorAll('[data-migration-review]')];
        const restoredReviewIds=new Set(reconcileMigrationReview(savedUi.reviewed,savedUi.reviewIdentity,reviewIdentity,migrationReviewControls.map(control=>control.dataset.migrationReview),MIGRATION_REVIEW_PERSISTENCE_LIMIT));
        migrationReviewControls.forEach(control=>{control.checked=restoredReviewIds.has(control.dataset.migrationReview);});
        updateReviewedCount();updateDisplayScope();
        if(typeof savedUi.focus==='string' && /^[a-z0-9-]{1,100}$/i.test(savedUi.focus)) document.getElementById(savedUi.focus)?.focus({preventScroll:true});
        else if(restoredFormDrafts?.focus){
          const reference=restoredFormDrafts.focus;
          const node=configurationDraftForms.find(entry=>entry.key===reference.form)?.focus.find(control=>control.key===reference.control)?.node;
          if(node&&node.isConnected!==false&&!node.closest?.('[data-resource-row]')?.hidden){
            for(let ancestor=node.parentElement;ancestor;ancestor=ancestor.parentElement)if(ancestor.tagName?.toLowerCase()==='details')ancestor.open=true;
            node.focus({preventScroll:true});
          }
        }
        if(Number.isFinite(savedUi.scroll)) document.scrollingElement?.scrollTo({top:Math.max(0,Math.min(1000000,savedUi.scroll))});
      })();
    `;
};
