(function initCaseCleanerBackground(global) {
  "use strict";

  var ext = global.browser || global.chrome;
  var SALESFORCE_HOST_RE = /(^|\.)salesforce\.com$|(^|\.)lightning\.force\.com$|(^|\.)force\.com$/i;
  var CSS_ORDER = ["caseCleaner.css"];
  var JS_ORDER = [
    "normalize.js",
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
    } catch (_err) {}
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

  if (!ext || !ext.runtime || !ext.tabs || !ext.runtime.onMessage) {
    ccLog("boot", {
      ok: false,
      error: "Missing runtime/tabs APIs.",
      hasExt: !!ext,
      hasRuntime: !!(ext && ext.runtime),
      hasTabs: !!(ext && ext.tabs),
      hasOnMessage: !!(ext && ext.runtime && ext.runtime.onMessage)
    });
    return;
  }

  var hasScripting = !!(ext.scripting && ext.scripting.executeScript && ext.scripting.insertCSS);
  var inflightByTab = Object.create(null);

  ccLog("boot", {
    ok: true,
    hasScripting: hasScripting,
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

  function tabsGet(tabId) {
    try {
      var maybePromise = ext.tabs.get(tabId);
      if (maybePromise && typeof maybePromise.then === "function") {
        return maybePromise;
      }
    } catch (_err) {}

    return new Promise(function (resolve, reject) {
      try {
        ext.tabs.get(tabId, function (tab) {
          var lastErr = ext.runtime && ext.runtime.lastError;
          if (lastErr) {
            reject(new Error(lastErr.message || "tabs.get failed"));
            return;
          }
          resolve(tab);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function insertCss(tabId, file) {
    var details = { target: { tabId: tabId }, files: [file] };
    try {
      var maybePromise = ext.scripting.insertCSS(details);
      if (maybePromise && typeof maybePromise.then === "function") {
        return maybePromise;
      }
    } catch (_err) {}

    return new Promise(function (resolve, reject) {
      try {
        ext.scripting.insertCSS(details, function () {
          var lastErr = ext.runtime && ext.runtime.lastError;
          if (lastErr) {
            reject(new Error(lastErr.message || "insertCSS failed"));
            return;
          }
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function executeScript(tabId, file) {
    var details = { target: { tabId: tabId }, files: [file] };
    try {
      var maybePromise = ext.scripting.executeScript(details);
      if (maybePromise && typeof maybePromise.then === "function") {
        return maybePromise;
      }
    } catch (_err) {}

    return new Promise(function (resolve, reject) {
      try {
        ext.scripting.executeScript(details, function () {
          var lastErr = ext.runtime && ext.runtime.lastError;
          if (lastErr) {
            reject(new Error(lastErr.message || "executeScript failed"));
            return;
          }
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function runSequential(list, iterator) {
    var chain = Promise.resolve();
    for (var i = 0; i < list.length; i += 1) {
      (function (item) {
        chain = chain.then(function () {
          return iterator(item);
        });
      })(list[i]);
    }
    return chain;
  }

  function ensureInjected(tabId) {
    ccLog("ensureInjected-start", {
      tabId: tabId,
      hasScripting: hasScripting
    });

    if (!hasScripting) {
      return Promise.resolve(failResult(
        "Browser scripting APIs unavailable.",
        "",
        "precheck"
      ));
    }

    if (typeof tabId === "undefined" || tabId === null) {
      return Promise.resolve(failResult("Missing tabId.", "", "precheck"));
    }

    return tabsGet(tabId).then(function (tab) {
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

      var flow = runSequential(CSS_ORDER, function (file) {
        ccLog("inject-css-start", { tabId: tab.id, file: file });
        return insertCss(tab.id, file).then(function () {
          ccLog("inject-css-success", { tabId: tab.id, file: file });
        }).catch(function (err) {
          var errorText = toErrorText(err);
          ccLog("inject-css-fail", { tabId: tab.id, file: file, error: errorText });
          throw failResult(errorText, file, "inject-css");
        });
      }).then(function () {
        return runSequential(JS_ORDER, function (file) {
          ccLog("inject-js-start", { tabId: tab.id, file: file });
          return executeScript(tab.id, file).then(function () {
            ccLog("inject-js-success", { tabId: tab.id, file: file });
          }).catch(function (err) {
            var errorText = toErrorText(err);
            ccLog("inject-js-fail", { tabId: tab.id, file: file, error: errorText });
            throw failResult(errorText, file, "inject-js");
          });
        });
      }).then(function () {
        var ok = { ok: true, injected: true };
        ccLog("ensureInjected-done", {
          tabId: tab.id,
          url: tab.url,
          result: ok
        });
        return ok;
      }).catch(function (err) {
        var out = (err && err.ok === false)
          ? err
          : failResult(toErrorText(err), "", "ensureInjected");
        ccLog("ensureInjected-done", {
          tabId: tab.id,
          url: tab.url,
          result: out
        });
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

  ext.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    var type = message && message.type;
    ccLog("message", {
      type: type,
      tabId: message && message.tabId,
      senderTabId: sender && sender.tab && sender.tab.id
    });

    if (type === "caseCleaner:bgPing") {
      sendResponse({
        ok: true,
        ready: true,
        hasScripting: hasScripting
      });
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

  if (ext.tabs && ext.tabs.onRemoved) {
    ext.tabs.onRemoved.addListener(function (tabId) {
      delete inflightByTab[String(tabId)];
    });
  }
})(typeof self !== "undefined" ? self : this);