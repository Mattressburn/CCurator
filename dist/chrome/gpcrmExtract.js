(function initCCurateGpcrmExtract(global) {
  "use strict";

  var parser = global.CCurateGpcrmParser;
  var ROUTE_RE = /\/lightning\/r\/Case\/[^/]+\/view(?:\?|#|$)/i;

  function getActiveContainer(doc) {
    return doc.querySelector(".oneWorkspaceTabWrapper.active") ||
      doc.querySelector(".active.oneConsoleTab") ||
      doc.body;
  }

  function buildPayload() {
    var container = getActiveContainer(global.document);
    var metadata = parser.extractRecordMetadata(container);
    var events = parser.parseEventsFromText(container);
    var split = parser.splitByType(events);

    var payload = {
      caseNumber: metadata['casenumber'] || "",
      accountName: metadata['accountname'] || "",
      contactName: metadata['contactname'] || "",
      title: global.document.title,
      extractedAt: new Date().toISOString(),
      metadata: metadata,
      events: split.events
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