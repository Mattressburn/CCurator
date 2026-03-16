(function initCCurateGpcrmParser(global) {
  "use strict";

  var norm = global.CCurateNormalize;
  var utils = global.CCurateUtils;
  var cleanup = global.CCurateGpcrmCleanup;

  var EVENT_LABEL_RE = /\b(Email Message|Case Action|Case History|Escalation\s*-?\s*RFA)\b/gi;

  function safeText(value) {
    return norm.normalizeText(String(value || ""));
  }

  function normalizeLabelKey(value) {
    return safeText(value).toLowerCase();
  }

  function classifyCard(article) {
    var text = norm.normalizeText(norm.textFromElement(article)).toLowerCase();
    if (text.indexOf("emails (") === 0) return "emails";
    if (text.indexOf("activity history") === 0) return "activityHistory";
    if (text.indexOf("files (") === 0) return "files";
    return "other";
  }

  function addMetadata(metadata, key, value) {
    var k = normalizeLabelKey(key);
    var v = safeText(value);
    if (!k || !v) {
      return;
    }
    if (!metadata[k]) {
      metadata[k] = v;
    }
  }

  function extractCompactHeaderMetadata(container, metadata) {
    var blocks;
    if (!container) return;
    blocks = utils.deepQueryAll(container, ".slds-page-header__detail-block");
    blocks.forEach(function (block) {
      var labelEl = block.querySelector(".slds-text-title");
      var valueEl = block.querySelector(".slds-grow");
      if (labelEl && valueEl) {
        addMetadata(metadata, labelEl.textContent, valueEl.textContent);
      }
    });
  }

  function splitInlineLabelValue(text) {
    var value = safeText(text);
    var match = value.match(/^([A-Za-z][A-Za-z0-9 \/&_#().-]{1,40})\s*:\s*(.+)$/);
    if (!match) {
      return null;
    }
    return {
      key: normalizeLabelKey(match[1]),
      value: safeText(match[2])
    };
  }

  function isLikelyMetadataKey(key) {
    return /^(case|case number|account|account name|contact|contact name|contact email|email|customer|customer name|site|site name|subject|status|priority|product|version|phone)$/.test(key);
  }

  function extractGenericLabeledMetadata(container, metadata) {
    var nodes;
    if (!container) return;

    nodes = utils.deepQueryAll(
      container,
      "div, span, p, li, dt, dd, label, a, lightning-formatted-text, lightning-formatted-email, lightning-output-field"
    );

    nodes.forEach(function (node) {
      var parsed = splitInlineLabelValue(norm.textFromElement(node));
      if (parsed && isLikelyMetadataKey(parsed.key)) {
        addMetadata(metadata, parsed.key, parsed.value);
      }
    });
  }

  function extractPageTextMetadata(container, metadata) {
    var raw = safeText(container && norm.textFromElement(container));
    var caseMatch;
    var contactEmailMatch;
    if (!raw) {
      return;
    }

    caseMatch = raw.match(/\bCase(?: Number|#)?\s*[:#-]?\s*(\d{5,10})\b/i);
    if (caseMatch) {
      addMetadata(metadata, "case number", caseMatch[1]);
    }

    contactEmailMatch = raw.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    if (contactEmailMatch) {
      addMetadata(metadata, "contact email", contactEmailMatch[0]);
    }
  }

  function extractRecordMetadata(container) {
    var metadata = {};
    if (!container) return metadata;

    extractCompactHeaderMetadata(container, metadata);
    extractGenericLabeledMetadata(container, metadata);
    extractPageTextMetadata(container, metadata);

    return metadata;
  }

  function extractCaseNumber(container) {
    var candidates = [];
    var title = safeText(global.document && global.document.title);
    var text;
    var headerEls;
    var i;
    var labeled;
    var bare;

    if (title) {
      candidates.push(title);
    }

    if (container) {
      text = safeText(norm.textFromElement(container));
      if (text) {
        candidates.push(text.slice(0, 4000));
      }

      headerEls = utils.deepQueryAll(
        container,
        "h1, h2, .slds-page-header, .forceHighlightsPanel, [role='tab'], article, section, div"
      );

      for (i = 0; i < headerEls.length; i += 1) {
        text = safeText(norm.textFromElement(headerEls[i]));
        if (text) {
          candidates.push(text.slice(0, 800));
        }
        if (candidates.length >= 40) {
          break;
        }
      }
    }

    for (i = 0; i < candidates.length; i += 1) {
      labeled = candidates[i].match(/\bCase(?: Number|#)?\s*[:#-]?\s*(\d{5,10})\b/i);
      if (labeled) {
        return labeled[1];
      }
    }

    for (i = 0; i < candidates.length; i += 1) {
      bare = candidates[i].match(/\b(\d{5,10})\b/);
      if (bare) {
        return bare[1];
      }
    }

    return "";
  }

  function extractFromMetadata(metadata, keys) {
    var i;
    for (i = 0; i < keys.length; i += 1) {
      if (metadata && metadata[keys[i]]) {
        return metadata[keys[i]];
      }
    }
    return "";
  }

  function inferActor(element, rawBlock) {
    var userLink = element.querySelector("a[data-refid='path-to-user'], .slds-media__body b");
    var lines;
    var i;
    var line;

    if (userLink) return norm.normalizeText(userLink.textContent);

    lines = norm.splitLines(rawBlock);
    for (i = 0; i < lines.length; i += 1) {
      line = norm.normalizeText(lines[i]);
      if (/^(Created By|By|From|Actor)\s*:/i.test(line)) {
        return norm.normalizeText(line.replace(/^[^:]+:\s*/i, ""));
      }
    }
    return "";
  }

  function inferTimestamp(element, rawBlock) {
    var timeEl = element.querySelector("time, .slds-text-body_small");
    var lines;
    var i;
    var line;

    if (timeEl) return norm.normalizeText(timeEl.textContent);

    lines = norm.splitLines(rawBlock);
    for (i = 0; i < lines.length; i += 1) {
      line = norm.normalizeText(lines[i]);
      if (/^(Date|Sent|Created Date|Time)\s*:/i.test(line)) {
        return norm.normalizeText(line.replace(/^[^:]+:\s*/i, ""));
      }
    }
    return "";
  }

  function inferEmailSummary(event) {
    var text = safeText(event && event.text);
    var fromMatch = text.match(/\bFrom\s*:\s*([^\n]+?)(?=\s+(?:To|Cc|Sent|Date|Subject)\s*:|$)/i);
    var toMatch = text.match(/\bTo\s*:\s*([^\n]+?)(?=\s+(?:Cc|Sent|Date|Subject)\s*:|$)/i);
    var subjectMatch = text.match(/\bSubject\s*:\s*([^\n]+?)(?=\s+(?:From|To|Cc|Sent|Date)\s*:|$)/i);
    var dateMatch = text.match(/\b(?:Sent|Date)\s*:\s*([^\n]+?)(?=\s+(?:From|To|Cc|Subject)\s*:|$)/i);

    return {
      subject: subjectMatch ? safeText(subjectMatch[1]) : "",
      from: fromMatch ? safeText(fromMatch[1]) : "",
      to: toMatch ? safeText(toMatch[1]) : "",
      date: dateMatch ? safeText(dateMatch[1]) : ""
    };
  }

  function parseEventsFromText(container) {
    var eventBlocks = utils.deepQueryAll(container, "article.slds-card, .slds-timeline__item");
    var out = [];

    eventBlocks.forEach(function (block) {
      var rawText = norm.textFromElement(block);
      var markers = rawText.match(EVENT_LABEL_RE);
      var typeLabel;
      var blockText;

      if (!markers) return;

      typeLabel = markers[0];
      blockText = cleanup.normalizeTextHard(rawText);

      out.push({
        type: typeLabel.replace(/\s+/g, ""),
        label: typeLabel,
        actor: inferActor(block, blockText),
        timestamp: inferTimestamp(block, blockText),
        text: blockText,
        originalText: blockText,
        translatedText: ""
      });
    });

    return out;
  }

  function splitByType(events) {
    var safeEvents = events || [];
    var emailsSummary = safeEvents
      .filter(function (e) { return /email/i.test(String(e.label || e.type || "")); })
      .map(inferEmailSummary)
      .filter(function (row) {
        return row.subject || row.from || row.to || row.date;
      });

    return {
      events: safeEvents,
      escalation: safeEvents.filter(function (e) { return String(e.type || "").toLowerCase().indexOf("escalation") >= 0; }),
      caseHistory: safeEvents.filter(function (e) { return String(e.type || "").toLowerCase().indexOf("history") >= 0; }),
      emailsSummary: emailsSummary
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
      "Analyze the Salesforce case JSON to produce:",
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

  global.CCurateGpcrmParser = {
    classifyCard: classifyCard,
    extractRecordMetadata: extractRecordMetadata,
    extractCaseNumber: extractCaseNumber,
    extractFromMetadata: extractFromMetadata,
    parseEventsFromText: parseEventsFromText,
    splitByType: splitByType,
    buildAiText: buildAiText
  };
})(window);