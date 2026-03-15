(function initCCurateExports(global) {
  "use strict";

  function buildPortablePayload(payload) {
    if (!payload) {
      return null;
    }
    return {
      url: String(payload.url || ""),
      caseNumber: String(payload.caseNumber || ""),
      title: String(payload.title || ""),
      extractedAt: String(payload.extractedAt || ""),
      emailsSummary: Array.isArray(payload.emailsSummary) ? payload.emailsSummary.slice() : [],
      events: Array.isArray(payload.events) ? payload.events.slice() : [],
      escalation: Array.isArray(payload.escalation) ? payload.escalation.slice() : [],
      caseHistory: Array.isArray(payload.caseHistory) ? payload.caseHistory.slice() : [],
      rawVisibleText: String(payload.rawVisibleText || "")
    };
  }

  function toJson(payload) {
    return JSON.stringify(buildPortablePayload(payload), null, 2);
  }

  function toAiText(payload, explicitAiText) {
    if (explicitAiText) {
      return String(explicitAiText || "");
    }

    var p = buildPortablePayload(payload) || {};
    var lines = [];
    lines.push("Case " + (p.caseNumber || "unknown") + " | " + (p.title || ""));
    lines.push("URL: " + (p.url || ""));
    lines.push("");

    for (var i = 0; i < (p.events || []).length; i += 1) {
      var ev = p.events[i];
      lines.push("[" + String(ev.label || ev.type || "event") + "] " + String(ev.timestamp || "") + " " + String(ev.actor || ""));
      lines.push(String(ev.translatedText || ev.text || ""));
    }

    return lines.join("\n").trim();
  }

  function execCopy(text) {
    try {
      var area = global.document.createElement("textarea");
      area.value = String(text || "");
      area.setAttribute("readonly", "readonly");
      area.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
      global.document.body.appendChild(area);
      area.focus();
      area.select();
      var ok = global.document.execCommand("copy");
      area.remove();
      return !!ok;
    } catch (_err) {
      return false;
    }
  }

  function copyToClipboard(text) {
    var payload = String(text || "");
    if (!payload) {
      return Promise.resolve(false);
    }

    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      return global.navigator.clipboard.writeText(payload)
        .then(function () { return true; })
        .catch(function () { return execCopy(payload); });
    }

    return Promise.resolve(execCopy(payload));
  }

  function sanitizeFilename(input) {
    return String(input || "case")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function downloadJson(payload, caseNumber) {
    try {
      var json = toJson(payload);
      var fileName = "case-" + sanitizeFilename(caseNumber || "unknown") + ".json";
      var blob = new Blob([json], { type: "application/json;charset=utf-8" });
      var url = global.URL.createObjectURL(blob);
      var link = global.document.createElement("a");
      link.href = url;
      link.download = fileName;
      global.document.body.appendChild(link);
      link.click();
      link.remove();
      global.setTimeout(function () {
        global.URL.revokeObjectURL(url);
      }, 1200);
      return true;
    } catch (_err) {
      return false;
    }
  }

  global.CCurateExports = {
    buildPortablePayload: buildPortablePayload,
    toJson: toJson,
    toAiText: toAiText,
    copyToClipboard: copyToClipboard,
    downloadJson: downloadJson
  };
})(window);
