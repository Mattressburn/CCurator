(function initCCurateGpcrmParser(global) {
  "use strict";

  var norm = global.CCurateNormalize;
  var utils = global.CCurateUtils;
  var cleanup = global.CCurateGpcrmCleanup;

  var EVENT_LABEL_RE = /\b(Email Message|Case Action|Case History|Escalation\s*-?\s*RFA)\b/gi;

  function classifyCard(article) {
    var text = norm.normalizeText(norm.textFromElement(article)).toLowerCase();
    if (text.indexOf("emails (") === 0) return "emails";
    if (text.indexOf("activity history") === 0) return "activityHistory";
    if (text.indexOf("files (") === 0) return "files";
    return "other";
  }

  /**
   * Targets the Salesforce "Compact Header" to extract Account Name, Status, etc.
   */
  function extractRecordMetadata(container) {
    var metadata = {};
    if (!container) return metadata;

    var blocks = utils.deepQueryAll(container, ".slds-page-header__detail-block");

    blocks.forEach(function (block) {
      var labelEl = block.querySelector(".slds-text-title");
      var valueEl = block.querySelector(".slds-grow");

      if (labelEl && valueEl) {
        var key = norm.normalizeForKey(labelEl.textContent);
        var val = norm.normalizeText(valueEl.textContent);
        metadata[key] = val;
      }
    });
    return metadata;
  }

  /**
   * Reliable Actor Extraction: Pierces Shadow DOM to find LWC user links
   */
  function inferActor(element, rawBlock) {
    var userLink = element.querySelector("a[data-refid='path-to-user'], .slds-media__body b");
    if (userLink) return norm.normalizeText(userLink.textContent);

    var lines = norm.splitLines(rawBlock);
    for (var i = 0; i < lines.length; i += 1) {
      var line = norm.normalizeText(lines[i]);
      if (/^(Created By|By|From|Actor)\s*:/i.test(line)) {
        return norm.normalizeText(line.replace(/^[^:]+:\s*/i, ""));
      }
    }
    return "";
  }

  function inferTimestamp(element, rawBlock) {
    var timeEl = element.querySelector("time, .slds-text-body_small");
    if (timeEl) return norm.normalizeText(timeEl.textContent);

    var lines = norm.splitLines(rawBlock);
    for (var i = 0; i < lines.length; i += 1) {
      var line = norm.normalizeText(lines[i]);
      if (/^(Date|Sent|Created Date|Time)\s*:/i.test(line)) {
        return norm.normalizeText(line.replace(/^[^:]+:\s*/i, ""));
      }
    }
    return "";
  }

  function parseEventsFromText(container) {
    var eventBlocks = utils.deepQueryAll(container, "article.slds-card, .slds-timeline__item");
    var out = [];

    eventBlocks.forEach(function (block) {
      var rawText = norm.textFromElement(block);
      var markers = rawText.match(EVENT_LABEL_RE);
      if (!markers) return;

      var typeLabel = markers[0];
      var blockText = cleanup.normalizeTextHard(rawText);

      out.push({
        type: typeLabel.replace(/\s+/g, ""),
        label: typeLabel,
        actor: inferActor(block, blockText),
        timestamp: inferTimestamp(block, blockText),
        text: blockText
      });
    });

    return out;
  }

  function splitByType(events) {
    return {
      events: events || [],
      escalation: (events || []).filter(function (e) { return e.type.toLowerCase().indexOf('escalation') >= 0; }),
      caseHistory: (events || []).filter(function (e) { return e.type.toLowerCase().indexOf('history') >= 0; })
    };
  }

  function buildAiText(payload) {
    payload = payload || {};
    var caseNum = payload.caseNumber || "unknown";
    var primaryProduct = payload.primaryProduct || "CCURE 9000";

    var lines = [
      "You are an expert Technical Support Escalation Engineer and AI research prompt writer.",
      "",
      "## Source of Truth",
      "Use ONLY the attached JSON payload. Do NOT redact customer PII; it is critical for historical research.",
      "",
      "## Objective",
      "Analyze the Salesforce case JSON to produce: ",
      "1. Concise executive summary (including account impact)",
      "2. Environment & Key Facts (versions, error codes)",
      "3. Deduplicated timeline",
      "4. Two internal research prompts (Error-focused & Symptom-focused)",
      "",
      "## Internal Context",
      "Account: " + (payload.accountName || "Not stated"),
      "Contact: " + (payload.contactName || "Not stated"),
      "Case: " + caseNum + " | " + (payload.title || ""),
      "",
      "### 4. Research Prompts for Rovo / Copilot",
      "#### Prompt 1: Error-Focused",
      "```",
      "Act as an expert Support Escalation Engineer specializing in " + primaryProduct + ".",
      "Search internal cases and engineering notes for matches to the following data:",
      "Account: " + (payload.accountName || "Unknown"),
      "Error codes: [See JSON symptoms]",
      "```"
    ];

    return lines.join("\n");
  }

  // --- CRITICAL EXPORT OBJECT ---
  global.CCurateGpcrmParser = {
    classifyCard: classifyCard,
    extractRecordMetadata: extractRecordMetadata, // Added this line
    parseEventsFromText: parseEventsFromText,
    splitByType: splitByType,
    buildAiText: buildAiText
  };
})(window);