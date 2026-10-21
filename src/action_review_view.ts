const MAXIMUM_DETAIL_BYTES = 2 * 1024 * 1024;
const FAILURE =
  "The action could not be confirmed. Review the current project state and start a fresh review before trying again. No automatic retry was started.";

export interface ReviewContent {
  readonly title: string;
  readonly description: string;
  readonly workspaceName: string;
  readonly path?: string;
  readonly detail: string;
  readonly format: "diff" | "text";
  readonly changedFields?: readonly string[];
  readonly applyLabel?: string;
  readonly successMessage?: string;
}

export interface ReviewAssets {
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

export const validateReviewContent = (content: ReviewContent): number => {
  const text = (value: unknown, maximum: number): value is string =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\x00-\x1f\x7f]/u.test(value);
  if (
    !text(content.title, 200) ||
    !text(content.description, 2000) ||
    !text(content.workspaceName, 300) ||
    (content.path !== undefined &&
      (!text(content.path, 1000) ||
        /^[\/\\]|^[a-z][a-z0-9+.-]*:/iu.test(content.path) ||
        content.path.split(/[\/\\]/u).includes(".."))) ||
    typeof content.detail !== "string" ||
    !content.detail.length ||
    content.detail.length > MAXIMUM_DETAIL_BYTES ||
    content.detail.includes("\0") ||
    content.detail.split("\n").length > 40_000 ||
    !["diff", "text"].includes(content.format) ||
    (content.changedFields !== undefined &&
      (!Array.isArray(content.changedFields) ||
        content.changedFields.length > 1000 ||
        content.changedFields.some((field) => !text(field, 300)))) ||
    (content.applyLabel !== undefined && !text(content.applyLabel, 200)) ||
    (content.successMessage !== undefined &&
      !text(content.successMessage, 2000))
  )
    throw new Error("The review is invalid or too large.");
  const bytes = new TextEncoder().encode(content.detail).byteLength;
  if (bytes > MAXIMUM_DETAIL_BYTES)
    throw new Error(
      "This review is too large for the editor. Review the project through its maintained CLI instead.",
    );
  return bytes;
};

/** Pure, escaped presentation. No source files, resources or proposals are executed. */
export const renderReviewDocument = (
  content: ReviewContent,
  assets: ReviewAssets,
): string => {
  validateReviewContent(content);
  if (!/^[a-zA-Z0-9_-]{16,100}$/u.test(assets.scriptNonce))
    throw new Error("The review nonce is invalid.");
  let added = 0;
  let removed = 0;
  const detail = content.detail
    .split("\n")
    .map((line) => {
      const kind =
        content.format !== "diff"
          ? "context"
          : /^(?:---|\+\+\+|@@)/u.test(line)
            ? "header"
            : line.startsWith("+")
              ? "added"
              : line.startsWith("-")
                ? "removed"
                : "context";
      if (kind === "added") added++;
      if (kind === "removed") removed++;
      return `<span class="review-panel__line review-panel__line--${kind}">${escapeHtml(line)}</span>`;
    })
    .join("\n");
  const changes = content.changedFields?.length ?? 0;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escapeHtml(assets.resourceSource)}; script-src 'nonce-${assets.scriptNonce}'; connect-src 'none'; form-action 'none'; base-uri 'none';" />
  <link rel="stylesheet" href="${escapeHtml(assets.stylesheetUri)}" />
  <title>${escapeHtml(content.title)} · Rehearsal</title>
</head>
<body class="review-panel">
  <main class="review-panel__main">
    <header class="review-panel__header">
      <p class="eyebrow">Rehearsal · ${escapeHtml(content.workspaceName)}</p>
      <h1 id="review-heading" tabindex="-1">${escapeHtml(content.title)}</h1>
      <p id="review-description">${escapeHtml(content.description)}</p>
      ${content.path === undefined ? "" : `<p class="review-panel__path">Configuration file: <code>${escapeHtml(content.path)}</code></p>`}
    </header>
    ${changes ? `<section aria-label="Changed settings"><h2>${changes} ${changes === 1 ? "setting" : "settings"} changed</h2><ul class="review-panel__fields">${content.changedFields!.map((field) => `<li><code>${escapeHtml(field)}</code></li>`).join("")}</ul></section>` : ""}
    ${content.format === "diff" ? `<p class="review-panel__diff-statistics">${added} added ${added === 1 ? "line" : "lines"} · ${removed} removed ${removed === 1 ? "line" : "lines"}. Application commands are stored, not executed by this edit.</p>` : ""}
    <section class="review-panel__detail-region" aria-label="Complete review details">
      <pre class="review-panel__detail" tabindex="0" aria-label="${content.format === "diff" ? "Read-only configuration diff" : "Read-only operation review"}"><code>${detail}</code></pre>
    </section>
    <footer class="review-panel__actions">
      <p id="review-status" role="status" aria-live="polite" aria-atomic="true">Ready for your review. Cancel makes no changes.</p>
      <div class="action-group">
        <button id="review-cancel" type="button" class="button button--secondary">Cancel</button>
        <button id="review-apply" type="button" class="button button--primary" aria-describedby="review-description">${escapeHtml(content.applyLabel ?? "Apply changes")}</button>
        <button id="review-return" type="button" class="button button--primary" hidden>Return to project</button>
      </div>
    </footer>
  </main>
  <script nonce="${assets.scriptNonce}">
  (() => {
    const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
    const token = ${JSON.stringify(assets.scriptNonce)};
    const apply = document.querySelector('#review-apply');
    const cancel = document.querySelector('#review-cancel');
    const returnButton = document.querySelector('#review-return');
    const status = document.querySelector('#review-status');
    const applyLabel = apply.textContent;
    const previewOnly = () => {
      status.setAttribute("role","status");
      status.textContent = "Preview only. No configuration, resources or files were changed. Use Rehearsal in VS Code to apply this review.";
    };
    let pending = false;
    let failed = false;
    let succeeded = false;
    const setPending = () => {
      pending = true;
      apply.disabled = true;
      cancel.disabled = true;
      status.setAttribute('role','status');
      status.textContent = 'Processing your reviewed action. Please wait for the result.';
      apply.textContent = 'Please wait…';
    };
    const close = () => {
      if (!vscode) { previewOnly(); return; }
      if (pending || succeeded) return;
      pending = true;
      vscode.postMessage({type:'cancelReview',token});
    };
    apply.addEventListener('click', () => {
      if (!vscode) { previewOnly(); return; }
      if (pending || failed || succeeded) return;
      setPending();
      vscode.postMessage({type:'applyReview',token});
    });
    cancel.addEventListener('click', close);
    returnButton.addEventListener('click', () => {
      if (!succeeded) return;
      vscode.postMessage({type:'returnFromReview',token});
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || pending) return;
      event.preventDefault();
      if (succeeded) vscode.postMessage({type:'returnFromReview',token});
      else close();
    });
    window.addEventListener('message', event => {
      if (!vscode) return;
      const message = event.data;
      if (!message || message.type !== 'reviewState' || message.token !== token) return;
      if (message.state === 'applying') setPending();
      if (message.state === 'cancelled') {
        pending = false;
        apply.disabled = false;
        apply.textContent = applyLabel;
        cancel.disabled = false;
        status.textContent = 'Confirmation cancelled. No operation was started. You can review the details or close this review.';
        cancel.focus();
      }
      if (message.state === 'succeeded') {
        pending = false;
        succeeded = true;
        apply.hidden = true;
        cancel.hidden = true;
        returnButton.hidden = false;
        status.setAttribute('role','status');
        status.textContent = typeof message.message === 'string' && message.message.length <= 2000 ? message.message : 'Review completed.';
        returnButton.focus();
      }
      if (message.state === 'failed') {
        pending = false;
        failed = true;
        apply.disabled = true;
        apply.textContent = 'Action not confirmed';
        cancel.disabled = false;
        cancel.textContent = 'Close review';
        status.setAttribute('role','alert');
        status.textContent = typeof message.message === 'string' && message.message.length > 0 && message.message.length <= 500 && !/[\\x00-\\x1f\\x7f]/u.test(message.message) ? message.message : ${JSON.stringify(FAILURE)};
        cancel.focus();
      }
    });
    document.querySelector('#review-heading').focus();
  })();
  </script>
</body>
</html>`;
};
