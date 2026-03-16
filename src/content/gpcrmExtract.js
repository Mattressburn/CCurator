(function initCCurateGpcrmExtract(global) {
  "use strict";

  var parser = global.CCurateGpcrmParser;
  var ROUTE_RE = /\/lightning\/r\/Case\/[^/]+\/view(?:\?|#|$)/i;

  function getActiveContainer(doc) {
    return doc.querySelector(".oneWorkspaceTabWrapper.active") ||
      doc.querySelector(".active.oneConsoleTab") ||
      doc.body;
  }

  function normalizeSpace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function titleCaseNumber(doc) {
    var title = normalizeSpace(doc && doc.title);
    var match = title.match(/\b(\d{5,10})\b/);
    return match ? match[1] : "";
  }

  function firstEmailFromText(text) {
    var match = String(text || "").match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    return match ? match[0] : "";
  }

  function buildPayload() {
    var container = getActiveContainer(global.document);
    var metadata = parser.extractRecordMetadata(container);
    var events = parser.parseEventsFromText(container);
    var split = parser.splitByType(events);
    var caseNumber = parser.extractFromMetadata(metadata, ["case number", "case"]) ||
      (typeof parser.extractCaseNumber === "function" ? parser.extractCaseNumber(container) : "") ||
      titleCaseNumber(global.document) ||
      "";
    var accountName = parser.extractFromMetadata(metadata, ["account name", "account"]);
    var contactName = parser.extractFromMetadata(metadata, ["contact name", "contact"]);
    var contactEmail = parser.extractFromMetadata(metadata, ["contact email", "email"]) ||
      firstEmailFromText((container && container.innerText) || "");
    var rawVisibleText = String(
      (global.document && global.document.body && (global.document.body.innerText || global.document.body.textContent)) || ""
    );

    var payload = {
      url: String((global.location && global.location.href) || ""),
      caseNumber: caseNumber,
      accountName: accountName,
      contactName: contactName,
      contactEmail: contactEmail,
      customerName: accountName || "",
      title: String((global.document && global.document.title) || ""),
      extractedAt: new Date().toISOString(),
      metadata: metadata,
      emailsSummary: split.emailsSummary || [],
      events: split.events || [],
      escalation: split.escalation || [],
      caseHistory: split.caseHistory || [],
      rawVisibleText: rawVisibleText
    };

    return {
      payload: payload,
      aiText: parser.buildAiText(payload)
    };
  }

  global.CCurateGpcrmExtract = {
    isCaseRoute: function (url) { return ROUTE_RE.test(url); },
    waitForStableDom: function () { return Promise.resolve({ ok: true }); },
    buildPayload: buildPayload
  };
})(window);