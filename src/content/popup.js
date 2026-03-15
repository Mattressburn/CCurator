(function initPopup() {
  "use strict";

  var ext = window.browser || window.chrome;
  var statusEl = document.getElementById("status");
  var SALESFORCE_HOST_RE = /(^|\.)salesforce\.com$|(^|\.)lightning\.force\.com$|(^|\.)force\.com$/i;
  var GPCRM_CASE_ROUTE_RE = /\/lightning\/r\/Case\/[^/]+\/view(?:\?|#|$)/i;

  function ccLog(stage, details) {
    try {
      console.log("[CaseCleaner][popup][" + stage + "]", details || {});
    } catch (_err) {}
  }

  function setStatus(text) {
    statusEl.textContent = String(text || "");
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

  function delay(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function parseUrl(url) {
    try {
      return new URL(String(url || ""));
    } catch (_err) {
      return null;
    }
  }

  function isSupportedSalesforceTab(tab) {
    var parsed = parseUrl(tab && tab.url);
    if (!parsed) { return false; }
    if (!/^https?:$/i.test(parsed.protocol || "")) { return false; }
    return SALESFORCE_HOST_RE.test(parsed.hostname || "");
  }

  function isSupportedCaseRoute(tab) {
    var parsed = parseUrl(tab && tab.url);
    if (!parsed) {
      return false;
    }
    return GPCRM_CASE_ROUTE_RE.test(parsed.pathname + (parsed.search || "") + (parsed.hash || ""));
  }

  function isMissingReceiverError(errorText) {
    var text = String(errorText || "").toLowerCase();
    return text.indexOf("receiving end does not exist") >= 0 ||
      text.indexOf("could not establish connection") >= 0 ||
      text.indexOf("no response from content script") >= 0;
  }

  function tabsQuery(queryInfo) {
    try {
      var maybePromise = ext.tabs.query(queryInfo);
      if (maybePromise && typeof maybePromise.then === "function") {
        return maybePromise;
      }
    } catch (_err) {}

    return new Promise(function (resolve, reject) {
      try {
        ext.tabs.query(queryInfo, function (tabs) {
          var lastErr = ext.runtime && ext.runtime.lastError;
          if (lastErr) {
            reject(new Error(lastErr.message || "tabs.query failed"));
            return;
          }
          resolve(tabs || []);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function runtimeSendMessage(message) {
    try {
      var maybePromise = ext.runtime.sendMessage(message);
      if (maybePromise && typeof maybePromise.then === "function") {
        return maybePromise;
      }
    } catch (_err) {}

    return new Promise(function (resolve, reject) {
      try {
        ext.runtime.sendMessage(message, function (response) {
          var lastErr = ext.runtime && ext.runtime.lastError;
          if (lastErr) {
            reject(new Error(lastErr.message || "runtime.sendMessage failed"));
            return;
          }
          resolve(response);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function tabsSendMessage(tabId, message) {
    try {
      var maybePromise = ext.tabs.sendMessage(tabId, message);
      if (maybePromise && typeof maybePromise.then === "function") {
        return maybePromise.then(function (response) {
          if (typeof response === "undefined") {
            throw new Error("No response from content script.");
          }
          return response;
        });
      }
    } catch (_err) {}

    return new Promise(function (resolve, reject) {
      try {
        ext.tabs.sendMessage(tabId, message, function (response) {
          var lastErr = ext.runtime && ext.runtime.lastError;
          if (lastErr) {
            reject(new Error(lastErr.message || "tabs.sendMessage failed"));
            return;
          }
          if (typeof response === "undefined") {
            reject(new Error("No response from content script."));
            return;
          }
          resolve(response);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function getActiveTab() {
    return tabsQuery({ active: true, currentWindow: true }).then(function (tabs) {
      return (tabs && tabs[0]) || null;
    });
  }

  function pingBackground() {
    ccLog("bg-ping-send", { type: "caseCleaner:bgPing" });
    return runtimeSendMessage({ type: "caseCleaner:bgPing" }).then(function (response) {
      ccLog("bg-ping-response", { response: response || null });
      return response;
    });
  }

  function pingTab(tabId) {
    ccLog("tab-ping-send", { type: "caseCleaner:ping", tabId: tabId });
    return tabsSendMessage(tabId, { type: "caseCleaner:ping" }).then(function (response) {
      ccLog("tab-ping-response", { tabId: tabId, response: response || null });
      return response;
    });
  }

  function ensureInjected(tabId, reason) {
    ccLog("recovery-start", {
      tabId: tabId,
      reason: reason,
      type: "caseCleaner:ensureInjected"
    });
    return runtimeSendMessage({ type: "caseCleaner:ensureInjected", tabId: tabId }).then(function (response) {
      ccLog("recovery-response", { tabId: tabId, response: response || null });
      return response;
    });
  }

  function describeActionResult(resp) {
    if (!resp) { return ""; }
    var tail = [];
    if (resp.stats && typeof resp.stats.events === "number") {
      tail.push("events=" + resp.stats.events);
    }
    if (resp.stats && typeof resp.stats.emailsSummary === "number") {
      tail.push("emails=" + resp.stats.emailsSummary);
    }
    if (resp.caseNumber) {
      tail.push("case=" + resp.caseNumber);
    }
    return tail.length ? (" " + tail.join(" ")) : "";
  }

  function runAction(actionMessage, successText, closeOnSuccess) {
    var actionType = actionMessage && actionMessage.type;
    var activeTab = null;
    var attemptedRecovery = false;

    function failWith(message) {
      var text = String(message || "Action failed.");
      setStatus(text);
      ccLog("action-error", {
        action: actionType,
        tabId: activeTab && activeTab.id,
        tabUrl: activeTab && activeTab.url,
        attemptedRecovery: attemptedRecovery,
        error: text
      });
      throw new Error(text);
    }

    ccLog("action-start", { action: actionType });

    return getActiveTab().then(function (tab) {
      activeTab = tab;
      ccLog("active-tab", {
        action: actionType,
        tabId: tab && tab.id,
        tabUrl: tab && tab.url,
        tabStatus: tab && tab.status
      });

      if (!tab || typeof tab.id === "undefined") {
        return failWith("No active tab found.");
      }
      if (tab.status === "loading") {
        return failWith("Tab is still loading. Wait for Salesforce page load, then retry.");
      }
      if (!isSupportedSalesforceTab(tab)) {
        return failWith("Unsupported tab URL. Open a Salesforce case page and retry.");
      }
      if (!isSupportedCaseRoute(tab)) {
        return failWith("Unsupported route. Open /lightning/r/Case/*/view and retry.");
      }

      return pingBackground().catch(function (err) {
        return failWith("Background ping failed: " + toErrorText(err));
      }).then(function () {
        return pingTab(tab.id);
      }).catch(function (err) {
        var errText = toErrorText(err);
        if (!isMissingReceiverError(errText)) {
          return failWith("Tab ping failed: " + errText);
        }
        attemptedRecovery = true;
        setStatus("Content receiver missing. Injecting runtime scripts...");
        return ensureInjected(tab.id, "missing receiver on tab ping").then(function (injection) {
          if (!injection || injection.ok === false) {
            return failWith(
              "Injection failed [" +
              String((injection && injection.phase) || "unknown") +
              " " + String((injection && injection.file) || "") +
              "]: " + toErrorText(injection && injection.error)
            );
          }
          return delay(200).then(function () {
            return pingTab(tab.id).catch(function (pingErr) {
              return failWith("Post-injection tab ping failed: " + toErrorText(pingErr));
            });
          });
        });
      });
    }).then(function () {
      return tabsSendMessage(activeTab.id, actionMessage).catch(function (err) {
        var errText = toErrorText(err);
        if (isMissingReceiverError(errText)) {
          if (attemptedRecovery) {
            return failWith("Action failed after recovery: " + errText);
          }

          attemptedRecovery = true;
          setStatus("Receiver disappeared during action. Re-injecting...");
          return ensureInjected(activeTab.id, "missing receiver on action send").then(function (injection) {
            if (!injection || injection.ok === false) {
              return failWith(
                "Re-injection failed [" +
                String((injection && injection.phase) || "unknown") +
                " " + String((injection && injection.file) || "") +
                "]: " + toErrorText(injection && injection.error)
              );
            }
            return delay(200)
              .then(function () { return pingTab(activeTab.id); })
              .then(function () { return tabsSendMessage(activeTab.id, actionMessage); })
              .catch(function (retryErr) {
                return failWith("Action retry failed: " + toErrorText(retryErr));
              });
          });
        }
        return failWith("Action send failed: " + errText);
      });
    }).then(function (response) {
      ccLog("action-response", {
        action: actionType,
        tabId: activeTab && activeTab.id,
        tabUrl: activeTab && activeTab.url,
        attemptedRecovery: attemptedRecovery,
        response: response || null
      });

      if (response && response.ok === false) {
        var failText = response.error || "Action failed in content script.";
        setStatus(failText);
        return;
      }

      setStatus((successText || "Done.") + describeActionResult(response));
      if (closeOnSuccess) {
        window.close();
      }
    }).catch(function () {
      return undefined;
    });
  }

  document.getElementById("extractBtn").addEventListener("click", function () {
    runAction({ type: "caseCleaner:extract" }, "Case scraped.", false);
  });
  document.getElementById("copyJsonBtn").addEventListener("click", function () {
    runAction({ type: "caseCleaner:copyJson" }, "JSON copied.", false);
  });
  document.getElementById("copyAiBtn").addEventListener("click", function () {
    runAction({ type: "caseCleaner:copyAiText" }, "AI text copied.", false);
  });
  document.getElementById("exportBtn").addEventListener("click", function () {
    runAction({ type: "caseCleaner:exportJson" }, "JSON download requested.", false);
  });
})();