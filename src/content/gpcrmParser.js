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
    var lines = [];
    lines.push("Case " + (payload.caseNumber || "unknown") + " | " + (payload.title || ""));
    lines.push("URL: " + (payload.url || ""));
    lines.push("");

    if ((payload.emailsSummary || []).length) {
      lines.push("Emails Summary:");
      for (var e = 0; e < payload.emailsSummary.length; e += 1) {
        var em = payload.emailsSummary[e];
        lines.push("- Subject: " + (em.subject || ""));
        if (em.from) { lines.push("  From: " + em.from); }
        if (em.to) { lines.push("  To: " + em.to); }
        if (em.date) { lines.push("  Date: " + em.date); }
      }
      lines.push("");
    }

    lines.push("Timeline:");
    for (var i = 0; i < (payload.events || []).length; i += 1) {
      var ev = payload.events[i];
      lines.push("- [" + ev.label + "] " + (ev.timestamp || "") + " " + (ev.actor || ""));
      lines.push("  " + norm.normalizeWhitespace(ev.text || ""));
      if (ev.translatedText) {
        lines.push("  English: " + norm.normalizeWhitespace(ev.translatedText));
      } else if (ev.spanishDetected) {
        lines.push("  English: [translation unavailable in-browser]");
      }
    }

    return norm.normalizeWhitespace(lines.join("\n"));
  }

  global.CaseCleanerGpcrmParser = {
    classifyCard: classifyCard,
    parseEmailsSummaryRows: parseEmailsSummaryRows,
    parseEventsFromText: parseEventsFromText,
    splitByType: splitByType,
    buildAiText: buildAiText
  };
})(window);