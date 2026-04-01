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
      accountName: String(payload.accountName || ""),
      customerName: String(payload.customerName || ""),
      endUserName: String(payload.endUserName || ""),
      integratorName: String(payload.integratorName || ""),
      siteName: String(payload.siteName || ""),
      locationName: String(payload.locationName || ""),
      contactName: String(payload.contactName || ""),
      contactEmail: String(payload.contactEmail || ""),
      phone: String(payload.phone || ""),
      region: String(payload.region || ""),
      subjectLine: String(payload.subjectLine || ""),
      primaryProduct: String(payload.primaryProduct || ""),
      productVersion: String(payload.productVersion || ""),
      issueStatement: String(payload.issueStatement || ""),
      issueDetails: String(payload.issueDetails || ""),
      folderStem: String(payload.folderStem || ""),
      metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
      emailsSummary: Array.isArray(payload.emailsSummary) ? payload.emailsSummary.slice() : [],
      events: Array.isArray(payload.events) ? payload.events.slice() : [],
      escalation: Array.isArray(payload.escalation) ? payload.escalation.slice() : [],
      caseHistory: Array.isArray(payload.caseHistory) ? payload.caseHistory.slice() : [],
      rawVisibleText: String(payload.rawVisibleText || ""),
      extractionContext: payload.extractionContext && typeof payload.extractionContext === "object"
        ? payload.extractionContext
        : {}
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
    var i;
    var ev;
    lines.push("Case " + (p.caseNumber || "unknown") + " | " + (p.title || ""));
    lines.push("URL: " + (p.url || ""));
    if (p.customerName) { lines.push("Customer: " + p.customerName); }
    if (p.endUserName) { lines.push("End User: " + p.endUserName); }
    if (p.integratorName) { lines.push("Integrator: " + p.integratorName); }
    if (p.siteName) { lines.push("Site: " + p.siteName); }
    if (p.contactName) { lines.push("Contact: " + p.contactName); }
    if (p.contactEmail) { lines.push("Contact Email: " + p.contactEmail); }
    if (p.primaryProduct) { lines.push("Product: " + p.primaryProduct); }
    if (p.productVersion) { lines.push("Version: " + p.productVersion); }
    if (p.issueStatement) { lines.push("Issue: " + p.issueStatement); }
    if (p.folderStem) { lines.push("Folder Stem: " + p.folderStem); }
    lines.push("");
    for (i = 0; i < (p.events || []).length; i += 1) {
      ev = p.events[i];
      lines.push("[" + String(ev.label || ev.type || "event") + "] " + String(ev.timestamp || "") + " " + String(ev.actor || ""));
      lines.push(String(ev.translatedText || ev.text || ""));
      lines.push("");
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
      .replace(/[^a-z0-9_.-]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
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
      return { ok: true, fileName: fileName };
    } catch (err) {
      return { ok: false, error: String(err || "download failed") };
    }
  }

  function _generateUuid() {
    try {
      if (global.crypto && global.crypto.getRandomValues) {
        var r = global.crypto.getRandomValues(new Uint8Array(16));
        r[6] = (r[6] & 0x0f) | 0x40;
        r[8] = (r[8] & 0x3f) | 0x80;
        var hex = Array.prototype.map.call(r, function (b) {
          return (b + 0x100).toString(16).substr(1);
        }).join("");
        return hex.substr(0, 8) + "-" + hex.substr(8, 4) + "-" + hex.substr(12, 4) + "-" + hex.substr(16, 4) + "-" + hex.substr(20, 12);
      }
    } catch (_e) {}
    function s4() { return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1); }
    return s4() + s4() + "-" + s4() + "-" + s4() + "-" + s4() + "-" + s4() + s4() + s4();
  }

  function currentPageContext() {
    var pageUrl = String((global.location && global.location.href) || "");
    var pageTitle = String((global.document && global.document.title) || "");
    var visibleCaseNumberHint = "";
    var fromExtractor = global.CCurateGpcrmExtract && typeof global.CCurateGpcrmExtract.buildPayload === "function"
      ? null
      : null;

    var titleMatch = pageTitle.match(/\b(\d{5,10})\b/);
    if (titleMatch) {
      visibleCaseNumberHint = titleMatch[1];
    } else {
      var header = global.document && global.document.querySelector
        ? global.document.querySelector("h1, .forceHighlightsPanel, .slds-page-header")
        : null;
      var headerText = String((header && (header.innerText || header.textContent)) || "");
      var headerMatch = headerText.match(/\b(\d{5,10})\b/);
      if (headerMatch) {
        visibleCaseNumberHint = headerMatch[1];
      }
    }

    return {
      pageUrl: pageUrl,
      pageTitle: pageTitle,
      visibleCaseNumberHint: visibleCaseNumberHint
    };
  }

  function buildFreshExportContext() {
    if (!global.CCurateGpcrmExtract || typeof global.CCurateGpcrmExtract.buildPayload !== "function") {
      throw new Error("CCurateGpcrmExtract.buildPayload is unavailable");
    }
    var built = global.CCurateGpcrmExtract.buildPayload();
    var ctx = currentPageContext();
    var payload = built && built.payload ? built.payload : null;
    if (!payload) {
      throw new Error("Fresh extraction returned no payload");
    }
    if (!payload.extractionContext || typeof payload.extractionContext !== "object") {
      payload.extractionContext = {};
    }
    payload.extractionContext.pageUrl = ctx.pageUrl;
    payload.extractionContext.pageTitle = ctx.pageTitle;
    payload.extractionContext.visibleCaseNumberHint = payload.extractionContext.visibleCaseNumberHint || ctx.visibleCaseNumberHint;
    return {
      payload: payload,
      aiText: built && built.aiText ? built.aiText : "",
      page: ctx
    };
  }

  function detectMismatch(payload, page) {
    var extracted = String(payload && payload.caseNumber || "").trim();
    var hinted = String(
      (payload && payload.extractionContext && payload.extractionContext.visibleCaseNumberHint) ||
      (page && page.visibleCaseNumberHint) ||
      ""
    ).trim();

    return {
      extractedCaseNumber: extracted,
      visibleCaseNumberHint: hinted,
      mismatch: !!(extracted && hinted && extracted !== hinted)
    };
  }

  function buildCompanionEnvelope(parsedCase, meta) {
    var p = parsedCase || {};
    var metaOptions = (meta && meta.options) || {};
    var extractionContext = p.extractionContext || {};
    return {
      schemaVersion: "2.1",
      source: "gpcrm-extension",
      origin: String((meta && meta.origin) || "browser-popup-download"),
      trigger: String((meta && meta.trigger) || "cCurate:exportJson"),
      workflow: String((meta && meta.workflow) || "case-post-acceptance"),
      correlationId: String((meta && meta.correlationId) || _generateUuid()),
      exportedAt: String((meta && meta.exportedAt) || (new Date()).toISOString()),
      pageUrl: String(extractionContext.pageUrl || p.url || ""),
      pageTitle: String(extractionContext.pageTitle || p.title || ""),
      visibleCaseNumberHint: String(extractionContext.visibleCaseNumberHint || ""),
      case: {
        caseNumber: String(p.caseNumber || ""),
        folderStem: String(p.folderStem || ""),
        accountName: String(p.accountName || ""),
        customerName: String(p.customerName || ""),
        contactName: String(p.contactName || ""),
        contactEmail: String(p.contactEmail || ""),
        phone: String(p.phone || ""),
        subjectLine: String(p.subjectLine || ""),
        primaryProduct: String(p.primaryProduct || ""),
        productVersion: String(p.productVersion || ""),
        issueStatement: String(p.issueStatement || ""),
        url: String(p.url || "")
      },
      options: {
        createOneNote: metaOptions.createOneNote !== false,
        createFolders: metaOptions.createFolders !== false,
        applySharing: !!metaOptions.applySharing,
        dryRun: !!metaOptions.dryRun
      }
    };
  }

  function sendViaFetch(envelope, options) {
    options = options || {};
    var endpoint = options.endpoint || "http://127.0.0.1:38455/workflow/case";
    var timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : 4000;
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null;

    if (controller) {
      timer = global.setTimeout(function () {
        try { controller.abort(); } catch (_e) {}
      }, timeoutMs);
    }

    return fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var parsed = null;
        try { parsed = JSON.parse(text); } catch (_e) {}
        return {
          attempted: true,
          success: !!res.ok,
          status: res.status,
          response: parsed,
          rawText: text,
          error: res.ok ? null : ("HTTP " + res.status)
        };
      });
    }).catch(function (err) {
      return {
        attempted: true,
        success: false,
        response: null,
        error: String(err || "fetch failed")
      };
    }).then(function (result) {
      if (timer) {
        global.clearTimeout(timer);
      }
      return result;
    });
  }

  function sendToCompanion(envelope, options) {
    options = options || {};
    if (global && global.CompanionTransport && typeof global.CompanionTransport.sendToCompanion === "function") {
      try {
        return global.CompanionTransport.sendToCompanion(envelope, {
          endpoint: options.endpoint || "http://127.0.0.1:38455/workflow/case",
          timeoutMs: typeof options.timeoutMs === "number" ? options.timeoutMs : 4000
        }).then(function (r) {
          if (r && typeof r === "object") {
            return r;
          }
          return {
            attempted: true,
            success: false,
            response: null,
            error: "CompanionTransport returned invalid result"
          };
        });
      } catch (e) {
        return sendViaFetch(envelope, options);
      }
    }
    return sendViaFetch(envelope, options);
  }

  function summarizeResponse(resp) {
    var r = resp && resp.response ? resp.response : null;
    return {
      logPath: r && r.logPath ? String(r.logPath) : "",
      correlationId: r && r.correlationId ? String(r.correlationId) : "",
      requestOrigin: r && r.requestOrigin ? String(r.requestOrigin) : "",
      receivedCaseNumber: r && r.receivedCaseNumber ? String(r.receivedCaseNumber) : "",
      receivedFolderStem: r && r.receivedFolderStem ? String(r.receivedFolderStem) : "",
      receivedPageUrl: r && r.receivedPageUrl ? String(r.receivedPageUrl) : ""
    };
  }

  global.CCurateExports = {
    buildPortablePayload: buildPortablePayload,
    toJson: toJson,
    toAiText: toAiText,
    copyToClipboard: copyToClipboard,
    downloadJson: downloadJson,
    buildCompanionEnvelope: buildCompanionEnvelope,
    sendToCompanion: sendToCompanion,
    exportCase: function (_payload, options) {
      options = options || {};

      var result = {
        ok: false,
        saved: false,
        savedFileName: "",
        freshScrapeHappened: false,
        extractedCaseNumber: "",
        visibleCaseNumberHint: "",
        pageUrl: "",
        pageTitle: "",
        mismatchDetected: false,
        error: null,
        correlationId: "",
        handoffAttempted: false,
        handoffSucceeded: false,
        handoffResponse: null,
        handoffError: null,
        handoffLogPath: "",
        requestOrigin: "browser-popup-download",
        trigger: "cCurate:exportJson"
      };

      try {
        var fresh = buildFreshExportContext();
        var payload = fresh.payload;
        var page = fresh.page;
        var mismatch = detectMismatch(payload, page);

        result.freshScrapeHappened = true;
        result.extractedCaseNumber = mismatch.extractedCaseNumber;
        result.visibleCaseNumberHint = mismatch.visibleCaseNumberHint;
        result.pageUrl = page.pageUrl;
        result.pageTitle = page.pageTitle;
        result.mismatchDetected = mismatch.mismatch;

        if (!payload || !payload.caseNumber) {
          result.error = "Fresh scrape did not produce a case number. Export aborted.";
          return Promise.resolve(result);
        }

        if (mismatch.mismatch) {
          result.error =
            "Mismatch detected. Current page hint " + mismatch.visibleCaseNumberHint +
            " does not match extracted case " + mismatch.extractedCaseNumber +
            ". Export aborted.";
          return Promise.resolve(result);
        }

        var saved = downloadJson(payload, payload.caseNumber);
        result.saved = !!(saved && saved.ok);
        result.savedFileName = saved && saved.fileName ? saved.fileName : "";

        if (!result.saved) {
          result.error = (saved && saved.error) ? saved.error : "Download failed.";
          return Promise.resolve(result);
        }

        if (!options.handoffEnabled) {
          result.ok = true;
          return Promise.resolve(result);
        }

        var meta = Object.assign({}, options.meta || {}, {
          origin: "browser-popup-download",
          trigger: "cCurate:exportJson"
        });

        var envelope = buildCompanionEnvelope(payload, meta);
        result.correlationId = envelope.correlationId;
        result.handoffAttempted = true;

        return sendToCompanion(envelope, options.companionOptions || {}).then(function (r) {
          var summary = summarizeResponse(r);
          result.handoffSucceeded = !!(r && r.success);
          result.handoffResponse = r && r.response ? r.response : null;
          result.handoffError = r && r.error ? String(r.error) : null;
          result.handoffLogPath = summary.logPath;
          if (summary.correlationId && !result.correlationId) {
            result.correlationId = summary.correlationId;
          }
          result.ok = result.saved && result.handoffSucceeded;
          try {
            console.log("[CCurate][exportCase]", {
              freshScrapeHappened: result.freshScrapeHappened,
              extractedCaseNumber: result.extractedCaseNumber,
              visibleCaseNumberHint: result.visibleCaseNumberHint,
              mismatchDetected: result.mismatchDetected,
              correlationId: result.correlationId,
              handoffSucceeded: result.handoffSucceeded,
              requestOrigin: summary.requestOrigin,
              logPath: result.handoffLogPath,
              receivedCaseNumber: summary.receivedCaseNumber
            });
          } catch (_err) {}
          return result;
        });
      } catch (err) {
        result.error = String(err || "Export failed.");
        return Promise.resolve(result);
      }
    }
  };
})(window);
``