(function initGpcrmParser(global) {
  "use strict";

  var norm = global.CaseCleanerNormalize;
  var cleanup = global.CaseCleanerGpcrmCleanup;
  var translate = global.CaseCleanerGpcrmTranslate;

  var EVENT_LABEL_RE = /\b(Email Message|Case Action|Case History|Escalation\s*-?\s*RFA)\b/gi;

  function classifyCard(article) {
    var text = norm.normalizeText(norm.textFromElement(article)).toLowerCase();
    if (!text) {
      return "unknown";
    }
    if (text.indexOf("emails (") === 0) {
      return "emails";
    }
    if (text.indexOf("activity history") === 0) {
      return "activityHistory";
    }
    if (text.indexOf("files (") === 0) {
      return "files";
    }
    if (text.indexOf("knowledge") === 0) {
      return "knowledge";
    }
    if (text.indexOf("product hierarchy") === 0) {
      return "productHierarchy";
    }
    return "other";
  }

  function parseDate(raw) {
    return norm.normalizeText(raw || "");
  }

  function parseEmailsSummaryRows(cardEl) {
    if (!cardEl) {
      return [];
    }

    var rows = cardEl.querySelectorAll("tr, li, article, div.slds-media, div.slds-hint-parent");
    var out = [];

    function extractByLabel(rowText, label) {
      var re = new RegExp(label + "\\s*:\\s*([^\\n|]+)", "i");
      var match = rowText.match(re);
      return match ? norm.normalizeText(match[1]) : "";
    }

    for (var i = 0; i < rows.length; i += 1) {
      var rowText = cleanup.normalizeTextHard(norm.textFromElement(rows[i]));
      if (!rowText || rowText.length < 8) {
        continue;
      }

      var subject = extractByLabel(rowText, "Subject") || norm.normalizeText(rowText.split("\n")[0] || "");
      var from = extractByLabel(rowText, "From");
      var to = extractByLabel(rowText, "To");
      var date = parseDate(extractByLabel(rowText, "Date") || extractByLabel(rowText, "Sent"));

      if (!subject && !from && !to && !date) {
        continue;
      }

      out.push({
        subject: subject,
        from: from,
        to: to,
        date: date
      });
    }

    var dedupeSeen = new Set();
    var unique = [];
    for (var j = 0; j < out.length; j += 1) {
      var key = [
        norm.normalizeForKey(out[j].subject),
        norm.normalizeForKey(out[j].from),
        norm.normalizeForKey(out[j].to),
        norm.normalizeForKey(out[j].date)
      ].join("|");
      if (dedupeSeen.has(key)) {
        continue;
      }
      dedupeSeen.add(key);
      unique.push(out[j]);
    }

    return unique;
  }

  function collectLabelMatches(text) {
    var matches = [];
    var match;
    EVENT_LABEL_RE.lastIndex = 0;
    while ((match = EVENT_LABEL_RE.exec(text)) !== null) {
      matches.push({
        label: norm.normalizeText(match[1]),
        index: match.index
      });
    }
    return matches;
  }

  function canonicalEventType(label) {
    var lowered = norm.normalizeForKey(label);
    if (lowered === "email message") {
      return "emailMessage";
    }
    if (lowered === "case action") {
      return "caseAction";
    }
    if (lowered === "case history") {
      return "caseHistory";
    }
    if (lowered === "escalation rfa" || lowered === "escalation-rfa") {
      return "escalationRfa";
    }
    return "event";
  }

  function inferActor(rawBlock) {
    var lines = norm.splitLines(rawBlock);
    for (var i = 0; i < lines.length; i += 1) {
      var line = norm.normalizeText(lines[i]);
      if (!line) {
        continue;
      }
      if (/^(Created By|By|From|Actor)\s*:/i.test(line)) {
        return norm.normalizeText(line.replace(/^[^:]+:\s*/i, ""));
      }
    }
    return "";
  }

  function inferTimestamp(rawBlock) {
    var lines = norm.splitLines(rawBlock);
    for (var i = 0; i < lines.length; i += 1) {
      var line = norm.normalizeText(lines[i]);
      if (!line) {
        continue;
      }
      if (/^(Date|Sent|Created Date|Last Modified Date|Time)\s*:/i.test(line)) {
        return norm.normalizeText(line.replace(/^[^:]+:\s*/i, ""));
      }
    }
    return "";
  }

  function parseEventsFromText(rawVisibleText) {
    var clean = cleanup.normalizeTextHard(rawVisibleText || "");
    if (!clean) {
      return [];
    }

    var markers = collectLabelMatches(clean);
    if (!markers.length) {
      return [];
    }

    var out = [];
    for (var i = 0; i < markers.length; i += 1) {
      var start = markers[i].index;
      var end = (i + 1 < markers.length) ? markers[i + 1].index : clean.length;
      var block = cleanup.normalizeTextHard(clean.slice(start, end));
      if (!block) {
        continue;
      }

      var eventType = canonicalEventType(markers[i].label);
      var dequoted = (eventType === "emailMessage")
        ? cleanup.stripQuotedEmailChain(block)
        : block;

      var t = translate.maybeTranslateToEnglish(dequoted);
      out.push({
        type: eventType,
        label: markers[i].label,
        actor: inferActor(block),
        timestamp: inferTimestamp(block),
        text: dequoted,
        originalText: t.originalText,
        translatedText: t.translatedText,
        spanishDetected: t.spanishDetected,
        translationAvailable: t.translationAvailable
      });
    }

    return out;
  }

  function splitByType(events) {
    var escalation = [];
    var caseHistory = [];
    var timeline = [];
    for (var i = 0; i < (events || []).length; i += 1) {
      var ev = events[i];
      timeline.push(ev);
      if (ev.type === "escalationRfa") {
        escalation.push(ev);
      }
      if (ev.type === "caseHistory") {
        caseHistory.push(ev);
      }
    }
    return {
      events: timeline,
      escalation: escalation,
      caseHistory: caseHistory
    };
  }

  // Generates an optimized System Prompt requesting Rovo / Copilot meta-prompts
  function buildAiText(payload) {
    var lines = [];

    lines.push("I am providing a structured JSON payload containing extracted data from a Salesforce support case.");
    lines.push("Case Number: " + (payload.caseNumber || "unknown") + " | " + (payload.title || ""));
    lines.push("URL: " + (payload.url || ""));
    lines.push("");
    lines.push("Please act as an expert Technical Support Escalation Engineer. I will attach the JSON file separately. Based on the data in the JSON, please generate a comprehensive case analysis following this exact structure:");
    lines.push("");
    lines.push("### 1. Case Summary");
    lines.push("Provide a concise executive summary of the issue, the customer's goal, and the current state of the case.");
    lines.push("");
    lines.push("### 2. Environment & Key Facts");
    lines.push("- **Software/Hardware Versions:** (Extract all exact versions mentioned)");
    lines.push("- **Exact Error Messages:** (Extract any error codes, logs, or fault messages verbatim)");
    lines.push("- **Triggers / Recent Changes:** (Identify when this started and what changed immediately prior)");
    lines.push("");
    lines.push("### 3. Chronological Timeline");
    lines.push("Create a clear, deduplicated timeline of events. Highlight how long the issue has been ongoing, what troubleshooting steps have already been taken, and the results of those steps.");
    lines.push("");
    lines.push("### 4. Research Prompts for Rovo / Copilot");
    lines.push("Generate TWO distinct, ready-to-paste prompts that I can feed into our internal AI search tools (like Atlassian Rovo or Copilot Researcher) which search our internal KBs, Jira tickets, and past emails. Follow these strict rules for generating the prompts:");
    lines.push("- **Assign a Persona:** Start each prompt with 'Act as an expert Support Escalation Engineer specializing in [insert primary hardware/software involved]...'");
    lines.push("- **Define the Task:** Tell the AI to 'Search the internal knowledge base, past tickets, and engineering notes to find...'");
    lines.push("- **Prompt 1 (Error-Focused):** Include the exact error messages, logs, or fault codes in quotes, combined with the specific software/hardware versions.");
    lines.push("- **Prompt 2 (Symptom-Focused):** Describe the exact behavior, failing component, and recent triggers without relying on the exact error code.");
    lines.push("- **Exclude Noise:** Ensure the generated prompts do NOT contain customer names, dates, case numbers, or PII.");
    lines.push("Format each of the two generated prompts inside `code blocks` for easy 1-click copying.");

    return lines.join("\n");
  }

  global.CaseCleanerGpcrmParser = {
    classifyCard: classifyCard,
    parseEmailsSummaryRows: parseEmailsSummaryRows,
    parseEventsFromText: parseEventsFromText,
    splitByType: splitByType,
    buildAiText: buildAiText
  };
})(window);