(function initCaseCleanerBackground(global) {
  "use strict";

  var SALESFORCE_HOST_RE = /(^|\.)salesforce\.com$|(^|\.)lightning\.force\.com$|(^|\.)force\.com$/i;
  var CSS_ORDER = ["caseCleaner.css"];
  var JS_ORDER = [
    "normalize.js",
    "caseCleanerUtils.js",
    "gpcrmCleanup.js",
    "gpcrmTranslate.js",
    "gpcrmParser.js",
    "gpcrmExtract.js",
    "exports.js",
    "content.js"
  ];

  function ccLog(stage, details) {
    try {
      console.log("[CaseCleaner][bg][" + stage + "]", details || {});
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

  var inflightByTab = Object.create(null);

  ccLog("boot", {
    ok: true,
    cssOrder: CSS_ORDER.slice(),
    jsOrder: JS_ORDER.slice()
  });

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

  // Removed: tabsGet, insertCss, runSequential legacy wrappers — MV3 scripting APIs return native Promises.

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

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    var type = message && message.type;
    ccLog("message", {
      type: type,
      tabId: message && message.tabId,
      senderTabId: sender && sender.tab && sender.tab.id
    });

    if (type === "caseCleaner:bgPing") {
      sendResponse({ ok: true, ready: true });
      return;
    }

    if (type === "caseCleaner:ensureInjected") {
      ensureInjected(message && message.tabId)
        .then(function (result) {
          sendResponse(result);
        })
        .catch(function (err) {
          sendResponse(failResult(toErrorText(err), "", "message-handler"));
        });
      return true;
    }

    return undefined;
  });

  chrome.tabs.onRemoved.addListener(function (tabId) {
    delete inflightByTab[String(tabId)];
  });

})(typeof self !== "undefined" ? self : this);