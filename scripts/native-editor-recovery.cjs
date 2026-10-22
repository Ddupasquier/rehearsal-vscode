/** A finalization record never grants cleanup authority over unknown editor work. */
const reasons = new Set([
  "clean",
  "scenario-recovery-required",
  "dirty-documents",
  "unverified-editor-state",
  "unverified-recovery-request",
]);

function nativeEditorRecoveryDecision(result, dirtyDocumentCount) {
  let reason = "clean";
  if (
    !result ||
    !["passed", "failed"].includes(result.status) ||
    !Number.isSafeInteger(dirtyDocumentCount) ||
    dirtyDocumentCount < 0
  )
    reason = "unverified-editor-state";
  else if (
    result.recoveryRequired !== undefined &&
    typeof result.recoveryRequired !== "boolean"
  )
    reason = "unverified-recovery-request";
  else if (result.recoveryRequired === true)
    reason = "scenario-recovery-required";
  else if (dirtyDocumentCount > 0) reason = "dirty-documents";
  const count =
    Number.isSafeInteger(dirtyDocumentCount) && dirtyDocumentCount >= 0
      ? Math.min(dirtyDocumentCount, 1000)
      : null;
  return Object.freeze({
    schemaVersion: 1,
    retainEditor: reason !== "clean",
    dirtyDocumentCount: count,
    dirtyDocumentCountTruncated: count !== null && dirtyDocumentCount > count,
    reason,
  });
}

/** Missing/malformed finalization stays unknown, never permission to kill a host. */
function shouldRetainNativeEditor(result) {
  const recovery = result?.editorRecovery;
  return !(
    result?.driverFinalized === true &&
    ["passed", "failed"].includes(result.status) &&
    result.recoveryRequired === false &&
    recovery?.schemaVersion === 1 &&
    recovery.retainEditor === false &&
    recovery.dirtyDocumentCount === 0 &&
    recovery.dirtyDocumentCountTruncated === false &&
    reasons.has(recovery.reason) &&
    recovery.reason === "clean"
  );
}

module.exports = { nativeEditorRecoveryDecision, shouldRetainNativeEditor };
