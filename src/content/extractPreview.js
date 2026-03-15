(function initCaseCleanerExtractPreview(global) {
  "use strict";

  var norm = global.CaseCleanerNormalize;
  var classify = global.CaseCleanerClassify;
  var parseLabels = global.CaseCleanerParseLabels;

  var SELECTORS = {
    previewRoot: "div.previewMode.SMALL.forceRelatedListPreview",
    rowItem: "article.listItemBody.withActions.slds-media",
    subjectContainer: "div.outputLookupContainer.forceOutputLookupWithPreview",
    subjectTitle: "h3.primaryField.slds-tile__title.slds-truncate",
    uiPanel: "[data-casecleaner-ui='1']",
    wrapperContainers: [
      ".oneWorkspaceTabWrapper",
      ".slds-brand-band",
      ".slds-template__container",
      "[class*='tabsetBody']",
      ".slds-brand-band-page-header"
    ]
  };

  function findPreviewRoot(doc) {
    var d = doc || global.document;
    if (!d || typeof d.querySelector !== "function") {
      return null;
    }
    return d.querySelector(SELECTORS.previewRoot);
  }

  function getNodePath(el) {
    if (!el || el.nodeType !== 1) {
      return "";
    }
    var parts = [];
    var current = el;
    for (var i = 0; i < 8 && current && current.nodeType === 1; i += 1) {
      var tag = String(current.tagName || "").toLowerCase();
      if (current.id) {
        parts.unshift(tag + "#" + current.id);
        break;
      }
      var cls = typeof current.className === "string"
        ? current.className.trim().split(/\s+/).slice(0, 2).join(".")
        : "";
      parts.unshift(cls ? (tag + "." + cls) : tag);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function extractRowSubject(article) {
    if (!article) {
      return { subject: "", subjectPath: "" };
    }

    var subjectHost = article.querySelector(SELECTORS.subjectContainer);
    var subjectNode = subjectHost
      ? subjectHost.querySelector(SELECTORS.subjectTitle)
      : article.querySelector(SELECTORS.subjectTitle);

    if (!subjectNode) {
      subjectNode = article.querySelector("h3");
    }

    return {
      subject: subjectNode ? norm.normalizeText(norm.textFromElement(subjectNode)) : "",
      subjectPath: subjectNode ? getNodePath(subjectNode) : ""
    };
  }

  function extractCasePreviewRows(root) {
    if (!root) {
      return [];
    }

    var rows = [];
    var articles = root.querySelectorAll(SELECTORS.rowItem);
    for (var i = 0; i < articles.length; i += 1) {
      var article = articles[i];
      if (article.closest && article.closest(SELECTORS.uiPanel)) {
        continue;
      }
      var subjectData = extractRowSubject(article);
      rows.push({
        _element: article,
        index: i,
        subject: subjectData.subject,
        fullText: norm.normalizeWhitespace(norm.textFromElement(article)),
        rowPath: getNodePath(article),
        subjectPath: subjectData.subjectPath
      });
    }
    return rows;
  }

  function normalizeCasePreviewRows(rawRows) {
    var out = [];
    var rows = rawRows || [];
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var kind = classify.classifyKind(row.subject);
      var canonical = norm.canonicalSubject(row.subject);
      var name = parseLabels.extractLabeledValue(row.fullText, "Name:", ["Task:", "Due Date:"]);
      var task = parseLabels.extractLabeledValue(row.fullText, "Task:", ["Name:", "Due Date:"]);
      var dueDate = parseLabels.extractLabeledValue(row.fullText, "Due Date:", ["Name:", "Task:"]);
      var fingerprint = norm.simpleHash(
        kind + "|" + canonical + "|" + norm.normalizeForKey(name) + "|" + norm.normalizeForKey(dueDate)
      );

      out.push({
        index: row.index,
        kind: kind,
        subject: row.subject,
        canonicalSubject: canonical,
        name: name,
        task: task,
        dueDate: dueDate,
        fullText: row.fullText,
        rowPath: row.rowPath,
        subjectPath: row.subjectPath,
        fingerprint: fingerprint,
        _element: row._element
      });
    }
    return out;
  }

  global.CaseCleanerExtractPreview = {
    SELECTORS: SELECTORS,
    findPreviewRoot: findPreviewRoot,
    extractCasePreviewRows: extractCasePreviewRows,
    normalizeCasePreviewRows: normalizeCasePreviewRows
  };
})(window);
