(function initCCurateController(global) {
  "use strict";

  function nowIso() {
    return new Date().toISOString();
  }

  function getDebugMode() {
    var qs = String((global.location && global.location.search) || "");
    return /[?&]ccuratedebug=1(?:&|$)/i.test(qs);
  }

  function ccLog(stage, details, force) {
    if (!force && !getDebugMode()) {
      return;
    }
    try {
      console.log("[CCurate][content][" + stage + "]", details || {});
    } catch (_err) { }
  }

  var bootContext = {
    href: String((global.location && global.location.href) || ""),
    title: String((global.document && global.document.title) || ""),
    readyState: String((global.document && global.document.readyState) || "unknown"),
    timestamp: nowIso()
  };

  var moduleFlags = {
    CCurateGpcrmExtract: !!global.CCurateGpcrmExtract,
    CCurateExports: !!global.CCurateExports
  };

  var missing = [];
  var required = [
    "CCurateGpcrmExtract",
    "CCurateExports"
  ];

  for (var r = 0; r < required.length; r += 1) {
    if (!global[required[r]]) {
      missing.push(required[r]);
    }
  }

  if (missing.length) {
    global.__cCurateBoot = {
      ok: false,
      missing: missing,
      href: bootContext.href,
      title: bootContext.title,
      timestamp: nowIso()
    };
    ccLog("deps-missing", { missing: missing.slice(), moduleFlags: moduleFlags }, true);
    return;
  }

  if (global.__cCurateInjected) {
    return;
  }

  global.__cCurateInjected = true;
  global.__cCurateBoot = {
    ok: true,
    href: bootContext.href,
    title: bootContext.title,
    timestamp: nowIso()
  };

  var gpcrmExtract = global.CCurateGpcrmExtract;
  var exportsApi = global.CCurateExports;

  var state = {
    payload: null,
    aiText: "",
    debug: null,
    extracting: false,
    observer: null,
    routeMatched: (gpcrmExtract && typeof gpcrmExtract.isCaseRoute === "function")
      ? gpcrmExtract.isCaseRoute(bootContext.href)
      : false,
    includeDebugCards: false
  };

  function ensureRoute() {
    var href = String((global.location && global.location.href) || "");
    if (!gpcrmExtract.isCaseRoute(href)) {
      return {
        ok: false,
        error: "This page is not a GPCRM Case view route (/lightning/r/Case/*/view)."
      };
    }
    return { ok: true };
  }

  function getStats() {
    return {
      emailsSummary: (state.payload && state.payload.emailsSummary && state.payload.emailsSummary.length) || 0,
      events: (state.payload && state.payload.events && state.payload.events.length) || 0,
      escalation: (state.payload && state.payload.escalation && state.payload.escalation.length) || 0,
      caseHistory: (state.payload && state.payload.caseHistory && state.payload.caseHistory.length) || 0
    };
  }

  function scheduleAutoRefresh() {
    if (state.observer || typeof global.MutationObserver === "undefined") {
      return;
    }

    var debounceTimer = null;
    state.observer = new MutationObserver(function () {
      if (!state.payload) {
        return;
      }
      if (debounceTimer) {
        global.clearTimeout(debounceTimer);
      }
      debounceTimer = global.setTimeout(function () {
        doExtract().catch(function () {
          return undefined;
        });
      }, 600);
    });

    if (global.document && global.document.documentElement) {
      state.observer.observe(global.document.documentElement, {
        childList: true,
        subtree: true,
        attributes: false
      });
    }
  }

  function doExtract() {
    if (state.extracting) {
      return Promise.resolve({ ok: false, error: "Extraction already in progress." });
    }

    var guard = ensureRoute();
    if (!guard.ok) {
      return Promise.resolve(guard);
    }

    state.extracting = true;
    var startedAt = Date.now();
    ccLog("extract-start", { href: global.location && global.location.href }, true);

    return gpcrmExtract.waitForStableDom({ timeoutMs: 13000, settleMs: 450, pollMs: 125 })
      .then(function () {
        var result = gpcrmExtract.buildPayload({ includeDebugCards: state.includeDebugCards || getDebugMode() });
        state.payload = result.payload;
        state.aiText = result.aiText;
        state.debug = result.debug;
        scheduleAutoRefresh();

        var stats = getStats();
        var extractionContext = state.payload && state.payload.extractionContext ? state.payload.extractionContext : {};

        ccLog("extract-ok", {
          ms: Date.now() - startedAt,
          stats: stats,
          caseNumber: state.payload && state.payload.caseNumber ? state.payload.caseNumber : "",
          visibleCaseNumberHint: extractionContext.visibleCaseNumberHint || "",
          pageUrl: extractionContext.pageUrl || state.payload.url || "",
          debug: getDebugMode() ? state.debug : undefined
        }, true);

        return {
          ok: true,
          caseNumber: state.payload.caseNumber,
          title: state.payload.title,
          stats: stats,
          extractionContext: extractionContext,
          debug: getDebugMode() ? state.debug : undefined
        };
      })
      .catch(function (err) {
        var errorText = (err && err.message) ? err.message : "Extraction failed.";
        ccLog("extract-fail", { error: errorText }, true);
        return { ok: false, error: errorText };
      })
      .finally(function () {
        state.extracting = false;
      });
  }

  function requirePayload() {
    if (!state.payload) {
      return { ok: false, error: "No extracted data. Run Scrape Current Case first." };
    }
    return { ok: true };
  }

  function doCopyJson() {
    var guard = requirePayload();
    if (!guard.ok) {
      return Promise.resolve(guard);
    }
    var text = exportsApi.toJson(state.payload);
    return exportsApi.copyToClipboard(text).then(function (ok) {
      return { ok: !!ok, error: ok ? "" : "Clipboard copy failed." };
    });
  }

  function doCopyAiText() {
    var guard = requirePayload();
    if (!guard.ok) {
      return Promise.resolve(guard);
    }
    var text = exportsApi.toAiText(state.payload, state.aiText);
    return exportsApi.copyToClipboard(text).then(function (ok) {
      return { ok: !!ok, error: ok ? "" : "Clipboard copy failed." };
    });
  }

  function getCompanionOptionsFromMessage(message) {
    var msg = message || {};
    return {
      endpoint: String((msg.companionOptions && msg.companionOptions.endpoint) || "http://127.0.0.1:38455/workflow/case"),
      timeoutMs: typeof (msg.companionOptions && msg.companionOptions.timeoutMs) === "number"
        ? msg.companionOptions.timeoutMs
        : 4000
    };
  }

  function doExportJson(message) {
    var msg = message || {};
    var handoffEnabled = msg.handoffEnabled !== false;
    var routeGuard = ensureRoute();

    if (!routeGuard.ok) {
      return Promise.resolve(routeGuard);
    }

    return doExtract().then(function (extractResult) {
      if (!extractResult || extractResult.ok === false) {
        return {
          ok: false,
          error: (extractResult && extractResult.error) ? extractResult.error : "Fresh scrape failed before export."
        };
      }

      if (!state.payload) {
        return {
          ok: false,
          error: "No extracted payload after fresh scrape."
        };
      }

      return exportsApi.exportCase(state.payload, {
        handoffEnabled: handoffEnabled,
        companionOptions: getCompanionOptionsFromMessage(msg),
        meta: {
          workflow: "case-post-acceptance",
          options: {
            createOneNote: true,
            createFolders: true,
            applySharing: false,
            dryRun: false
          }
        }
      }).then(function (result) {
        var handoffResponse = result && result.handoffResponse ? result.handoffResponse : null;

        var out = {
          ok: !!(result && result.ok),
          saved: !!(result && result.saved),
          savedFileName: result && result.savedFileName ? result.savedFileName : "",
          freshScrapeHappened: !!(result && result.freshScrapeHappened),
          extractedCaseNumber: result && result.extractedCaseNumber ? result.extractedCaseNumber : "",
          visibleCaseNumberHint: result && result.visibleCaseNumberHint ? result.visibleCaseNumberHint : "",
          pageUrl: result && result.pageUrl ? result.pageUrl : "",
          pageTitle: result && result.pageTitle ? result.pageTitle : "",
          mismatchDetected: !!(result && result.mismatchDetected),
          correlationId: result && result.correlationId ? result.correlationId : "",
          requestOrigin: result && result.requestOrigin ? result.requestOrigin : "",
          trigger: result && result.trigger ? result.trigger : "",
          handoffAttempted: !!(result && result.handoffAttempted),
          handoffSucceeded: !!(result && result.handoffSucceeded),
          handoffResponse: handoffResponse,
          handoffError: result && result.handoffError ? result.handoffError : null,
          handoffLogPath: result && result.handoffLogPath ? result.handoffLogPath : "",
          receivedCaseNumber: handoffResponse && handoffResponse.receivedCaseNumber ? handoffResponse.receivedCaseNumber : "",
          receivedFolderStem: handoffResponse && handoffResponse.receivedFolderStem ? handoffResponse.receivedFolderStem : "",
          receivedPageUrl: handoffResponse && handoffResponse.receivedPageUrl ? handoffResponse.receivedPageUrl : "",
          error: result && result.error ? result.error : ""
        };

        ccLog("export-result", out, true);
        return out;
      });
    }).catch(function (err) {
      return {
        ok: false,
        error: (err && err.message) ? err.message : "Export/handoff failed after refresh."
      };
    });
  }

  function handleAction(message) {
    if (!message || !message.type) {
      return Promise.resolve({ ok: false, error: "Missing message type." });
    }

    var type = message.type;

    if (type === "cCurate:ping") {
      return Promise.resolve({
        ok: true,
        ready: true,
        hasPayload: !!state.payload,
        routeMatched: gpcrmExtract.isCaseRoute(String((global.location && global.location.href) || "")),
        href: String((global.location && global.location.href) || ""),
        boot: global.__cCurateBoot
      });
    }

    if (type === "cCurate:extract") { return doExtract(); }
    if (type === "cCurate:copyJson") { return doCopyJson(); }
    if (type === "cCurate:copyAiText") { return doCopyAiText(); }
    if (type === "cCurate:exportJson") { return doExportJson(message); }

    if (type === "cCurate:getPayload") {
      var guard = requirePayload();
      if (!guard.ok) {
        return Promise.resolve(guard);
      }
      return Promise.resolve({
        ok: true,
        payload: exportsApi.buildPortablePayload(state.payload),
        aiText: exportsApi.toAiText(state.payload, state.aiText)
      });
    }

    return Promise.resolve({ ok: false, error: "Unknown action: " + type });
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    handleAction(message).then(function (result) {
      if (typeof sendResponse === "function") {
        sendResponse(result);
      }
    }).catch(function (err) {
      var errorText = (err && err.message) ? err.message : "Unexpected content error.";
      if (typeof sendResponse === "function") {
        sendResponse({ ok: false, error: errorText });
      }
    });
    return true;
  });

  global.cCurate = {
    scrapeCurrentCase: doExtract,
    copyJson: doCopyJson,
    copyAiText: doCopyAiText,
    getPayload: function () {
      return state.payload ? exportsApi.buildPortablePayload(state.payload) : null;
    },
    getAiText: function () {
      return state.payload ? exportsApi.toAiText(state.payload, state.aiText) : "";
    }
  };

  global.cCurateDebug = {
    boot: global.__cCurateBoot,
    modulePresence: moduleFlags,
    injected: !!global.__cCurateInjected,
    href: bootContext.href,
    title: bootContext.title,
    readyState: bootContext.readyState,
    getPayload: function () {
      return state.payload ? exportsApi.buildPortablePayload(state.payload) : null;
    },
    getAiText: function () {
      return state.payload ? exportsApi.toAiText(state.payload, state.aiText) : "";
    },
    setIncludeDebugCards: function (enabled) {
      state.includeDebugCards = !!enabled;
      return state.includeDebugCards;
    }
  };
})(window);