/** Closed first-use consent choice for the owned synthetic UI run. Never enable checks. */
const question = "Allow optional Rehearsal update checks?";
const declineLabel = "Don't Ask Again";
exports.updateConsentQuestion = question;
exports.updateConsentDeclineLabel = declineLabel;
exports.declinedUpdateConsent = (questionMatches, labels) =>
  questionMatches === true &&
  Array.isArray(labels) &&
  labels.length > 0 &&
  labels.length <= 16 &&
  labels.filter((label) => label === declineLabel).length === 1 &&
  labels.every((label) => typeof label === "string" && label.length <= 160)
    ? declineLabel
    : undefined;

/** Occlusion is not data loss; require the actual unbound document, field and value. */
exports.unboundDraftPreserved = (flags) =>
  flags?.sameDocument === true &&
  flags?.sameField === true &&
  flags?.exactValue === true;

/** VS Code publishes panel columns asynchronously; accept only a settled exact pane. */
exports.dashboardPaneSettled = (state) =>
  Number.isSafeInteger(state?.originalColumn) &&
  state.originalColumn > 0 &&
  Number.isSafeInteger(state.actualColumn) &&
  state.actualColumn === state.originalColumn &&
  state.panelVisible === true &&
  state.samePanel === true;
