(function initCCurateBackground(global) {
  "use strict";

  var SALESFORCE_HOST_RE = /(^|\.)salesforce\.com$|(^|\.)lightning\.force\.com$|(^|\.)force\.com$/i;
  var CSS_ORDER = ["caseCleaner.css"];
  var JS_ORDER = [
    "normalize.js",
    "caseCleanerUtils.js",
    "gpcrmCleanup.js",
    "gpcrmParser.js",
    "gpcrmExtract.js",
    "companionTransport.js",
    "exports.js",
    "content.js"
  ];

  function ccLog(stage, details) {
    try {
      console.log("[CCurate][bg][" + stage + "]", details || {});
    } catch (_err) { }
  }

  function toErrorText(err) {
    if (!err) { return "Unknown error."; }
    if (typeof err === "string") { return err; }
    if (err.message) { return String(err.message); }
    try {
      return JSON.stringify(err);
    } catch (_jsonErr) {
      return String(err);
    }
  }

  function failResult(message, file, phase) {
    return {
      ok: false,
      error: String(message || "Unknown error."),
      file: file || "",
      phase: phase || ""
    };
  }

  function parseUrl(url) {
    try {
      return new URL(String(url || ""));
    } catch (_err) {
      return null;
    }
  }

  function isSupportedUrl(url) {
    var parsed = parseUrl(url);
    if (!parsed) { return false; }
    if (!/^https?:$/i.test(parsed.protocol || "")) { return false; }
    return SALESFORCE_HOST_RE.test(parsed.hostname || "");
  }

  var inflightByTab = Object.create(null);

  ccLog("boot", {
    ok: true,
    cssOrder: CSS_ORDER.slice(),
    jsOrder: JS_ORDER.slice()
  });

  function ensureInjected(tabId) {
    ccLog("ensureInjected-start", { tabId: tabId });

    if (typeof tabId === "undefined" || tabId === null) {
      return Promise.resolve(failResult("Missing tabId.", "", "precheck"));
    }

    return chrome.tabs.get(tabId).then(function (tab) {
      ccLog("ensureInjected-tab", {
        requestedTabId: tabId,
        resolvedTabId: tab && tab.id,
        status: tab && tab.status,
        url: tab && tab.url
      });

      if (!tab || typeof tab.id === "undefined") {
        return failResult("Tab not found.", "", "tab-check");
      }
      if (!tab.url) {
        return failResult("Tab URL missing.", "", "tab-check");
      }
      if (tab.status === "loading") {
        return failResult("Tab is loading. Wait and retry.", "", "tab-check");
      }
      if (!isSupportedUrl(tab.url)) {
        return failResult("Unsupported URL for injection.", "", "url-check");
      }

      var key = String(tab.id);
      if (inflightByTab[key]) {
        return inflightByTab[key];
      }

      var flow = chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: CSS_ORDER
      }).catch(function () { }).then(function () {
        ccLog("inject-js-start", { tabId: tab.id, files: JS_ORDER });
        return chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: JS_ORDER
        });
      }).then(function () {
        var ok = { ok: true, injected: true };
        ccLog("ensureInjected-done", { tabId: tab.id, url: tab.url, result: ok });
        return ok;
      }).catch(function (err) {
        var out = failResult(toErrorText(err), "multiple-js-files", "ensureInjected");
        ccLog("ensureInjected-done", { tabId: tab.id, url: tab.url, result: out });
        return out;
      }).then(function (result) {
        delete inflightByTab[key];
        return result;
      });

      inflightByTab[key] = flow;
      return flow;
    }).catch(function (err) {
      var out = failResult(toErrorText(err), "", "tabs.get");
      ccLog("ensureInjected-done", { tabId: tabId, result: out });
      return out;
    });
  }

  function handoffToCompanion(message) {
    var endpoint = String((message && message.endpoint) || "http://127.0.0.1:38455/workflow/case");
    var timeoutMs = typeof (message && message.timeoutMs) === "number" ? message.timeoutMs : 4000;
    var envelope = message && message.envelope ? message.envelope : null;

    if (!envelope || typeof envelope !== "object") {
      return Promise.resolve({
        attempted: false,
        success: false,
        response: null,
        error: "Missing envelope."
      });
    }

    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null;

    if (controller) {
      timer = global.setTimeout(function () {
        try { controller.abort(); } catch (_e) { }
      }, timeoutMs);
    }

    ccLog("handoff-start", {
      endpoint: endpoint,
      timeoutMs: timeoutMs,
      correlationId: envelope.correlationId || "",
      origin: envelope.origin || "",
      trigger: envelope.trigger || "",
      caseNumber: envelope.case && envelope.case.caseNumber ? envelope.case.caseNumber : ""
    });

    return fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var parsed = null;
        try { parsed = JSON.parse(text); } catch (_e) { }

        var result = {
          attempted: true,
          success: !!res.ok,
          status: res.status,
          response: parsed,
          rawText: text,
          error: res.ok ? null : ("HTTP " + res.status)
        };

        ccLog("handoff-done", {
          endpoint: endpoint,
          success: result.success,
          status: result.status,
          correlationId: parsed && parsed.correlationId ? parsed.correlationId : envelope.correlationId || "",
          requestOrigin: parsed && parsed.requestOrigin ? parsed.requestOrigin : envelope.origin || "",
          receivedCaseNumber: parsed && parsed.receivedCaseNumber ? parsed.receivedCaseNumber : "",
          logPath: parsed && parsed.logPath ? parsed.logPath : ""
        });

        return result;
      });
    }).catch(function (err) {
      var out = {
        attempted: true,
        success: false,
        response: null,
        error: String(err || "fetch failed")
      };
      ccLog("handoff-error", {
        endpoint: endpoint,
        correlationId: envelope.correlationId || "",
        error: out.error
      });
      return out;
    }).then(function (result) {
      if (timer) {
        global.clearTimeout(timer);
      }
      return result;
    });
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    var type = message && message.type;
    ccLog("message", {
      type: type,
      tabId: message && message.tabId,
      senderTabId: sender && sender.tab && sender.tab.id
    });

    if (type === "cCurate:bgPing") {
      sendResponse({ ok: true, ready: true });
      return;
    }

    if (type === "cCurate:ensureInjected") {
      ensureInjected(message && message.tabId)
        .then(function (result) {
          sendResponse(result);
        })
        .catch(function (err) {
          sendResponse(failResult(toErrorText(err), "", "message-handler"));
        });
      return true;
    }

    if (type === "cCurate:handoffToCompanion") {
      handoffToCompanion(message)
        .then(function (result) {
          sendResponse(result);
        })
        .catch(function (err) {
          sendResponse({
            attempted: true,
            success: false,
            response: null,
            error: toErrorText(err)
          });
        });
      return true;
    }

    return undefined;
  });

  chrome.tabs.onRemoved.addListener(function (tabId) {
    delete inflightByTab[String(tabId)];
  });
})(typeof self !== "undefined" ? self : this);