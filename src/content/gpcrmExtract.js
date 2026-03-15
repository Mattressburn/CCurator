(function initGpcrmExtract(global) {
  "use strict";

  var norm = global.CaseCleanerNormalize;
  var cleanup = global.CaseCleanerGpcrmCleanup;
  var parser = global.CaseCleanerGpcrmParser;

  var ROUTE_RE = /\/lightning\/r\/Case\/[^/]+\/view(?:\?|#|$)/i;
  var CASE_TITLE_RE = /(\d{5,})\s*\|\s*Case\s*\|\s*Salesforce/i;

  var SELECTORS = {
    cards: "article.slds-card",
    openEmailBody: "#contentpage_emailTemplateBodyContent",
    caseRootA: "#brandBand_2",
    caseRootB: "one-record-home-flexipage2"
  };

  function isCaseRoute(url) {
    return ROUTE_RE.test(String(url || ""));
  }

  function hasCaseRoots(doc) {
    if (!doc || !doc.querySelector) {
      return false;
    }
    return !!(doc.querySelector(SELECTORS.cards) || doc.querySelector(SELECTORS.caseRootA));
  }

  function isReadyForScrape(doc, url) {
    return !!(doc && doc.body && isCaseRoute(url) && hasCaseRoots(doc));
  }

  function waitForStableDom(options) {
    var opts = options || {};
    var timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 12000;
    var settleMs = typeof opts.settleMs === "number" ? opts.settleMs : 450;
    var pollMs = typeof opts.pollMs === "number" ? opts.pollMs : 120;

    return new Promise(function (resolve, reject) {
      var start = Date.now();
      var settledTimer = null;
      var observer = null;
      var intervalId = null;

      function done(ok, reason) {
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        if (intervalId) {
          global.clearInterval(intervalId);
          intervalId = null;
        }
        if (settledTimer) {
          global.clearTimeout(settledTimer);
          settledTimer = null;
        }
        if (ok) {
          resolve({ ok: true, reason: reason || "ready" });
        } else {
          reject(new Error(reason || "Timed out waiting for stable case DOM."));
        }
      }

      function checkReady() {
        var href = String((global.location && global.location.href) || "");
        if (!isReadyForScrape(global.document, href)) {
          return false;
        }
        if (settledTimer) {
          global.clearTimeout(settledTimer);
        }
        settledTimer = global.setTimeout(function () {
          done(true, "stable");
        }, settleMs);
        return true;
      }

      function tick() {
        if ((Date.now() - start) > timeoutMs) {
          done(false, "Timed out waiting for stable case DOM.");
          return;
        }
        checkReady();
      }

      if (typeof global.MutationObserver !== "undefined" && global.document && global.document.documentElement) {
        observer = new MutationObserver(function () {
          checkReady();
        });
        observer.observe(global.document.documentElement, {
          childList: true,
          subtree: true,
          attributes: false
        });
      }

      intervalId = global.setInterval(function () {
        if ((Date.now() - start) > timeoutMs) {
          done(false, "Timed out waiting for stable case DOM.");
          return;
        }
        tick();
      }, pollMs);

      checkReady();
    });
  }

  function extractCaseNumber(doc) {
    var title = String((doc && doc.title) || "");
    var titleMatch = title.match(CASE_TITLE_RE);
    if (titleMatch) {
      return titleMatch[1];
    }

    var bodyText = norm.normalizeWhitespace(norm.textFromElement(doc && doc.body)).slice(0, 3000);
    var fallback = bodyText.match(/\b(\d{5,10})\b/);
    return fallback ? fallback[1] : "";
  }

  function getCardBuckets(doc, includeDebugCards) {
    var cards = doc.querySelectorAll(SELECTORS.cards);
    var out = {
      emails: null,
      activityHistory: null,
      ignored: [],
      allCards: []
    };

    for (var i = 0; i < cards.length; i += 1) {
      var card = cards[i];
      var kind = parser.classifyCard(card);
      out.allCards.push({ kind: kind, el: card });

      if (kind === "emails" && !out.emails) {
        out.emails = card;
        continue;
      }
      if (kind === "activityHistory" && !out.activityHistory) {
        out.activityHistory = card;
        continue;
      }

      if (kind === "knowledge" || kind === "productHierarchy" || kind === "files") {
        if (includeDebugCards) {
          out.ignored.push({ kind: kind, text: norm.normalizeText(norm.textFromElement(card)).slice(0, 180) });
        }
      }
    }

    return out;
  }

  function collectVisibleRawText(doc) {
    return cleanup.normalizeTextHard(norm.textFromElement(doc && doc.body));
  }

  function collectOpenEmailBody(doc) {
    var el = doc.querySelector(SELECTORS.openEmailBody);
    if (!el) {
      return "";
    }
    return cleanup.stripQuotedEmailChain(norm.textFromElement(el));
  }

  function buildPayload(options) {
    var opts = options || {};
    var doc = global.document;
    var url = String((global.location && global.location.href) || "");
    var title = String((doc && doc.title) || "");

    var buckets = getCardBuckets(doc, !!opts.includeDebugCards);
    var emailsSummary = parser.parseEmailsSummaryRows(buckets.emails);

    var rawVisibleText = collectVisibleRawText(doc);
    var parsedEvents = parser.parseEventsFromText(rawVisibleText);
    var split = parser.splitByType(parsedEvents);

    var openEmailBody = collectOpenEmailBody(doc);
    if (openEmailBody) {
      split.events.unshift({
        type: "emailMessage",
        label: "Email Message",
        actor: "",
        timestamp: "",
        text: openEmailBody,
        originalText: openEmailBody,
        translatedText: "",
        spanishDetected: false,
        translationAvailable: false,
        source: "#contentpage_emailTemplateBodyContent"
      });
    }

    var payload = {
      url: url,
      caseNumber: extractCaseNumber(doc),
      title: title,
      extractedAt: new Date().toISOString(),
      emailsSummary: emailsSummary,
      events: split.events,
      escalation: split.escalation,
      caseHistory: split.caseHistory,
      rawVisibleText: rawVisibleText
    };

    return {
      payload: payload,
      aiText: parser.buildAiText(payload),
      debug: {
        routeMatched: isCaseRoute(url),
        cardCount: buckets.allCards.length,
        ignoredCards: buckets.ignored,
        hasBrandBand: !!doc.querySelector(SELECTORS.caseRootA),
        hasFlexipageRoot: !!doc.querySelector(SELECTORS.caseRootB),
        hasOpenEmailBody: !!openEmailBody
      }
    };
  }

  global.CaseCleanerGpcrmExtract = {
    SELECTORS: SELECTORS,
    isCaseRoute: isCaseRoute,
    isReadyForScrape: isReadyForScrape,
    waitForStableDom: waitForStableDom,
    buildPayload: buildPayload
  };
})(window);