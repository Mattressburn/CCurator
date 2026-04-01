(function attachCompanionTransport(global) {
  "use strict";

  function getExtensionApi() {
    try {
      if (typeof browser !== "undefined" && browser && browser.runtime && typeof browser.runtime.sendMessage === "function") {
        return browser;
      }
    } catch (_e1) { }

    try {
      if (typeof chrome !== "undefined" && chrome && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
        return chrome;
      }
    } catch (_e2) { }

    try {
      if (global && global.browser && global.browser.runtime && typeof global.browser.runtime.sendMessage === "function") {
        return global.browser;
      }
    } catch (_e3) { }

    try {
      if (global && global.chrome && global.chrome.runtime && typeof global.chrome.runtime.sendMessage === "function") {
        return global.chrome;
      }
    } catch (_e4) { }

    try {
      if (typeof globalThis !== "undefined" && globalThis.browser && globalThis.browser.runtime && typeof globalThis.browser.runtime.sendMessage === "function") {
        return globalThis.browser;
      }
    } catch (_e5) { }

    try {
      if (typeof globalThis !== "undefined" && globalThis.chrome && globalThis.chrome.runtime && typeof globalThis.chrome.runtime.sendMessage === "function") {
        return globalThis.chrome;
      }
    } catch (_e6) { }

    return null;
  }

  function runtimeSendMessage(message) {
    var extApi = getExtensionApi();

    if (!(extApi && extApi.runtime && typeof extApi.runtime.sendMessage === "function")) {
      return Promise.reject(new Error("runtime.sendMessage not available"));
    }

    try {
      var maybePromise = extApi.runtime.sendMessage(message);
      if (maybePromise && typeof maybePromise.then === "function") {
        return maybePromise;
      }
    } catch (_err) { }

    return new Promise(function (resolve, reject) {
      try {
        extApi.runtime.sendMessage(message, function (response) {
          var lastErr = extApi.runtime && extApi.runtime.lastError;
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

  function sendToCompanion(envelope, options) {
    options = options || {};
    var endpoint = options.endpoint || "http://127.0.0.1:38455/workflow/case";
    var timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : 4000;

    return runtimeSendMessage({
      type: "cCurate:handoffToCompanion",
      endpoint: endpoint,
      timeoutMs: timeoutMs,
      envelope: envelope
    }).then(function (response) {
      if (!response) {
        return {
          attempted: true,
          success: false,
          response: null,
          error: "No response from background handoff"
        };
      }
      return response;
    }).catch(function (err) {
      return {
        attempted: true,
        success: false,
        response: null,
        error: String(err)
      };
    });
  }

  global.CompanionTransport = {
    sendToCompanion: sendToCompanion
  };
})(typeof globalThis !== "undefined" ? globalThis : window);