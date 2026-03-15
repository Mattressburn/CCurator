(function initGpcrmExtract(global) {
  "use strict";

  var norm = global.CaseCleanerNormalize;
  var cleanup = global.CaseCleanerGpcrmCleanup;
  var parser = global.CaseCleanerGpcrmParser;

  var ROUTE_RE = /\/lightning\/r\/Case\/[^/]+\/view(?:\?|#|$)/i;
  var CASE_TITLE_RE = /(\d{5,})\s*\|\s*Case\s*\|\s*Salesforce/i;

  var SELECTORS = {
    cards: "article.slds-card",
    openEmailBody: "#contentpage_emailTemplateBodyContent"
  };

  function isCaseRoute(url) {
    return ROUTE_RE.test(String(url || ""));
  }

  // Find the currently active tab so we don't scrape background cases
  function getActiveContainer(doc) {
    if (!doc) { return null; }
    var activeTab = doc.querySelector(".oneWorkspaceTabWrapper.active") ||
      doc.querySelector(".active.oneConsoleTab") ||
      doc.querySelector(".windowViewMode-maximized.active") ||
      doc.querySelector(".active.oneContent");
    return activeTab || doc.body;
  }

  function hasCaseRoots(doc) {
    var container = getActiveContainer(doc);
    if (!container) {
      return false;
    }

    // Pierce the Shadow DOM to see if the cards are rendered in the ACTIVE tab
    if (global.CaseCleanerUtils && global.CaseCleanerUtils.deepQueryAll) {
      var deepCards = global.CaseCleanerUtils.deepQueryAll(container, SELECTORS.cards);
      if (deepCards && deepCards.length > 0) {
        return true;
      }
    } else if (container.querySelector(SELECTORS.cards)) {
      return true;
    }

    return false;
  }

  function isReadyForScrape(doc, url) {
    return !!(doc && doc.body && isCaseRoute(url) && hasCaseRoots(doc));
  }

  function waitForStableDom(options) {
    var opts = options || {};
    var timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 12000;
    var pollMs = typeof opts.pollMs === "number" ? opts.pollMs : 250;

    return new Promise(function (resolve, reject) {
      var start = Date.now();
      var intervalId = null;

      function done(ok, reason) {
        if (intervalId) {
          global.clearInterval(intervalId);
          intervalId = null;
        }
        if (ok) {
          resolve({ ok: true, reason: reason });
        } else {
          reject(new Error(reason || "Timed out waiting for stable case DOM."));
        }
      }

      function check() {
        var href = String((global.location && global.location.href) || "");
        if (isReadyForScrape(global.document, href)) {
          global.setTimeout(function () {
            done(true, "ready");
          }, 600);
          return true;
        }
        return false;
      }

      if (check()) {
        return;
      }

      intervalId = global.setInterval(function () {
        if ((Date.now() - start) > timeoutMs) {
          done(false, "Timed out waiting for stable case DOM.");
          return;
        }
        if (check()) {
          global.clearInterval(intervalId);
          intervalId = null;
        }
      }, pollMs);
    });
  }

  function extractCaseNumber(doc) {
    var title = String((doc && doc.title) || "");
    var titleMatch = title.match(CASE_TITLE_RE);
    if (titleMatch) {
      return titleMatch[1];
    }

    var container = getActiveContainer(doc);
    var bodyText = norm.normalizeWhitespace(norm.textFromElement(container)).slice(0, 3000);
    var fallback = bodyText.match(/\b(\d{5,10})\b/);
    return fallback ? fallback[1] : "";
  }

  function getCardBuckets(doc, includeDebugCards) {
    var container = getActiveContainer(doc);
    var cards = [];

    // Scrape only from the active container
    if (global.CaseCleanerUtils && global.CaseCleanerUtils.deepQueryAll) {
      cards = global.CaseCleanerUtils.deepQueryAll(container, SELECTORS.cards);
    } else {
      cards = container.querySelectorAll(SELECTORS.cards);
    }

    // Filter to visible cards only to avoid background tabs
    if (global.CaseCleanerUtils && global.CaseCleanerUtils.isElementVisible) {
      var visibleCards = [];
      for (var c = 0; c < cards.length; c += 1) {
        if (global.CaseCleanerUtils.isElementVisible(cards[c])) {
          visibleCards.push(cards[c]);
        }
      }
      cards = visibleCards;
    }

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
    var container = getActiveContainer(doc);

    if (global.CaseCleanerUtils && global.CaseCleanerUtils.getSearchRoots) {
      var roots = global.CaseCleanerUtils.getSearchRoots(container);
      var fullText = "";
      for (var i = 0; i < roots.length; i++) {
        var r = roots[i];
        if (r === container) {
          fullText += norm.textFromElement(r) + "\n";
        } else if (r.nodeType === 11 && r.host) {
          // Ignore Shadow DOMs belonging to hidden elements (like background tabs)
          if (global.CaseCleanerUtils.isElementVisible(r.host)) {
            fullText += norm.textFromElement(r) + "\n";
          }
        }
      }
      return cleanup.normalizeTextHard(fullText);
    }

    return cleanup.normalizeTextHard(norm.textFromElement(container));
  }

  function collectOpenEmailBody(doc) {
    var container = getActiveContainer(doc);
    // Find all potential open email bodies inside this container
    var els = container.querySelectorAll(SELECTORS.openEmailBody);
    for (var i = 0; i < els.length; i++) {
      // Ensure we only extract the text from the email body that is currently visible
      if (global.CaseCleanerUtils && global.CaseCleanerUtils.isElementVisible(els[i])) {
        return cleanup.stripQuotedEmailChain(norm.textFromElement(els[i]));
      }
    }
    return "";
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