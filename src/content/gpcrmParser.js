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

  function buildAiText(payload) {
  payload = payload || {};

  function safe(value, fallback) {
    if (value === null || value === undefined) return fallback || "";
    var s = String(value).trim();
    return s ? s : (fallback || "");
  }

  function oneLine(value, fallback) {
    return safe(value, fallback).replace(/\s+/g, " ").trim();
  }

  var caseNumber = oneLine(payload.caseNumber, "unknown");
  var title = oneLine(payload.title, "Untitled case");
  var url = safe(payload.url, "");
  var primaryProduct = oneLine(
    payload.primaryProduct || payload.product || payload.software || payload.hardware,
    "the primary product or component identified in the JSON"
  );

  var lines = [];

  lines.push("You are an expert Technical Support Escalation Engineer and AI research prompt writer.");
  lines.push("");
  lines.push("## Source of truth");
  lines.push("Use ONLY the attached JSON payload as the source of truth.");
  lines.push("Do NOT invent, assume, infer, or fill in missing technical details.");
  lines.push("If a detail is missing or unclear, write exactly: `Not stated in case data`.");
  lines.push("");
  lines.push("## Objective");
  lines.push("Analyze the attached Salesforce support case JSON and produce four outputs:");
  lines.push("1. A concise executive case summary");
  lines.push("2. A structured extraction of environment and key facts");
  lines.push("3. A deduplicated chronological timeline");
  lines.push("4. Two high-quality, ready-to-paste research prompts for internal AI tools such as Rovo or Copilot");
  lines.push("");
  lines.push("## Rules");
  lines.push("1. Preserve exact error messages, fault codes, journal lines, trace lines, version strings, firmware versions, build numbers, and log text verbatim when present.");
  lines.push("2. Separate confirmed facts from assumptions, theories, or open questions.");
  lines.push("3. Do NOT claim a root cause unless the case data explicitly supports it.");
  lines.push("4. Deduplicate repeated updates, but preserve contradictions and label them clearly.");
  lines.push("5. For repeated troubleshooting steps, keep the earliest mention of the step and the latest stated outcome.");
  lines.push("6. Exclude customer names, contact info, dates, case numbers, URLs, and any other PII from the generated research prompts.");
  lines.push("7. Do not include case-management filler language.");
  lines.push("8. Be concise, technical, and specific.");
  lines.push("");
  lines.push("## Output format");
  lines.push("Return the response in EXACT markdown using the following structure and headings only:");
  lines.push("");
  lines.push("### 1. Case Summary");
  lines.push("Provide a concise executive summary covering:");
  lines.push("- the issue");
  lines.push("- the customer goal");
  lines.push("- the current case state");
  lines.push("- the highest-risk blockers or unknowns");
  lines.push("");
  lines.push("### 2. Environment & Key Facts");
  lines.push("Use the exact field labels below:");
  lines.push("- **Primary product/component:**");
  lines.push("- **Software/Hardware/Firmware versions:**");
  lines.push("- **Exact error messages / logs / fault codes:**");
  lines.push("- **Affected workflow or component:**");
  lines.push("- **Trigger / recent change:**");
  lines.push("- **What is working:**");
  lines.push("- **What is failing:**");
  lines.push("- **Troubleshooting already performed:**");
  lines.push("- **Open questions / missing data:**");
  lines.push("");
  lines.push("### 3. Chronological Timeline");
  lines.push("Create a deduplicated timeline in chronological order.");
  lines.push("For each entry include:");
  lines.push("- **Event / update:**");
  lines.push("- **Action taken:**");
  lines.push("- **Outcome / result:**");
  lines.push("- **State change:**");
  lines.push("");
  lines.push("### 4. Research Prompts for Rovo / Copilot");
  lines.push("Generate EXACTLY TWO distinct prompts inside separate fenced code blocks.");
  lines.push("");
  lines.push("#### Prompt 1: Error-Focused");
  lines.push("This prompt must:");
  lines.push("- Start with: `Act as an expert Support Escalation Engineer specializing in " + primaryProduct + ".`");
  lines.push("- Instruct the AI to search internal KBs, Jira tickets, engineering notes, past emails, release notes, and known defects.");
  lines.push("- Prioritize exact quoted error, log, and fault-code matches first.");
  lines.push("- Include exact product, component, version, build, and firmware details when available.");
  lines.push("- Ask for: top likely matches, why each match is relevant, known workaround, fixed-in version or patch if known, and confidence level.");
  lines.push("- Explicitly exclude customer names, dates, case numbers, URLs, and PII.");
  lines.push("");
  lines.push("#### Prompt 2: Symptom-Focused");
  lines.push("This prompt must:");
  lines.push("- Start with: `Act as an expert Support Escalation Engineer specializing in " + primaryProduct + ".`");
  lines.push("- Search for symptom-level matches even when no exact error match exists.");
  lines.push("- Include the failing behavior, affected component, trigger or recent change, and what is working vs failing.");
  lines.push("- Ask the AI to search for semantic matches, adjacent-version issues, regressions, architecture-specific defects, and workaround patterns.");
  lines.push("- Ask for: top candidate issues, supporting evidence, likely next validation steps, workaround, and fixed-in version if known.");
  lines.push("- Explicitly exclude customer names, dates, case numbers, URLs, and PII.");
  lines.push("");
  lines.push("## Case context");
  lines.push("Case Number: " + caseNumber);
  lines.push("Title: " + title);
  if (url) lines.push("URL: " + url);

  return lines.join("\\n");
}

  global.CaseCleanerGpcrmParser = {
    classifyCard: classifyCard,
    parseEmailsSummaryRows: parseEmailsSummaryRows,
    parseEventsFromText: parseEventsFromText,
    splitByType: splitByType,
    buildAiText: buildAiText
  };
})(window);