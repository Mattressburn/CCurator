(function initCCurateScanner(global) {
  "use strict";

  var utils = global.CCurateUtils;
  var fpApi = global.CCurateFingerprint;

  var EXTRACTOR_VERSION = "3.0.0";
  var EVENT_SELECTOR = [
    "article",
    "li",
    "section",
    "div[role='listitem']",
    "tr",
    "div"
  ].join(",");

  function isUiNode(el) {
    return !!(el && el.closest && el.closest("[data-case-cleaner-ui='1']"));
  }

  function isCandidateElement(el) {
    if (!el || !(el instanceof Element) || isUiNode(el)) {
      return false;
    }
    if (!utils.isElementVisible(el)) {
      return false;
    }
    var text = utils.normalizeWhitespace(utils.textFromElement(el));
    if (text.length < 40 || text.length > 65000) {
      return false;
    }
    var r = utils.rect(el);
    if (r.width < 180 || r.height < 18 || r.area < 3200) {
      return false;
    }
    return true;
  }

  function candidateScore(el) {
    var text = utils.textFromElement(el);
    var clean = utils.normalizeWhitespace(text);
    var lineCount = utils.splitLines(text).filter(function (line) {
      return utils.normalizeText(line).length > 0;
    }).length;
    var linkCount = (el.querySelectorAll && el.querySelectorAll("a").length) || 0;
    var imgCount = (el.querySelectorAll && el.querySelectorAll("img").length) || 0;
    var tableCount = (el.querySelectorAll && el.querySelectorAll("table,tr,td,th").length) || 0;
    var timeCount = (el.querySelectorAll && el.querySelectorAll("time,[datetime]").length) || 0;
    var r = utils.rect(el);
    var score = 0;
    if (clean.length >= 80) {
      score += 4;
    }
    if (clean.length >= 220) {
      score += 4;
    }
    if (lineCount >= 3) {
      score += 3;
    }
    if (linkCount >= 1) {
      score += 2;
    }
    if (tableCount >= 1) {
      score += 2;
    }
    if (timeCount >= 1) {
      score += 2;
    }
    if (imgCount >= 1) {
      score += 1;
    }
    if (r.area >= 18000) {
      score += 2;
    }
    if (r.area >= 90000) {
      score += 2;
    }
    return score;
  }

  function discoverEventBlocks(root) {
    var base = root || global.document;
    var all = utils.deepQueryAll(base, EVENT_SELECTOR).filter(isCandidateElement);

    all = all.filter(function (el) {
      return candidateScore(el) >= 8;
    });

    var parentCounts = new Map();
    for (var i = 0; i < all.length; i += 1) {
      var parent = all[i].parentElement;
      if (!parent) {
        continue;
      }
      parentCounts.set(parent, (parentCounts.get(parent) || 0) + 1);
    }

    var bestParent = null;
    var bestCount = 0;
    parentCounts.forEach(function (count, parent) {
      if (count > bestCount) {
        bestCount = count;
        bestParent = parent;
      }
    });

    var selected = all;
    if (bestParent && bestCount >= 3) {
      selected = all.filter(function (el) {
        return el.parentElement === bestParent;
      });
    }

    selected = utils.smallestElements(selected);
    selected.sort(compareDocumentOrder);
    return selected;
  }

  function compareDocumentOrder(a, b) {
    if (a === b) {
      return 0;
    }
    var pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
      return -1;
    }
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
      return 1;
    }
    return 0;
  }

  function extractTimestamp(el, text) {
    var timeNode = el.querySelector && el.querySelector("time[datetime],time,[datetime]");
    if (timeNode) {
      var raw = timeNode.getAttribute("datetime") || timeNode.textContent || "";
      var parsed = utils.parseDateFromText(raw);
      if (parsed) {
        return parsed;
      }
    }
    var titled = el.querySelector && el.querySelector("[title]");
    if (titled) {
      var titleParsed = utils.parseDateFromText(titled.getAttribute("title") || "");
      if (titleParsed) {
        return titleParsed;
      }
    }
    var topSlice = utils.splitLines(text).slice(0, 8).join(" ");
    return utils.parseDateFromText(topSlice);
  }

  function headerFieldMap(text) {
    var lines = utils.splitLines(text).slice(0, 40);
    var map = Object.create(null);
    for (var i = 0; i < lines.length; i += 1) {
      var line = utils.normalizeText(lines[i]);
      if (!line) {
        continue;
      }
      var match = line.match(/^([A-Za-z][A-Za-z0-9 _\-\/]{1,24}):\s*(.+)$/);
      if (!match) {
        continue;
      }
      var key = match[1].toLowerCase().replace(/\s+/g, " ");
      var value = match[2].trim();
      if (value) {
        map[key] = value;
      }
    }
    return map;
  }

  function inferEventType(el, headerMap, bodyRaw) {
    var text = utils.normalizeText(bodyRaw).toLowerCase();
    var emailScore = 0;
    var statusScore = 0;
    var noteScore = 0;
    var mailtoCount = (el.querySelectorAll && el.querySelectorAll("a[href^='mailto:']").length) || 0;
    var commentHintCount = (el.querySelectorAll && el.querySelectorAll("textarea,blockquote").length) || 0;

    if (mailtoCount >= 1) {
      emailScore += 2;
    }
    if (headerMap.from || headerMap.to || headerMap.cc || headerMap.subject) {
      emailScore += 3;
    }
    if ((headerMap.from && headerMap.to) || (headerMap.to && headerMap.subject)) {
      emailScore += 2;
    }
    if (/^(>|\|)/m.test(bodyRaw)) {
      emailScore += 1;
    }

    if (headerMap.status || headerMap.state || /\bstatus\b/.test(text)) {
      statusScore += 2;
    }
    if (/\bchanged\b|\bupdated\b|\bset to\b/.test(text)) {
      statusScore += 1;
    }

    if (commentHintCount >= 1) {
      noteScore += 1;
    }
    if (text.length > 400) {
      noteScore += 1;
    }

    if (emailScore >= statusScore && emailScore >= noteScore && emailScore >= 3) {
      return "email";
    }
    if (statusScore >= 2 && statusScore >= noteScore) {
      return "status-update";
    }
    if (noteScore >= 1) {
      return "comment";
    }
    return "unknown";
  }

  function normalizeBody(rawText) {
    var source = utils.stripInvisible(rawText || "");
    var lines = utils.splitLines(source).map(function (line) {
      return line.replace(/\s+$/g, "");
    });

    var cleaned = [];
    var quoteStart = -1;
    var quoteCount = 0;
    for (var i = 0; i < lines.length; i += 1) {
      var normalized = utils.normalizeText(lines[i]);
      if (/^[-_]{6,}$/.test(normalized)) {
        continue;
      }
      var isQuote = /^(>|\|)/.test(normalized) || /^On\s.+wrote:$/i.test(normalized) || /^From:\s/i.test(normalized);
      if (isQuote) {
        quoteCount += 1;
        if (quoteStart === -1) {
          quoteStart = cleaned.length;
        }
      }
      cleaned.push(lines[i]);
    }

    if (quoteCount >= 5 && quoteStart >= 0) {
      cleaned = cleaned.slice(0, quoteStart);
    }

    var trimmed = trimSignatureBlock(cleaned);
    var compact = utils.normalizeWhitespace(trimmed.join("\n"));
    return {
      bodyClean: compact,
      containsQuotedHistory: quoteCount >= 3,
      quoteLineCount: quoteCount
    };
  }

  function trimSignatureBlock(lines) {
    if (!lines || !lines.length) {
      return [];
    }
    var out = lines.slice();
    var fromIndex = -1;
    for (var i = Math.max(0, out.length - 14); i < out.length; i += 1) {
      var line = utils.normalizeText(out[i]);
      if (!line) {
        continue;
      }
      if (/^--$/.test(line) || /^thanks[,!]?$/i.test(line) || /^regards[,!]?$/i.test(line)) {
        fromIndex = i;
        break;
      }
      if ((line.match(/\bhttps?:\/\//g) || []).length >= 2 || (line.match(/@/g) || []).length >= 2) {
        fromIndex = i;
        break;
      }
    }
    if (fromIndex >= 0 && fromIndex >= Math.floor(out.length * 0.45)) {
      out = out.slice(0, fromIndex);
    }
    return out;
  }

  function extractEvent(block, sourceIndex) {
    var bodyRaw = utils.textFromElement(block);
    var headerMap = headerFieldMap(bodyRaw);
    var normalized = normalizeBody(bodyRaw);
    var bodyClean = normalized.bodyClean;
    var stamp = extractTimestamp(block, bodyRaw) || {
      timestampText: "",
      timestampSortable: "",
      confidence: 0
    };
    var fp = fpApi.buildFingerprint(block, bodyClean);
    var contentHashExact = utils.simpleHash(utils.normalizeText(bodyClean));
    var contentHashLoose = utils.simpleHash(utils.normalizeForLooseHash(bodyClean));
    var quotedChainHash = fpApi.quotedChainFingerprint(bodyRaw);
    var recipients = [];
    if (headerMap.to) {
      recipients.push(headerMap.to);
    }
    if (headerMap.cc) {
      recipients.push(headerMap.cc);
    }

    var imageCount = (block.querySelectorAll && block.querySelectorAll("img").length) || 0;
    var attachmentHint = !!(block.querySelector && block.querySelector("a[href*='attachment'],a[href*='download'],a[href$='.pdf'],a[href$='.log'],a[href$='.zip']"));

    var event = {
      id: "evt-" + (sourceIndex + 1) + "-" + utils.simpleHash(utils.getDomPathHint(block) + "#" + contentHashExact),
      sourceIndex: sourceIndex,
      domPathHint: utils.getDomPathHint(block),
      eventType: inferEventType(block, headerMap, bodyRaw),
      timestampText: stamp.timestampText || "",
      timestampSortable: stamp.timestampSortable || "",
      actor: headerMap.from || "",
      recipients: utils.dedupeArray(recipients),
      subject: headerMap.subject || "",
      bodyRaw: utils.normalizeWhitespace(bodyRaw),
      bodyClean: bodyClean,
      templateFingerprint: fp ? fp.structureHash : "",
      contentHashExact: contentHashExact,
      contentHashLoose: contentHashLoose,
      duplicateGroupId: "",
      duplicateType: "none",
      containsQuotedHistory: !!normalized.containsQuotedHistory,
      imageCount: imageCount,
      attachmentHint: attachmentHint,
      confidence: {
        extraction: round2(0.55 + Math.min(0.4, (bodyClean.length > 100 ? 0.15 : 0) + (stamp.confidence || 0) * 0.3 + (fp ? 0.1 : 0))),
        type: round2(0.45 + (headerMap.from || headerMap.to ? 0.25 : 0) + (/^(>|\|)/m.test(bodyRaw) ? 0.1 : 0)),
        timestamp: round2(stamp.confidence || 0)
      },
      _quotedChainHash: quotedChainHash,
      _fingerprint: fp,
      _element: block
    };

    return event;
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function dedupeEvents(events) {
    var exactMap = new Map();
    var looseMap = new Map();
    var groupCounter = 1;

    for (var i = 0; i < events.length; i += 1) {
      var event = events[i];
      var groupId = "dg-" + groupCounter;
      var duplicateType = "none";

      if (exactMap.has(event.contentHashExact)) {
        groupId = exactMap.get(event.contentHashExact);
        duplicateType = "exact";
      } else if (looseMap.has(event.contentHashLoose)) {
        var possible = looseMap.get(event.contentHashLoose);
        var representative = possible.representative;
        var textSim = fpApi.looseTextSimilarity(event.bodyClean, representative.bodyClean);
        var shapeSim = fpApi.similarityScore(event._fingerprint, representative._fingerprint);
        if (textSim >= 0.84 || (textSim >= 0.72 && shapeSim >= 54)) {
          groupId = possible.groupId;
          duplicateType = "near";
        }
      }

      if (duplicateType === "none" && event.containsQuotedHistory && event._quotedChainHash) {
        for (var j = 0; j < i; j += 1) {
          var prev = events[j];
          if (prev._quotedChainHash && prev._quotedChainHash === event._quotedChainHash) {
            groupId = prev.duplicateGroupId || "dg-" + groupCounter;
            duplicateType = "quoted-chain";
            break;
          }
        }
      }

      if (duplicateType === "none") {
        groupCounter += 1;
      }

      event.duplicateGroupId = groupId;
      event.duplicateType = duplicateType;

      if (!exactMap.has(event.contentHashExact)) {
        exactMap.set(event.contentHashExact, groupId);
      }
      if (!looseMap.has(event.contentHashLoose) || chooseRepresentative(event, looseMap.get(event.contentHashLoose).representative) === event) {
        looseMap.set(event.contentHashLoose, {
          groupId: groupId,
          representative: event
        });
      }
    }
  }

  function chooseRepresentative(a, b) {
    if (!b) {
      return a;
    }
    var aScore = representativeScore(a);
    var bScore = representativeScore(b);
    return aScore >= bScore ? a : b;
  }

  function representativeScore(e) {
    var score = 0;
    score += Math.min(6000, (e.bodyClean || "").length);
    if (e.timestampSortable) {
      score += 240;
    }
    if (e.subject) {
      score += 100;
    }
    if (e.actor) {
      score += 60;
    }
    if (e.duplicateType === "none") {
      score += 80;
    }
    return score;
  }

  function buildCanonicalTimeline(events) {
    var groups = new Map();
    for (var i = 0; i < events.length; i += 1) {
      var event = events[i];
      var groupId = event.duplicateGroupId || ("dg-fallback-" + i);
      if (!groups.has(groupId)) {
        groups.set(groupId, []);
      }
      groups.get(groupId).push(event);
    }

    var canonical = [];
    groups.forEach(function (list, groupId) {
      var representative = list[0];
      for (var i = 1; i < list.length; i += 1) {
        representative = chooseRepresentative(list[i], representative);
      }

      var timestampCandidates = list.map(function (e) {
        return e.timestampSortable;
      }).filter(Boolean);
      var earliest = timestampCandidates.slice().sort()[0] || representative.timestampSortable || "";

      canonical.push({
        id: representative.id,
        duplicateGroupId: groupId,
        dedupeCount: list.length,
        duplicateTypes: utils.dedupeArray(list.map(function (e) { return e.duplicateType; })),
        eventType: representative.eventType,
        timestampText: representative.timestampText,
        timestampSortable: representative.timestampSortable,
        actor: representative.actor,
        recipients: representative.recipients,
        subject: representative.subject,
        bodyClean: representative.bodyClean,
        bodyRaw: representative.bodyRaw,
        sourceIndex: representative.sourceIndex,
        sourceIndices: list.map(function (e) { return e.sourceIndex; }).sort(function (a, b) { return a - b; }),
        ordering: {
          earliestTimestampInGroup: earliest,
          domOrderFallback: representative.sourceIndex,
          uncertain: !representative.timestampSortable
        },
        containsQuotedHistory: representative.containsQuotedHistory,
        imageCount: representative.imageCount,
        attachmentHint: representative.attachmentHint,
        confidence: representative.confidence,
        domPathHint: representative.domPathHint
      });
    });

    canonical.sort(function (a, b) {
      if (a.timestampSortable && b.timestampSortable) {
        if (a.timestampSortable < b.timestampSortable) {
          return -1;
        }
        if (a.timestampSortable > b.timestampSortable) {
          return 1;
        }
      }
      if (a.timestampSortable && !b.timestampSortable) {
        return -1;
      }
      if (!a.timestampSortable && b.timestampSortable) {
        return 1;
      }
      return a.sourceIndex - b.sourceIndex;
    });

    return canonical;
  }

  function deriveFacts(canonical) {
    var symptomCandidates = [];
    var actionsAttempted = [];
    var envClues = [];
    var blockers = [];
    var unknowns = [];

    for (var i = 0; i < canonical.length; i += 1) {
      var body = canonical[i].bodyClean || "";
      var lines = utils.splitLines(body);
      for (var j = 0; j < lines.length; j += 1) {
        var line = utils.normalizeText(lines[j]);
        if (!line || line.length < 10 || line.length > 220) {
          continue;
        }
        var lower = line.toLowerCase();
        if (/\berror\b|\bfail\b|\bexception\b|\btimeout\b|\bissue\b/.test(lower)) {
          symptomCandidates.push(line);
        }
        if (/\btried\b|\brestart\b|\bcleared\b|\breset\b|\bupgraded\b|\breinstall\b|\bconfigured\b/.test(lower)) {
          actionsAttempted.push(line);
        }
        if (/\bv?\d+\.\d+(?:\.\d+)?\b/.test(lower) || /\bwindows\b|\blinux\b|\bmac\b|\bapi\b|\bssl\b|\btls\b/.test(lower)) {
          envClues.push(line);
        }
        if (/\bblocked\b|\bwaiting\b|\bcannot\b|\bunable\b/.test(lower)) {
          blockers.push(line);
        }
        if (/\?$/.test(line) || /^need\b|^confirm\b|^unknown\b/i.test(line)) {
          unknowns.push(line);
        }
      }
    }

    return {
      symptomCandidates: utils.dedupeArray(symptomCandidates).slice(0, 25),
      actionsAttempted: utils.dedupeArray(actionsAttempted).slice(0, 25),
      environmentProductVersionClues: utils.dedupeArray(envClues).slice(0, 25),
      blockers: utils.dedupeArray(blockers).slice(0, 20),
      unknowns: utils.dedupeArray(unknowns).slice(0, 20)
    };
  }

  function detectCaseMeta() {
    var url = String(global.location && global.location.href ? global.location.href : "");
    var title = utils.normalizeText(global.document.title || "");
    var bodyText = utils.normalizeText(utils.textFromElement(global.document.body).slice(0, 1200));
    var numberMatch = bodyText.match(/\b(\d{5,10})\b/);
    return {
      pageUrl: url,
      caseNumber: numberMatch ? numberMatch[1] : "",
      caseTitle: title,
      scrapedAt: new Date().toISOString(),
      extractorVersion: EXTRACTOR_VERSION
    };
  }

  function timelineToMarkdown(payload) {
    var lines = [];
    lines.push("# Case Timeline Digest");
    lines.push("");
    lines.push("- Case: " + (payload.caseMeta.caseNumber || "Unknown"));
    lines.push("- Title: " + (payload.caseMeta.caseTitle || "Unknown"));
    lines.push("- Scraped At: " + payload.caseMeta.scrapedAt);
    lines.push("- Events Extracted: " + payload.rawEvents.length);
    lines.push("- Canonical Events: " + payload.canonicalTimeline.length);
    lines.push("");
    lines.push("## Canonical Timeline");
    lines.push("");

    for (var i = 0; i < payload.canonicalTimeline.length; i += 1) {
      var e = payload.canonicalTimeline[i];
      lines.push((i + 1) + ". [" + (e.timestampText || "No timestamp") + "] " + e.eventType + " (group " + e.duplicateGroupId + ", copies " + e.dedupeCount + ")");
      lines.push("Actor: " + (e.actor || "Unknown") + " | Subject: " + (e.subject || "n/a"));
      lines.push(e.bodyClean.slice(0, 700));
      lines.push("");
    }

    lines.push("## Derived Facts");
    lines.push("");
    lines.push("### Symptom Candidates");
    lines.push((payload.derivedFacts.symptomCandidates || []).map(function (x) { return "- " + x; }).join("\n") || "- None detected");
    lines.push("");
    lines.push("### Actions Attempted");
    lines.push((payload.derivedFacts.actionsAttempted || []).map(function (x) { return "- " + x; }).join("\n") || "- None detected");
    lines.push("");
    lines.push("### Blockers / Unknowns");
    lines.push((payload.derivedFacts.blockers || []).map(function (x) { return "- " + x; }).join("\n") || "- None detected");
    lines.push((payload.derivedFacts.unknowns || []).map(function (x) { return "- " + x; }).join("\n") || "- None detected");
    return lines.join("\n");
  }

  function buildNotesPrompt(payload) {
    return [
      "You are writing internal support case notes from structured Salesforce case activity data.",
      "Use explicit evidence first and clearly separate inference from evidence.",
      "",
      "Required output sections:",
      "1) Concise internal case summary",
      "2) What happened (chronological)",
      "3) What has already been tried",
      "4) Likely L1 actions completed (with evidence/inference tags)",
      "5) Likely L2 actions completed (with evidence/inference tags)",
      "6) Customer impact and current state",
      "7) Missing information and contradictions",
      "8) Recommended next diagnostic steps",
      "",
      "Rules:",
      "- Do not repeat duplicate content.",
      "- If timeline order is uncertain, call it out.",
      "- Use short bullets.",
      "",
      "Structured case payload:",
      JSON.stringify(payload, null, 2)
    ].join("\n");
  }

  function buildResearchPrompt(payload) {
    return [
      "You are a support researcher searching internal docs, KBs, and similar historical cases.",
      "Prioritize likely known issues, install/config pitfalls, integration failures, log indicators, certificate/network constraints, and version dependencies.",
      "",
      "Return:",
      "1) Best matching references (title/id/link if available)",
      "2) Why each reference matches this case",
      "3) Confidence score (high/medium/low)",
      "4) Gaps where more data is needed",
      "5) Suggested next data to collect",
      "",
      "Extracted clues:",
      JSON.stringify({
        caseMeta: payload.caseMeta,
        symptoms: payload.derivedFacts.symptomCandidates,
        attemptedActions: payload.derivedFacts.actionsAttempted,
        environmentClues: payload.derivedFacts.environmentProductVersionClues,
        blockers: payload.derivedFacts.blockers,
        unknowns: payload.derivedFacts.unknowns,
        canonicalTimeline: payload.canonicalTimeline
      }, null, 2)
    ].join("\n");
  }

  function buildLlmInput(payload) {
    return {
      synopsisSeed: (payload.canonicalTimeline[0] && payload.canonicalTimeline[0].bodyClean.slice(0, 240)) || "",
      dedupedChronology: payload.canonicalTimeline.map(function (e) {
        return {
          timestamp: e.timestampSortable || e.timestampText || "",
          eventType: e.eventType,
          actor: e.actor,
          subject: e.subject,
          summary: (e.bodyClean || "").slice(0, 320),
          uncertainOrder: !!(e.ordering && e.ordering.uncertain)
        };
      }),
      knownSymptoms: payload.derivedFacts.symptomCandidates,
      attemptedFixes: payload.derivedFacts.actionsAttempted,
      unresolvedQuestions: payload.derivedFacts.unknowns
    };
  }

  function scanCase(root) {
    var blocks = discoverEventBlocks(root || global.document);
    var rawEvents = [];
    for (var i = 0; i < blocks.length; i += 1) {
      rawEvents.push(extractEvent(blocks[i], i));
    }

    dedupeEvents(rawEvents);
    var canonicalTimeline = buildCanonicalTimeline(rawEvents);
    var payload = {
      caseMeta: detectCaseMeta(),
      rawEvents: rawEvents.map(stripInternals),
      canonicalTimeline: canonicalTimeline,
      derivedFacts: deriveFacts(canonicalTimeline),
      llmInput: null,
      markdownDigest: "",
      notesPrompt: "",
      researchPrompt: "",
      stats: {
        discoveredBlocks: blocks.length,
        extractedEvents: rawEvents.length,
        canonicalEvents: canonicalTimeline.length,
        dedupedEvents: rawEvents.length - canonicalTimeline.length
      },
      _elementsByEventId: buildElementMap(rawEvents)
    };

    payload.llmInput = buildLlmInput(payload);
    payload.markdownDigest = timelineToMarkdown(payload);
    payload.notesPrompt = buildNotesPrompt(payload);
    payload.researchPrompt = buildResearchPrompt(payload);
    return payload;
  }

  function buildElementMap(events) {
    var map = {};
    for (var i = 0; i < events.length; i += 1) {
      map[events[i].id] = events[i]._element || null;
    }
    return map;
  }

  function stripInternals(event) {
    var clone = {};
    var keys = Object.keys(event);
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      if (key.indexOf("_") === 0) {
        continue;
      }
      clone[key] = event[key];
    }
    return clone;
  }

  global.CCurateScanner = {
    EXTRACTOR_VERSION: EXTRACTOR_VERSION,
    discoverEventBlocks: discoverEventBlocks,
    extractEvent: extractEvent,
    scanCase: scanCase,
    buildNotesPrompt: buildNotesPrompt,
    buildResearchPrompt: buildResearchPrompt,
    timelineToMarkdown: timelineToMarkdown
  };
})(window);