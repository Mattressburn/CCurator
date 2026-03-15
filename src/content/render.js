(function initCaseCleanerRender(global) {
  "use strict";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderCleanedTimeline(rows, containerEl) {
    if (!containerEl) {
      return;
    }

    containerEl.innerHTML = "";
    if (!rows || !rows.length) {
      var empty = global.document.createElement("div");
      empty.className = "cc-empty";
      empty.textContent = "No activity preview rows found in this page.";
      containerEl.appendChild(empty);
      return;
    }

    var fragment = global.document.createDocumentFragment();
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var item = global.document.createElement("article");
      item.className = "cc-row cc-kind-" + escapeHtml(row.kind || "unknown");

      var dupeBadge = row.dedupeCount > 1
        ? "<span class='cc-dupe-badge'>&times;" + row.dedupeCount + "</span>"
        : "";
      var nameHtml = row.name
        ? "<div class='cc-row-field'><span class='cc-label'>Name:</span> " + escapeHtml(row.name) + "</div>"
        : "";
      var taskHtml = row.task
        ? "<div class='cc-row-field'><span class='cc-label'>Task:</span> " + escapeHtml(row.task) + "</div>"
        : "";
      var dueHtml = row.dueDate
        ? "<div class='cc-row-field'><span class='cc-label'>Due:</span> " + escapeHtml(row.dueDate) + "</div>"
        : "";
      var preview = escapeHtml(String(row.fullText || "").slice(0, 380));

      item.innerHTML =
        "<div class='cc-row-head'>" +
          "<span class='cc-row-num'>" + (i + 1) + ".</span> " +
          "<span class='cc-row-kind'>" + escapeHtml(row.kind || "unknown") + "</span>" +
          dupeBadge +
        "</div>" +
        "<div class='cc-row-subject'>" + escapeHtml(row.subject || "(no subject)") + "</div>" +
        nameHtml + taskHtml + dueHtml +
        "<div class='cc-row-text'>" + preview + "</div>";

      fragment.appendChild(item);
    }

    containerEl.appendChild(fragment);
  }

  global.CaseCleanerRender = {
    escapeHtml: escapeHtml,
    renderCleanedTimeline: renderCleanedTimeline
  };
})(window);
