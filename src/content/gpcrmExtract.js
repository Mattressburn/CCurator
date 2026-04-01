(function initCCurateGpcrmExtract(global) {
  "use strict";

  var parser = global.CCurateGpcrmParser;
  var ROUTE_RE = /\/lightning\/r\/Case\/[^/]+\/view(?:[?#]|$)/i;

  function normalizeSpace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function textOf(el) {
    if (!el) {
      return "";
    }
    return normalizeSpace(el.innerText || el.textContent || "");
  }

  function firstCaseNumber(text) {
    var match = String(text || "").match(/\b(\d{5,10})\b/);
    return match ? match[1] : "";
  }

  function titleCaseNumber(doc) {
    var title = normalizeSpace(doc && doc.title);
    return firstCaseNumber(title);
  }

  function routeCaseId(url) {
    var match = String(url || "").match(/\/lightning\/r\/Case\/([^/]+)\/view(?:[?#]|$)/i);
    return match ? match[1] : "";
  }

  function firstEmailFromText(text) {
    var match = String(text || "").match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    return match ? match[0] : "";
  }

  function classNameOf(el) {
    if (!el || typeof el.className !== "string") {
      return "";
    }
    return normalizeSpace(el.className);
  }

  function getStyle(el) {
    try {
      return global.getComputedStyle ? global.getComputedStyle(el) : null;
    } catch (_err) {
      return null;
    }
  }

  function isVisibleElement(el) {
    var rect;
    var style;
    if (!el || !el.getBoundingClientRect) {
      return false;
    }
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") {
      return false;
    }
    style = getStyle(el);
    if (style && (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0)) {
      return false;
    }
    rect = el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    return true;
  }

  function elementSummary(el) {
    if (!el || !el.tagName) {
      return "";
    }
    var id = el.id ? ("#" + el.id) : "";
    var cls = classNameOf(el);
    if (cls) {
      cls = "." + cls.split(/\s+/).slice(0, 4).join(".");
    }
    return el.tagName.toLowerCase() + id + cls;
  }

  function pushUnique(out, seen, el) {
    if (!el || seen.indexOf(el) >= 0) {
      return;
    }
    seen.push(el);
    out.push(el);
  }

  function candidateIdTokensFromTab(tabEl) {
    var out = [];
    var seen = [];
    var ariaControls = tabEl && tabEl.getAttribute ? tabEl.getAttribute("aria-controls") : "";
    var href = tabEl && tabEl.getAttribute ? tabEl.getAttribute("href") : "";
    var labelled = tabEl && tabEl.id ? tabEl.id : "";
    var targetSelectionName = tabEl && tabEl.getAttribute ? tabEl.getAttribute("data-target-selection-name") : "";
    var dataTab = tabEl && tabEl.getAttribute ? tabEl.getAttribute("data-tab-id") : "";

    function add(value) {
      var token = normalizeSpace(value);
      if (!token || seen.indexOf(token) >= 0) {
        return;
      }
      seen.push(token);
      out.push(token);
    }

    add(ariaControls);
    add(labelled);
    add(targetSelectionName);
    add(dataTab);

    if (href && href.charAt(0) === "#") {
      add(href.slice(1));
    }

    return out;
  }

  function collectActiveTabs(doc) {
    var selectors = [
      "[role='tab'][aria-selected='true']",
      "[role='tab'].slds-is-active",
      ".slds-is-active [role='tab']",
      ".oneConsoleTabItem[aria-selected='true']",
      ".oneConsoleTabItem.slds-is-active",
      ".tabBar [role='tab'].active",
      ".workspaceTab [role='tab'].slds-is-active",
      "[role='tab'].active"
    ];
    var out = [];
    var seen = [];
    var i;
    var j;
    var list;
    var el;

    for (i = 0; i < selectors.length; i += 1) {
      list = doc.querySelectorAll(selectors[i]);
      for (j = 0; j < list.length; j += 1) {
        el = list[j];
        if (isVisibleElement(el)) {
          pushUnique(out, seen, el);
        }
      }
    }

    return out;
  }

  function scoreActiveTab(tabEl) {
    var score = 0;
    var label = textOf(tabEl);
    var cls = classNameOf(tabEl);

    if (!label) {
      return -1;
    }
    if (tabEl.getAttribute && tabEl.getAttribute("aria-selected") === "true") {
      score += 80;
    }
    if (/\bslds-is-active\b|\bactive\b/i.test(cls)) {
      score += 25;
    }
    if (/\bcase\b/i.test(label)) {
      score += 15;
    }
    if (firstCaseNumber(label)) {
      score += 35;
    }
    if (tabEl.id) {
      score += 5;
    }
    if (tabEl.getAttribute && tabEl.getAttribute("aria-controls")) {
      score += 10;
    }

    return score;
  }

  function resolveActiveTab(doc) {
    var tabs = collectActiveTabs(doc);
    var best = null;
    var bestScore = -1;
    var i;
    var tab;
    var score;
    var label;
    var ids;

    for (i = 0; i < tabs.length; i += 1) {
      tab = tabs[i];
      score = scoreActiveTab(tab);
      if (score > bestScore) {
        best = tab;
        bestScore = score;
      }
    }

    if (!best) {
      return {
        element: null,
        labelText: "",
        caseNumber: "",
        score: -1,
        id: "",
        ariaControls: "",
        candidateIds: []
      };
    }

    label = textOf(best);
    ids = candidateIdTokensFromTab(best);

    return {
      element: best,
      labelText: label,
      caseNumber: firstCaseNumber(label),
      score: bestScore,
      id: best.id || "",
      ariaControls: (best.getAttribute && best.getAttribute("aria-controls")) || "",
      candidateIds: ids
    };
  }

  function collectPanelCandidates(doc) {
    var selectors = [
      "[role='tabpanel']",
      ".oneWorkspaceTabWrapper",
      ".workspaceTab",
      ".workspaceLeaf",
      ".flexipagePage",
      ".oneAlohaPage",
      ".slds-template__container",
      ".forceRecordLayout",
      "article",
      "section",
      "main"
    ];
    var out = [];
    var seen = [];
    var i;
    var j;
    var list;
    var el;

    for (i = 0; i < selectors.length; i += 1) {
      list = doc.querySelectorAll(selectors[i]);
      for (j = 0; j < list.length; j += 1) {
        el = list[j];
        if (!isVisibleElement(el)) {
          continue;
        }
        if (el.getAttribute && el.getAttribute("aria-hidden") === "true") {
          continue;
        }
        pushUnique(out, seen, el);
      }
    }

    return out;
  }

  function directLinkedPanel(doc, activeTab) {
    var ids = activeTab && activeTab.candidateIds ? activeTab.candidateIds : [];
    var i;
    var id;
    var byId;
    var byLabelled;
    var list;
    var j;

    for (i = 0; i < ids.length; i += 1) {
      id = ids[i];
      if (!id) {
        continue;
      }
      byId = doc.getElementById(id);
      if (byId && isVisibleElement(byId)) {
        return byId;
      }
      list = doc.querySelectorAll("[aria-labelledby='" + cssEscape(id) + "']");
      for (j = 0; j < list.length; j += 1) {
        byLabelled = list[j];
        if (isVisibleElement(byLabelled)) {
          return byLabelled;
        }
      }
    }

    return null;
  }

  function cssEscape(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  function scorePanel(el, ctx, activeTab) {
    var score = 0;
    var txt = textOf(el);
    var cls = classNameOf(el);
    var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    var caseHintInPanel = firstCaseNumber(txt);
    var reasons = [];
    var id = el.id || "";
    var ariaLabelledBy = el.getAttribute ? (el.getAttribute("aria-labelledby") || "") : "";
    var linkedIds = activeTab && activeTab.candidateIds ? activeTab.candidateIds : [];
    var i;

    if (!txt) {
      return {
        score: -1,
        reasons: ["empty-text"],
        caseHintInPanel: "",
        summary: elementSummary(el)
      };
    }

    for (i = 0; i < linkedIds.length; i += 1) {
      if (linkedIds[i] && (linkedIds[i] === id || linkedIds[i] === ariaLabelledBy)) {
        score += 140;
        reasons.push("direct-tab-link");
        break;
      }
    }

    if (activeTab && activeTab.id && ariaLabelledBy === activeTab.id) {
      score += 120;
      reasons.push("aria-labelledby-active-tab");
    }

    if (el.getAttribute && el.getAttribute("aria-hidden") === "false") {
      score += 35;
      reasons.push("aria-hidden-false");
    }

    if (/\bslds-is-active\b|\bactive\b/i.test(cls)) {
      score += 30;
      reasons.push("active-class");
    }

    if (ctx.activeTabCaseNumber && txt.indexOf(ctx.activeTabCaseNumber) >= 0) {
      score += 70;
      reasons.push("contains-active-case-number");
    }

    if (ctx.activeTabLabelText) {
      var compactLabel = normalizeSpace(ctx.activeTabLabelText.replace(/\|\s*Case\b/i, ""));
      if (compactLabel && txt.indexOf(compactLabel) >= 0) {
        score += 30;
        reasons.push("contains-active-tab-label");
      }
    }

    if (/\bCase\b/i.test(txt)) {
      score += 12;
      reasons.push("contains-case");
    }
    if (/\bAccount\b/i.test(txt)) {
      score += 8;
      reasons.push("contains-account");
    }
    if (/Activity History|Emails\s*\(|Case History|Case Action/i.test(txt)) {
      score += 18;
      reasons.push("contains-case-activity");
    }

    if (rect && rect.width >= 600) {
      score += 10;
      reasons.push("wide-layout");
    }
    if (rect && rect.height >= 300) {
      score += 10;
      reasons.push("tall-layout");
    }

    score += Math.min(txt.length, 20000) / 2500;

    return {
      score: score,
      reasons: reasons,
      caseHintInPanel: caseHintInPanel,
      summary: elementSummary(el)
    };
  }

  function visibleCaseNumberHint(doc, activeTab, chosenContainer) {
    var panelHeader;
    var panelHeaderText;
    var panelCase;
    var fallbackHeader;
    var fallbackHeaderText;
    var fromTitle;

    if (activeTab && activeTab.caseNumber) {
      return activeTab.caseNumber;
    }

    if (chosenContainer && chosenContainer.querySelector) {
      panelHeader = chosenContainer.querySelector("h1, .forceHighlightsPanel, .slds-page-header, [data-aura-class='forceHighlightsPanel']");
      panelHeaderText = textOf(panelHeader);
      panelCase = firstCaseNumber(panelHeaderText) || firstCaseNumber(textOf(chosenContainer).slice(0, 1500));
      if (panelCase) {
        return panelCase;
      }
    }

    fromTitle = titleCaseNumber(doc);
    if (fromTitle) {
      return fromTitle;
    }

    fallbackHeader = doc.querySelector("h1, .forceHighlightsPanel, .slds-page-header");
    fallbackHeaderText = textOf(fallbackHeader);
    return firstCaseNumber(fallbackHeaderText);
  }

  function resolveActiveContainer(doc) {
    var pageUrl = String((global.location && global.location.href) || "");
    var activeTab = resolveActiveTab(doc);
    var candidates = collectPanelCandidates(doc);
    var chosen = null;
    var chosenScore = -1;
    var chosenDiag = null;
    var direct = directLinkedPanel(doc, activeTab);
    var i;
    var candidate;
    var scored;
    var diagList = [];
    var ctx = {
      pageUrl: pageUrl,
      pageTitle: String((doc && doc.title) || ""),
      routeCaseId: routeCaseId(pageUrl),
      activeTabLabelText: activeTab.labelText || "",
      activeTabCaseNumber: activeTab.caseNumber || "",
      activeTabId: activeTab.id || "",
      activeTabAriaControls: activeTab.ariaControls || "",
      selectedTabPanelId: "",
      visibleCaseNumberHint: ""
    };

    if (direct) {
      scored = scorePanel(direct, ctx, activeTab);
      chosen = direct;
      chosenScore = scored.score + 500;
      chosenDiag = {
        summary: elementSummary(direct),
        score: chosenScore,
        reasons: ["direct-linked-panel"].concat(scored.reasons),
        caseHintInPanel: scored.caseHintInPanel
      };
      ctx.selectedTabPanelId = direct.id || "";
    } else {
      for (i = 0; i < candidates.length; i += 1) {
        candidate = candidates[i];
        scored = scorePanel(candidate, ctx, activeTab);
        diagList.push({
          summary: scored.summary,
          score: scored.score,
          reasons: scored.reasons.slice(0),
          caseHintInPanel: scored.caseHintInPanel
        });
        if (scored.score > chosenScore) {
          chosen = candidate;
          chosenScore = scored.score;
          chosenDiag = {
            summary: scored.summary,
            score: scored.score,
            reasons: scored.reasons.slice(0),
            caseHintInPanel: scored.caseHintInPanel
          };
        }
      }
      if (chosen) {
        ctx.selectedTabPanelId = chosen.id || "";
      }
    }

    ctx.visibleCaseNumberHint = visibleCaseNumberHint(doc, activeTab, chosen);

    var belongsToActiveTab = !!(
      chosen &&
      (
        (activeTab.caseNumber && textOf(chosen).indexOf(activeTab.caseNumber) >= 0) ||
        (activeTab.id && chosen.getAttribute && chosen.getAttribute("aria-labelledby") === activeTab.id) ||
        (activeTab.ariaControls && chosen.id && activeTab.ariaControls === chosen.id)
      )
    );

    var minimumScore = activeTab.element ? 90 : 18;

    if (!chosen || chosenScore < minimumScore) {
      return {
        container: null,
        context: ctx,
        diagnostics: {
          candidateCount: candidates.length,
          activeTabFound: !!activeTab.element,
          activeTabScore: activeTab.score,
          activeTabLabelText: activeTab.labelText,
          activeTabCaseNumber: activeTab.caseNumber,
          activeTabId: activeTab.id,
          activeTabAriaControls: activeTab.ariaControls,
          chosenContainerSummary: chosenDiag ? chosenDiag.summary : "",
          chosenScore: chosenScore,
          chosenReasons: chosenDiag ? chosenDiag.reasons : [],
          chosenCaseHintInPanel: chosenDiag ? chosenDiag.caseHintInPanel : "",
          chosenBelongsToActiveTab: belongsToActiveTab,
          panelCandidates: diagList.slice(0, 12)
        }
      };
    }

    return {
      container: chosen,
      context: ctx,
      diagnostics: {
        candidateCount: candidates.length,
        activeTabFound: !!activeTab.element,
        activeTabScore: activeTab.score,
        activeTabLabelText: activeTab.labelText,
        activeTabCaseNumber: activeTab.caseNumber,
        activeTabId: activeTab.id,
        activeTabAriaControls: activeTab.ariaControls,
        chosenContainerSummary: chosenDiag ? chosenDiag.summary : elementSummary(chosen),
        chosenScore: chosenScore,
        chosenReasons: chosenDiag ? chosenDiag.reasons : [],
        chosenCaseHintInPanel: chosenDiag ? chosenDiag.caseHintInPanel : "",
        chosenBelongsToActiveTab: belongsToActiveTab,
        panelCandidates: diagList.slice(0, 12)
      }
    };
  }

  function buildBasePayload(container, metadata, split, ctx, diagnostics) {
    var containerText = textOf(container);
    var caseNumber =
      parser.extractFromMetadata(metadata, ["case number", "case"]) ||
      ((diagnostics && diagnostics.chosenBelongsToActiveTab && ctx.activeTabCaseNumber) ? ctx.activeTabCaseNumber : "") ||
      (typeof parser.extractCaseNumber === "function" ? parser.extractCaseNumber(container) : "") ||
      ctx.visibleCaseNumberHint ||
      "";
    var accountName = parser.extractFromMetadata(metadata, ["account name", "account"]);
    var contactName = parser.extractFromMetadata(metadata, ["contact name", "contact"]);
    var contactEmail =
      parser.extractFromMetadata(metadata, ["contact email", "email"]) ||
      firstEmailFromText(containerText);

    return {
      url: ctx.pageUrl,
      caseNumber: caseNumber,
      accountName: accountName,
      contactName: contactName,
      contactEmail: contactEmail,
      customerName: accountName || "",
      title: ctx.pageTitle,
      extractedAt: new Date().toISOString(),
      metadata: metadata,
      emailsSummary: split.emailsSummary || [],
      events: split.events || [],
      escalation: split.escalation || [],
      caseHistory: split.caseHistory || [],
      rawVisibleText: containerText,
      extractionContext: {
        pageUrl: ctx.pageUrl,
        pageTitle: ctx.pageTitle,
        routeCaseId: ctx.routeCaseId,
        visibleCaseNumberHint: ctx.visibleCaseNumberHint,
        activeTabLabelText: ctx.activeTabLabelText,
        activeTabCaseNumber: ctx.activeTabCaseNumber,
        activeTabId: ctx.activeTabId,
        activeTabAriaControls: ctx.activeTabAriaControls,
        selectedTabPanelId: ctx.selectedTabPanelId,
        candidateCount: diagnostics.candidateCount,
        activeTabFound: diagnostics.activeTabFound,
        activeTabScore: diagnostics.activeTabScore,
        chosenContainerSummary: diagnostics.chosenContainerSummary,
        chosenScore: diagnostics.chosenScore,
        chosenReasons: diagnostics.chosenReasons,
        chosenCaseHintInPanel: diagnostics.chosenCaseHintInPanel,
        chosenBelongsToActiveTab: diagnostics.chosenBelongsToActiveTab,
        panelCandidates: diagnostics.panelCandidates
      }
    };
  }

  function buildPayload() {
  var selected = resolveActiveContainer(global.document);
  var container = selected.container;
  var ctx = selected.context;
  var diagnostics = selected.diagnostics;
  var metadata;
  var events;
  var split;
  var basePayload;
  var enrichedPayload;

  if (!container) {
    throw new Error(
      "Unable to resolve the active Salesforce console case container with confidence. " +
      "Active tab: " + (ctx.activeTabLabelText || "(not found)") + ". " +
      "Chosen score: " + diagnostics.chosenScore + ". Extraction aborted."
    );
  }

  metadata = parser.extractRecordMetadata(container);
  events = parser.parseEventsFromText(container);
  split = parser.splitByType(events);

  var relatedListEmails =
    typeof parser.extractEmailRelatedListSummary === "function"
      ? parser.extractEmailRelatedListSummary(container)
      : [];

  if (relatedListEmails && relatedListEmails.length) {
    split.emailsSummary = relatedListEmails;
  }

  basePayload = buildBasePayload(container, metadata, split, ctx, diagnostics);
  enrichedPayload = (typeof parser.enrichPayload === "function")
    ? parser.enrichPayload(basePayload)
    : basePayload;

  enrichedPayload.extractionContext = basePayload.extractionContext;

  return {
    payload: enrichedPayload,
    aiText: parser.buildAiText(enrichedPayload),
    extractionContext: enrichedPayload.extractionContext,
    debug: enrichedPayload.extractionContext
  };
}

  global.CCurateGpcrmExtract = {
    isCaseRoute: function (url) { return ROUTE_RE.test(url); },
    waitForStableDom: function () { return Promise.resolve({ ok: true }); },
    buildPayload: buildPayload
  };
})(window);