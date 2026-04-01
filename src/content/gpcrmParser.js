(function initCCurateGpcrmParser(global) {
  "use strict";

  var norm = global.CCurateNormalize;
  var utils = global.CCurateUtils;
  var cleanup = global.CCurateGpcrmCleanup;

  var EVENT_LABEL_RE = /\b(Email Message|Case Action|Case History|Escalation\s*-?\s*RFA)\b/gi;

  var CASE_FIELD_LABELS = [
    "case number",
    "case",
    "account name",
    "account",
    "contact name",
    "contact",
    "contact email",
    "email",
    "customer name",
    "customer",
    "end user",
    "site name",
    "site",
    "customer site",
    "location",
    "integrator",
    "system integrator",
    "dealer",
    "reseller",
    "technician's name",
    "technician name",
    "phone (u.s.)",
    "phone",
    "region",
    "training certification number",
    "system serial number",
    "main product",
    "product",
    "version / service pack / critical update",
    "version/service pack/critical update",
    "version",
    "issue statement",
    "issue details",
    "subject",
    "status",
    "priority"
  ];

  var FIELD_ALIASES = [
    { key: "case number", aliases: ["case number", "case #", "case"] },
    { key: "account name", aliases: ["account name"] },
    { key: "account", aliases: ["account"] },
    { key: "contact name", aliases: ["contact name"] },
    { key: "contact email", aliases: ["contact email"] },
    { key: "customer name", aliases: ["customer name"] },
    { key: "customer", aliases: ["customer"] },
    { key: "end user", aliases: ["end user"] },
    { key: "site name", aliases: ["site name"] },
    { key: "site", aliases: ["site"] },
    { key: "customer site", aliases: ["customer site"] },
    { key: "integrator", aliases: ["integrator"] },
    { key: "system integrator", aliases: ["system integrator"] },
    { key: "dealer", aliases: ["dealer"] },
    { key: "reseller", aliases: ["reseller"] },
    { key: "technician's name", aliases: ["technician's name", "technician name"] },
    { key: "phone (u.s.)", aliases: ["phone (u.s.)"] },
    { key: "phone", aliases: ["phone"] },
    { key: "region", aliases: ["region"] },
    { key: "training certification number", aliases: ["training certification number"] },
    { key: "system serial number", aliases: ["system serial number"] },
    { key: "main product", aliases: ["main product"] },
    { key: "product", aliases: ["product"] },
    {
      key: "version / service pack / critical update",
      aliases: [
        "version / service pack / critical update",
        "version/service pack/critical update"
      ]
    },
    { key: "version", aliases: ["version"] },
    { key: "issue statement", aliases: ["issue statement"] },
    { key: "issue details", aliases: ["issue details"] },
    { key: "subject", aliases: ["subject"] },
    { key: "status", aliases: ["status"] },
    { key: "priority", aliases: ["priority"] }
  ];

  var FIELD_ALIAS_LOOKUP = buildFieldAliasLookup();
  var ORDERED_ALIASES = Object.keys(FIELD_ALIAS_LOOKUP).sort(function (a, b) {
    return b.length - a.length;
  });

  var INLINE_SPACE_REMAINDER_ALLOWED = {
    "integrator": true,
    "system integrator": true,
    "dealer": true,
    "reseller": true,
    "technician's name": true,
    "technician name": true,
    "phone (u.s.)": true,
    "region": true,
    "training certification number": true,
    "system serial number": true,
    "main product": true,
    "version / service pack / critical update": true,
    "version/service pack/critical update": true,
    "issue statement": true,
    "issue details": true,
    "subject": true,
    "contact email": true,
    "email": true,
    "end user": true,
    "customer site": true
};

  var UI_NOISE_PATTERNS = [
    /list view controls/i,
    /navigation mode/i,
    /show actions/i,
    /view all/i,
    /sorted:\s*none/i,
    /column actions/i,
    /select item/i,
    /choose a row/i,
    /\bfiltered by\b/i,
    /\brecommendations\b/i,
    /article details/i,
    /attach article/i,
    /show more actions/i,
    /\bpreview\b/i
  ];

  function buildFieldAliasLookup() {
    var map = {};
    var i;
    var j;
    var spec;
    var alias;
    for (i = 0; i < FIELD_ALIASES.length; i += 1) {
      spec = FIELD_ALIASES[i];
      for (j = 0; j < spec.aliases.length; j += 1) {
        alias = normalizeLabelKey(spec.aliases[j]);
        map[alias] = spec.key;
      }
    }
    return map;
  }

  function safeText(value) {
    return norm.normalizeText(String(value || ""));
  }

  function safeWhitespace(value) {
    return norm.normalizeWhitespace(String(value || ""));
  }

  function normalizeLabelKey(value) {
    return safeText(value).toLowerCase();
  }

  function uniquePush(arr, value) {
    var v = safeText(value);
    if (!v) {
      return;
    }
    if (arr.indexOf(v) < 0) {
      arr.push(v);
    }
  }

  function addMetadata(metadata, key, value) {
    var k = normalizeLabelKey(key);
    var v = cleanFinalValue(value);
    if (!k || !v) {
      return;
    }
    if (shouldRejectMetadataValue(k, v)) {
      return;
    }
    if (!metadata[k]) {
      metadata[k] = v;
    }
  }

function shouldRejectMetadataValue(key, value) {
  var v = safeWhitespace(value);
  var lower = v.toLowerCase();

  function looksLikePersonName(text) {
    return /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(text);
  }

  if (!v) {
    return true;
  }

  if (looksLikeUiNoise(v)) {
    return true;
  }

  if (key === "location") {
    if (/version\s*=\s*\d/i.test(v) || /publickeytoken=/i.test(v) || /\.server\./i.test(v)) {
      return true;
    }
  }

  if (key === "email" || key === "contact email") {
    if (!/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(v)) {
      return true;
    }
  }

  if (
    key === "account" ||
    key === "account name" ||
    key === "customer" ||
    key === "customer name" ||
    key === "site" ||
    key === "site name"
  ) {
    if (/windows account/i.test(v) || /article/i.test(lower) || /preview/i.test(lower)) {
      return true;
    }
  }

  if (key === "product") {
    if (/^hierarchy$/i.test(v)) {
      return true;
    }
    if (/\bsupport engineer\b/i.test(v) || /\bproduct support engineer\b/i.test(v)) {
      return true;
    }
    if (/\bsoftware house\b/i.test(v) && !/\bc[•.]?cure\b/i.test(v)) {
      return true;
    }
  }

  if (key === "priority") {
    if (!/^(low|normal|medium|high|critical|urgent|p1|p2|p3|p4)$/i.test(v)) {
      return true;
    }
  }

  if (key === "status") {
    if (
      looksLikePersonName(v) &&
      !/^(new|closed|open|triggered|solving|in progress|escalated \/ rfa|waiting for customer feedback|new email received|escalated to l3|standard)$/i.test(v)
    ) {
      return true;
    }
  }

  if (key === "phone") {
    if (/\b(incoming|outgoing)\b/i.test(v) || !looksLikePhone(v)) {
      return true;
    }
  }

  if (key === "phone (u.s.)") {
    if (!looksLikePhone(v)) {
      return true;
    }
  }

  return false;
}


  function classifyCard(article) {
    var text = norm.normalizeText(norm.textFromElement(article)).toLowerCase();
    if (text.indexOf("emails (") === 0) return "emails";
    if (text.indexOf("activity history") === 0) return "activityHistory";
    if (text.indexOf("files (") === 0) return "files";
    return "other";
  }

  function looksLikeUiNoise(value) {
    var v = safeWhitespace(value);
    var i;
    if (!v) {
      return true;
    }
    for (i = 0; i < UI_NOISE_PATTERNS.length; i += 1) {
      if (UI_NOISE_PATTERNS[i].test(v)) {
        return true;
      }
    }
    if (
      v.toLowerCase().indexOf("tabs details feed all activities related") >= 0 ||
      v.toLowerCase().indexOf("complaint clone change owner") >= 0 ||
      v.toLowerCase().indexOf("search knowledge") >= 0 ||
      v.toLowerCase().indexOf("global actions") >= 0
    ) {
      return true;
    }
    return false;
  }

  function splitLinesClean(text) {
    var lines = norm.splitLines(String(text || ""));
    var out = [];
    var i;
    var line;
    for (i = 0; i < lines.length; i += 1) {
      line = safeText(lines[i]);
      if (line) {
        out.push(line);
      }
    }
    return out;
  }

  function isKnownLabel(line) {
    var lower = normalizeLabelKey(line);
    if (!lower) {
      return false;
    }
    return !!FIELD_ALIAS_LOOKUP[lower];
  }

  function findCanonicalLabelFromLine(line) {
    var lower = normalizeLabelKey(line);
    var i;
    var alias;
    var colonPattern;
    var spacePattern;
    var canonical;
    var remainder;

    if (!lower) {
      return null;
    }

    if (FIELD_ALIAS_LOOKUP[lower]) {
      return {
        key: FIELD_ALIAS_LOOKUP[lower],
        alias: lower,
        remainder: ""
      };
    }

    for (i = 0; i < ORDERED_ALIASES.length; i += 1) {
      alias = ORDERED_ALIASES[i];
      canonical = FIELD_ALIAS_LOOKUP[alias];
      remainder = safeText(String(line || "").replace(/\u00a0/g, " "));

      colonPattern = new RegExp("^" + escapeRegex(alias) + "\\s*:\\s*(.+)$", "i");
      if (colonPattern.test(remainder)) {
        return {
          key: canonical,
          alias: alias,
          remainder: remainder.replace(colonPattern, "$1")
        };
      }

      if (INLINE_SPACE_REMAINDER_ALLOWED[canonical]) {
        spacePattern = new RegExp("^" + escapeRegex(alias) + "\\s+(.+)$", "i");
        if (spacePattern.test(remainder)) {
          return {
            key: canonical,
            alias: alias,
            remainder: remainder.replace(spacePattern, "$1")
          };
        }
      }
    }

    return null;
}

  function escapeRegex(str) {
    return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function parseTrustedKeyValuesFromText(text) {
    var lines = splitLinesClean(text);
    var metadata = {};
    var i = 0;
    var current;
    var next;
    var labelInfo;
    var collected;
    var j;

    while (i < lines.length) {
      current = lines[i];
      labelInfo = findCanonicalLabelFromLine(current);
      if (!labelInfo) {
        i += 1;
        continue;
      }

      if (labelInfo.remainder) {
        addMetadata(metadata, labelInfo.key, labelInfo.remainder);
        i += 1;
        continue;
      }

      if (labelInfo.key === "issue details") {
        collected = [];
        for (j = i + 1; j < lines.length; j += 1) {
          next = lines[j];
          if (!next) {
            continue;
          }
          if (isKnownLabel(next) || findCanonicalLabelFromLine(next) || EVENT_LABEL_RE.test(next)) {
            break;
          }
          if (looksLikeUiNoise(next)) {
            break;
          }
          collected.push(next);
        }
        addMetadata(metadata, labelInfo.key, collected.join(" "));
        i = j;
        continue;
      }

      next = nextMeaningfulLine(lines, i + 1);
      if (next && !isKnownLabel(next) && !looksLikeUiNoise(next) && !EVENT_LABEL_RE.test(next)) {
        addMetadata(metadata, labelInfo.key, next);
      }
      i += 1;
    }

    return metadata;
  }

  function nextMeaningfulLine(lines, startIndex) {
    var i;
    var line;
    for (i = startIndex; i < lines.length; i += 1) {
      line = safeText(lines[i]);
      if (line) {
        return line;
      }
    }
    return "";
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

  function extractTrustedMetadataFromContainer(container, metadata) {
    var selectors = [
      ".forceHighlightsPanel",
      ".slds-page-header",
      ".tabContent.active.oneConsoleTab",
      "article.slds-card",
      "section[role='tabpanel']",
      ".oneRecordActionWrapper",
      ".slds-card__body"
    ];
    var seen = [];
    var i;
    var list;
    var j;
    var node;
    var text;
    var parsed;
    var keys;
    var k;

    if (!container) {
      return;
    }

    for (i = 0; i < selectors.length; i += 1) {
      list = utils.deepQueryAll(container, selectors[i]);
      for (j = 0; j < list.length; j += 1) {
        node = list[j];
        if (seen.indexOf(node) >= 0) {
          continue;
        }
        seen.push(node);
        text = safeWhitespace(norm.textFromElement(node));
        if (!text || looksLikeUiNoise(text)) {
          continue;
        }
        parsed = parseTrustedKeyValuesFromText(text);
        keys = Object.keys(parsed);
        for (k = 0; k < keys.length; k += 1) {
          addMetadata(metadata, keys[k], parsed[keys[k]]);
        }
      }
    }

    parsed = parseTrustedKeyValuesFromText(safeWhitespace(norm.textFromElement(container)));
    keys = Object.keys(parsed);
    for (k = 0; k < keys.length; k += 1) {
      addMetadata(metadata, keys[k], parsed[keys[k]]);
    }
  }

  function extractPageTextMetadata(container, metadata) {
    var raw = safeWhitespace(container && norm.textFromElement(container));
    var caseMatch;
    var emailMatches;
    var i;
    if (!raw) {
      return;
    }
    caseMatch = raw.match(/\bCase(?: Number| #)?\s*[:#-]?\s*(\d{5,10})\b/i);
    if (caseMatch) {
      addMetadata(metadata, "case number", caseMatch[1]);
    }
    emailMatches = String(raw).match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || [];
    for (i = 0; i < emailMatches.length; i += 1) {
      if (!isSupportEmail(emailMatches[i])) {
        addMetadata(metadata, "contact email", emailMatches[i]);
        break;
      }
    }
  }

  function extractRecordMetadata(container) {
    var metadata = {};
    if (!container) return metadata;
    extractCompactHeaderMetadata(container, metadata);
    extractTrustedMetadataFromContainer(container, metadata);
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
        candidates.push(text.slice(0, 6000));
      }
      headerEls = utils.deepQueryAll(
        container,
        "h1, h2, .slds-page-header, .forceHighlightsPanel, [role='tab']"
      );
      for (i = 0; i < headerEls.length; i += 1) {
        text = safeText(norm.textFromElement(headerEls[i]));
        if (text) {
          candidates.push(text.slice(0, 1000));
        }
        if (candidates.length >= 40) {
          break;
        }
      }
    }
    for (i = 0; i < candidates.length; i += 1) {
      labeled = candidates[i].match(/\bCase(?: Number| #)?\s*[:#-]?\s*(\d{5,10})\b/i);
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
    var canonical;
    for (i = 0; i < keys.length; i += 1) {
      canonical = normalizeLabelKey(keys[i]);
      if (metadata && metadata[canonical]) {
        return metadata[canonical];
      }
    }
    return "";
  }

  function extractEmailRelatedListSummary(container) {
  var out = [];
  var seen = {};
  var cards;
  var i;
  var card;
  var header;
  var headerText;
  var body;
  var bodyText;
  var rowChunks;
  var r;
  var chunk;
  var match;

  if (!container || !utils || typeof utils.deepQueryAll !== "function") {
    return out;
  }

  cards = utils.deepQueryAll(
    container,
    ".container.forceRelatedListSingleContainer article.slds-card.slds-card_related-list-fix"
  );

  for (i = 0; i < cards.length; i += 1) {
    card = cards[i];
    header =
      card.querySelector(".forceRelatedListCardHeader") ||
      card.querySelector(".slds-page-header") ||
      card.querySelector("header");
    headerText = safeWhitespace(norm.textFromElement(header));

    if (!/^Emails\s*\(\d+\)$/i.test(headerText)) {
      continue;
    }

    body = card.querySelector("div:nth-of-type(2)") || card;
    bodyText = safeWhitespace(norm.textFromElement(body));

    if (!bodyText) {
      continue;
    }

    bodyText = bodyText.replace(/^Subject\s+From Address\s+To Address\s+Message Date\s+Action\s*/i, "");
    rowChunks = bodyText.split(/\bShow Actions\b/i).map(function (x) {
      return safeWhitespace(x);
    }).filter(Boolean);

    for (r = 0; r < rowChunks.length; r += 1) {
      chunk = rowChunks[r];

      match = chunk.match(/^(.*?)\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM))$/i);
      if (!match) {
        continue;
      }

      if (seen[match[1] + "\n" + match[2] + "\n" + match[3] + "\n" + match[4]]) {
        continue;
      }
      seen[match[1] + "\n" + match[2] + "\n" + match[3] + "\n" + match[4]] = true;

      out.push({
        subject: cleanFinalValue(match[1]),
        from: cleanFinalValue(match[2]),
        to: cleanFinalValue(match[3]),
        date: cleanFinalValue(match[4])
      });
    }
  }

  return out;
}

  function findValueAfterLabels(rawBlock, labels) {
    var lines = splitLinesClean(rawBlock);
    var i;
    var current;
    var lower;
    var j;
    var label;
    var value;
    var inlinePattern;

    for (i = 0; i < lines.length; i += 1) {
      current = lines[i];
      lower = normalizeLabelKey(current);
      for (j = 0; j < labels.length; j += 1) {
        label = normalizeLabelKey(labels[j]);
        inlinePattern = new RegExp("^" + escapeRegex(label) + "\\s*:\\s*(.+)$", "i");
        if (inlinePattern.test(current)) {
          value = safeText(current.replace(inlinePattern, "$1"));
          if (value && normalizeLabelKey(value) !== label) {
            return value;
          }
        }
        if (lower === label) {
          value = nextMeaningfulLine(lines, i + 1);
          if (value && !isKnownLabel(value)) {
            return value;
          }
        }
      }
    }
    return "";
  }

  function firstDateLike(text) {
  var source = String(text || "");
  var patterns = [
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/i,
    /\b\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)\b/i,
    /\b\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}\s*(?:AM|PM)\b/i,
    /\b\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\b/i,
    /\b\d{1,2}\/\d{1,2}\/\d{4}\b/i
  ];
  var i;
  var match;

  for (i = 0; i < patterns.length; i += 1) {
    match = source.match(patterns[i]);
    if (match) {
      return safeText(match[0]);
    }
  }
  return "";
}

  function inferActor(element, rawBlock) {
    var userLink = element.querySelector("a[data-refid='path-to-user'], .slds-media__body b");
    var actor;
    if (userLink) {
      actor = safeText(userLink.textContent);
      if (actor && !looksLikeUiNoise(actor)) {
        return actor;
      }
    }
    actor = findValueAfterLabels(rawBlock, ["Created By", "By", "From", "Actor", "Name of Agent"]);
    if (actor && !looksLikeUiNoise(actor)) {
      return actor;
    }
    return "";
  }

  function inferTimestamp(element, rawBlock) {
    var timeEl = element.querySelector("time[datetime], time, .slds-text-body_small");
    var ts;
    if (timeEl) {
      ts = safeText(timeEl.getAttribute("datetime") || timeEl.textContent);
      ts = firstDateLike(ts) || ts;
      if (ts && !looksLikeUiNoise(ts)) {
        return ts;
      }
    }
    ts = findValueAfterLabels(rawBlock, ["Created Date", "Date", "Sent", "Time", "Start Time", "Action Time", "End Time"]);
    if (ts) {
      ts = firstDateLike(ts) || ts;
      if (ts && !looksLikeUiNoise(ts)) {
        return ts;
      }
    }
    return firstDateLike(rawBlock);
  }

  function extractSubjectLineFromEmailEvent(text) {
    var subject = findValueAfterLabels(text, ["Subject"]);
    var lines;
    var i;
    var line;

    if (subject) {
      return subject;
    }

    lines = splitLinesClean(text);
    for (i = 0; i < lines.length && i < 12; i += 1) {
      line = lines[i];
      if (
        /^email message$/i.test(line) ||
        /^outgoing$/i.test(line) ||
        /^incoming$/i.test(line) ||
        /^dear valued customer$/i.test(line) ||
        /^thank you for contacting johnson controls$/i.test(line) ||
        /^adminrun jobs$/i.test(line) ||
        looksLikeUiNoise(line) ||
        firstDateLike(line)
      ) {
        continue;
      }
      if (line.length >= 4 && line.length <= 180) {
        return line;
      }
    }

    return "";
  }

  function inferEmailSummary(event) {
  var text = safeWhitespace(event && event.text);
  var subject = extractSubjectLineFromEmailEvent(text);
  var from = findValueAfterLabels(text, ["From"]);
  var to = findValueAfterLabels(text, ["To"]);
  var date = findValueAfterLabels(text, ["Sent", "Date"]) || safeText(event && event.timestamp);

  if (subject && /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/i.test(subject)) {
    subject = "";
  }
  if (subject && /^\d{1,2}\/\d{1,2}\/\d{4}(?:,\s*\d{1,2}:\d{2}\s*(?:AM|PM))?$/i.test(subject)) {
    subject = "";
  }

  if (from && !/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(from)) {
    from = "";
  }
  if (to && !/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(to)) {
    to = "";
  }

  return {
    subject: cleanFinalValue(subject),
    from: cleanFinalValue(from),
    to: cleanFinalValue(to),
    date: cleanFinalValue(date)
  };
}

  function cleanEmailSubject(value) {
  var v = cleanFinalValue(value);
  if (!v) {
    return "";
  }
  if (/^show actions$/i.test(v) || /^view all$/i.test(v)) {
    return "";
  }
  return v;
}

function extractEmailsSection(rawVisibleText) {
  var source = safeWhitespace(rawVisibleText);
  var start;
  var tail;
  var endMarkers;
  var end = source.length;
  var i;
  var idx;

  if (!source) {
    return "";
  }

  start = source.search(/\bEmails\s*\(\d+\)\b/i);
  if (start < 0) {
    return "";
  }

  tail = source.slice(start);
  endMarkers = [
    /\bEscalations-RFAs\b/i,
    /\bFiles\s*\(\d+\)\b/i,
    /\bStandard Knowledge Articles\b/i,
    /\bCase History\s*\(\d+/i,
    /\bKnowledge\b/i,
    /\bSuggested Articles\b/i,
    /\bActivity History\b/i,
    /\bRelated Cases\b/i
  ];

  for (i = 0; i < endMarkers.length; i += 1) {
    idx = tail.search(endMarkers[i]);
    if (idx >= 0 && idx < end) {
      end = idx;
    }
  }

  tail = tail.slice(0, end);
  tail = tail.replace(/\bEmails\s*\(\d+\)\b/i, "");
  tail = tail.replace(/\bSubject\s+From Address\s+To Address\s+Message Date\s+Action\b/i, "");
  return safeWhitespace(tail);
}

function parseEmailsFromRelatedList(rawVisibleText) {
  var section = extractEmailsSection(rawVisibleText);
  var rowRe;
  var rows = [];
  var match;
  var subject;
  var from;
  var to;
  var date;
  var dedupe = {};

  if (!section) {
    return rows;
  }

  rowRe = /(.*?)\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM))\s+Show Actions\b/ig;

  while ((match = rowRe.exec(section))) {
    subject = cleanEmailSubject(match[1]);
    from = cleanFinalValue(match[2]);
    to = cleanFinalValue(match[3]);
    date = cleanFinalValue(match[4]);

    if (!subject || !from || !to || !date) {
      continue;
    }

    if (dedupe[subject + "\n" + from + "\n" + to + "\n" + date]) {
      continue;
    }
    dedupe[subject + "\n" + from + "\n" + to + "\n" + date] = true;

    rows.push({
      subject: subject,
      from: from,
      to: to,
      date: date
    });
  }

  return rows;
}

  function looksLikeListSummary(text) {
    var t = safeWhitespace(text);
    if (!t) {
      return true;
    }
    if (/^(Case Actions|Escalations-RFAs|Case History|Emails|Files|Activity History)\s*\(\d+/i.test(t)) {
      return true;
    }
    if (/\bList View Controls\b/i.test(t) || /\bNavigation Mode\b/i.test(t) || /\bView All\b/i.test(t)) {
      return true;
    }
    if (/\bSorted:\s*None\b/i.test(t) || /\bcolumn actions\b/i.test(t) || /\bSelect Item\b/i.test(t)) {
      return true;
    }
    return false;
  }

  function isUsefulEvent(event) {
    var text = safeWhitespace(event && event.text);
    if (!text) {
      return false;
    }
    if (/^(Case History|Email Message|Case Action|Escalation RFA|Escalation-RFA)$/i.test(text)) {
      return false;
    }
    if (looksLikeUiNoise(text) || looksLikeListSummary(text)) {
      return false;
    }
    return text.length > 25;
  }

  function normalizeEventType(label) {
    var compact = safeText(label).replace(/\s+/g, "");
    if (/^Escalation-?RFA$/i.test(compact)) {
      return "EscalationRFA";
    }
    return compact;
  }

  function parseEventsFromText(container) {
    var eventBlocks;
    var out = [];
    var seenHashes = {};
    var i;
    var block;
    var rawText;
    var blockText;
    var labelMatch;
    var label;
    var actor;
    var timestamp;
    var hash;
    if (!container) {
      return out;
    }

    eventBlocks = utils.deepQueryAll(container, "article.slds-card, .slds-timeline__item");

    for (i = 0; i < eventBlocks.length; i += 1) {
      block = eventBlocks[i];
      rawText = norm.textFromElement(block);
      blockText = cleanup.normalizeTextHard(rawText);
      if (!blockText) {
        continue;
      }
      if (looksLikeListSummary(blockText) || looksLikeUiNoise(blockText)) {
        continue;
      }
      labelMatch = blockText.match(EVENT_LABEL_RE);
      if (!labelMatch || !labelMatch[0]) {
        continue;
      }
      label = safeText(labelMatch[0]);
      actor = inferActor(block, blockText);
      timestamp = inferTimestamp(block, blockText);
      hash = norm.simpleHash(label + "\n" + blockText);
      if (seenHashes[hash]) {
        continue;
      }
      seenHashes[hash] = true;
      out.push({
        type: normalizeEventType(label),
        label: label,
        actor: actor,
        timestamp: timestamp,
        text: blockText,
        originalText: blockText,
        translatedText: ""
      });
    }

    return out;
  }

  function splitByType(events) {
    var safeEvents = (events || []).filter(isUsefulEvent);
    var emailsSummary = safeEvents
      .filter(function (e) {
        return /email/i.test(String(e.label || e.type || ""));
      })
      .map(inferEmailSummary)
      .filter(function (row) {
        return row.subject || row.from || row.to || row.date;
      });

    return {
      events: safeEvents,
      escalation: safeEvents.filter(function (e) {
        return String(e.type || "").toLowerCase().indexOf("escalation") >= 0;
      }),
      caseHistory: safeEvents.filter(function (e) {
        return String(e.type || "").toLowerCase().indexOf("history") >= 0;
      }),
      emailsSummary: emailsSummary
    };
  }

  function flattenMetadata(metadata) {
    var out = [];
    var keys = Object.keys(metadata || {});
    var i;
    for (i = 0; i < keys.length; i += 1) {
      if (metadata[keys[i]]) {
        out.push(keys[i] + ": " + metadata[keys[i]]);
      }
    }
    return out.join("\n");
  }

  function getAllSearchText(payload) {
    var parts = [];
    var i;
    var list;
    if (!payload) {
      return "";
    }
    uniquePush(parts, payload.title);
    uniquePush(parts, payload.rawVisibleText);
    uniquePush(parts, flattenMetadata(payload.metadata));
    list = payload.events || [];
    for (i = 0; i < list.length; i += 1) {
      uniquePush(parts, list[i] && list[i].text);
    }
    list = payload.emailsSummary || [];
    for (i = 0; i < list.length; i += 1) {
      uniquePush(parts, list[i] && list[i].subject);
      uniquePush(parts, list[i] && list[i].from);
      uniquePush(parts, list[i] && list[i].to);
      uniquePush(parts, list[i] && list[i].date);
    }
    return safeWhitespace(parts.join("\n"));
  }

  function valueAfterLabel(text, label, nextLabels) {
    var source = String(text || "");
    var escapedLabel = escapeRegex(label);
    var labelPattern = new RegExp("\\b" + escapedLabel + "\\b\\s*:?\\s*", "i");
    var match = labelPattern.exec(source);
    var remainder;
    var end;
    var i;
    var escapedNext;
    var nextPattern;
    var nextMatch;
    if (!match) {
      return "";
    }
    remainder = source.slice(match.index + match[0].length);
    end = remainder.length;
    for (i = 0; i < nextLabels.length; i += 1) {
      escapedNext = escapeRegex(nextLabels[i]);
      nextPattern = new RegExp("\\b" + escapedNext + "\\b\\s*:?\\s*", "i");
      nextMatch = nextPattern.exec(remainder);
      if (nextMatch && nextMatch.index < end) {
        end = nextMatch.index;
      }
    }
    return safeText(remainder.slice(0, end));
  }

  function tryLabels(text, labels, nextLabels) {
    var i;
    var v;
    for (i = 0; i < labels.length; i += 1) {
      v = valueAfterLabel(text, labels[i], nextLabels);
      if (v) {
        return v;
      }
    }
    return "";
  }

  function normalizeEmailValue(value) {
    return safeText(String(value || ""))
      .replace(/[<>\[\]]+/g, "")
      .trim()
      .toLowerCase();
  }

  function isSupportEmail(email) {
    var e = normalizeEmailValue(email);
    if (!e) {
      return true;
    }
    return (
      /^(access-support|casereply|no-reply|noreply|donotreply)@/i.test(e) ||
      /@tycoint\.com$/i.test(e) ||
      /@johnsoncontrols\.com$/i.test(e) ||
      /@jci\.com$/i.test(e) && /^(access-support|casereply|no-reply|noreply|donotreply)@/i.test(e)
    );
  }

  function typoScore(email) {
    var e = normalizeEmailValue(email);
    if (!e) {
      return -100;
    }
    if (e.indexOf("corpoartion") >= 0) {
      return -5;
    }
    return 0;
  }

  function chooseBestCustomerEmail(text, metadata) {
    var matches = String(text || "").match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || [];
    var counts = {};
    var metaEmail = normalizeEmailValue(metadata["contact email"] || metadata.email);
    var i;
    var e;
    var best = "";
    var bestScore = -999;

    if (metaEmail && !isSupportEmail(metaEmail)) {
      counts[metaEmail] = (counts[metaEmail] || 0) + 3;
    }
    for (i = 0; i < matches.length; i += 1) {
      e = normalizeEmailValue(matches[i]);
      if (isSupportEmail(e)) {
        continue;
      }
      counts[e] = (counts[e] || 0) + 1;
    }
    Object.keys(counts).forEach(function (key) {
      var score = counts[key] + typoScore(key);
      if (score > bestScore) {
        best = key;
        bestScore = score;
      }
    });
    return best;
  }

  function looksLikePhone(value) {
    var v = safeWhitespace(value);
    return /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/.test(v);
  }

  function extractPhoneFromLine(line) {
    var match = String(line || "").match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/);
    return match ? safeText(match[0]) : "";
  }

  function normalizePhone(value) {
    var raw = safeText(value).replace(/[^\d+]/g, "");
    if (!raw) {
      return "";
    }
    if (raw.charAt(0) !== "+" && raw.length === 11 && raw.charAt(0) === "1") {
      raw = "+" + raw;
    }
    return raw;
  }

  function isSupportPhone(value) {
    var digits = normalizePhone(value).replace(/[^\d]/g, "");
    return digits === "18005076268" || digits === "18003922873";
  }

  function chooseBestPhone(text, metadata, contactName) {
    var explicit = safeText(metadata["phone (u.s.)"] || metadata.phone || "");
    var lines = norm.splitLines(String(text || ""));
    var i;
    var line;
    var phone;
    var nearby;
    if (looksLikePhone(explicit) && !isSupportPhone(explicit)) {
      return normalizePhone(explicit);
    }
    for (i = 0; i < lines.length; i += 1) {
      line = safeWhitespace(lines[i]);
      if (/please call/i.test(line)) {
        phone = extractPhoneFromLine(line);
        if (phone && !isSupportPhone(phone)) {
          return normalizePhone(phone);
        }
      }
      if (contactName && line.indexOf(contactName) >= 0) {
        nearby = [
          lines[i - 2] || "",
          lines[i - 1] || "",
          lines[i + 1] || "",
          lines[i + 2] || ""
        ].join(" ");
        phone = extractPhoneFromLine(nearby);
        if (phone && !isSupportPhone(phone)) {
          return normalizePhone(phone);
        }
      }
    }
    return "";
  }

  function extractSubjectFacts(subject) {
    var s = safeWhitespace(subject);
    var out = {
      subjectLine: s,
      region: "",
      siteName: "",
      issueStatement: ""
    };
    var m;
    if (!s) {
      return out;
    }
    m = s.match(/\bRegion\s*:\s*([^;]+)\s*;/i);
    if (m) {
      out.region = safeText(m[1]);
    }
    m = s.match(/\bSite\s*:\s*([^;]+)\s*;/i);
    if (m) {
      out.siteName = safeText(m[1]);
    }
    m = s.match(/\bSubject\s*:\s*(.+)$/i);
    if (m) {
      out.issueStatement = safeText(m[1]);
    }
    return out;
  }

  function chooseCleanValue() {
    var i;
    var candidate;
    for (i = 0; i < arguments.length; i += 1) {
      candidate = cleanFinalValue(arguments[i]);
      if (!candidate) {
        continue;
      }
      if (looksLikeUiNoise(candidate)) {
        continue;
      }
      if (/windows account/i.test(candidate) || /preview/i.test(candidate)) {
        continue;
      }
      return candidate;
    }
    return "";
  }

  function extractVersion(metadata, text, subjectLine) {
  var explicit = chooseCleanValue(
    metadata["version / service pack / critical update"],
    metadata["version/service pack/critical update"],
    metadata.version
  );

  var source = safeWhitespace((subjectLine || "") + "\n" + (text || ""));
  var candidates = [];
  var seen = {};

  function normalizeVersion(value) {
    var v = cleanFinalValue(value)
      .replace(/^v\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!v) {
      return "";
    }

    var m = v.match(/^(\d+\.\d+(?:\.\d+)?)(?:\s*SP\s*(\d+))?$/i);
    if (m) {
      return m[2] ? (m[1] + " SP " + m[2]) : m[1];
    }

    return v;
  }

  function looksLikeVersion(value) {
    var v = normalizeVersion(value);
    return /^\d+\.\d+(?:\.\d+)?(?:\s*SP\s*\d+)?$/i.test(v);
  }

  function hasTlsOrCertContext(context) {
    var c = safeWhitespace(context).toLowerCase();
    return (
      /\btls\b/.test(c) ||
      /\bssl\b/.test(c) ||
      /\bcertificate\b/.test(c) ||
      /\bhost certificate\b/.test(c) ||
      /\bextended certificate\b/.test(c)
    );
  }

  function addCandidate(rawValue, context, score, reason) {
    var value = normalizeVersion(rawValue);
    var key;
    if (!looksLikeVersion(value)) {
      return;
    }
    if (hasTlsOrCertContext(context || "")) {
      return;
    }

    key = value + "\n" + reason;
    if (seen[key]) {
      return;
    }
    seen[key] = true;

    candidates.push({
      value: value,
      score: score,
      reason: reason,
      context: cleanFinalValue(context || "")
    });
  }

  if (explicit) {
    explicit = normalizeVersion(explicit);
    if (looksLikeVersion(explicit) && !hasTlsOrCertContext(explicit)) {
      return explicit;
    }
  }

  source.replace(
    /\bVersion\s*\/\s*Service Pack\s*\/\s*Critical Update\b[:\s-]*([A-Za-z0-9 ._-]{1,40})/ig,
    function (_m, value, offset, full) {
      var start = Math.max(0, offset - 60);
      var end = Math.min(full.length, offset + 120);
      addCandidate(value, full.slice(start, end), 120, "explicit-version-label");
      return _m;
    }
  );

  source.replace(
    /\bversion\b[:\s-]{0,8}(v?\d+\.\d+(?:\.\d+)?(?:\s*sp\s*\d+)?)/ig,
    function (_m, value, offset, full) {
      var start = Math.max(0, offset - 50);
      var end = Math.min(full.length, offset + 80);
      addCandidate(value, full.slice(start, end), 95, "version-label");
      return _m;
    }
  );

  source.replace(
    /\bc[•.]?cure(?:\s*9000)?\s*(v?\d+\.\d+(?:\.\d+)?(?:\s*sp\s*\d+)?)/ig,
    function (_m, value, offset, full) {
      var start = Math.max(0, offset - 40);
      var end = Math.min(full.length, offset + 80);
      addCandidate(value, full.slice(start, end), 140, "ccure-adjacent");
      return _m;
    }
  );

  source.replace(
    /\bccure\s*(\d+\.\d+(?:\.\d+)?)/ig,
    function (_m, value, offset, full) {
      var start = Math.max(0, offset - 40);
      var end = Math.min(full.length, offset + 80);
      addCandidate(value, full.slice(start, end), 140, "ccure-adjacent");
      return _m;
    }
  );

  source.replace(
    /\bC[•.]?CURE\s*9000\b[^\n\r]{0,30}\b(\d+\.\d+(?:\.\d+)?(?:\s*SP\s*\d+)?)\b/ig,
    function (_m, value, offset, full) {
      var start = Math.max(0, offset - 40);
      var end = Math.min(full.length, offset + 100);
      addCandidate(value, full.slice(start, end), 150, "ccure9000-adjacent");
      return _m;
    }
  );

  if (!candidates.length) {
    return "";
  }

  candidates.sort(function (a, b) {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.value.length !== a.value.length) {
      return b.value.length - a.value.length;
    }
    return a.value.localeCompare(b.value);
  });

  return candidates[0].value;
}

  function extractPrimaryProduct(text, metadata) {
    var explicit = chooseCleanValue(metadata["main product"], metadata.product);
    var source;
    var ccureMatch;
    if (explicit) {
      return explicit;
    }
    source = safeWhitespace(text);
    ccureMatch = source.match(/\bC[•.]?CURE\s*9000\b/i);
    if (ccureMatch) {
      return "C•CURE 9000";
    }
    return "";
  }

  function extractIssueStatement(metadata, text, subjectValue) {
    var explicit = chooseCleanValue(
      metadata["issue statement"],
      tryLabels(text, ["Issue Statement"], CASE_FIELD_LABELS)
    );
    if (explicit) {
      return explicit;
    }
    return cleanFinalValue(extractSubjectFacts(subjectValue).issueStatement || subjectValue || "");
  }

  function extractIssueDetails(metadata, text) {
    var explicit = chooseCleanValue(
      metadata["issue details"],
      tryLabels(text, ["Issue Details"], CASE_FIELD_LABELS)
    );
    return explicit;
  }

  function buildCleanFolderStem(name, caseNumber) {
    var stem = safeText(name || "")
      .replace(/[<>:"/\\|?*]+/g, " ")
      .replace(/[^\w\s.-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s+/g, "");
    if (!stem) {
      stem = "Case";
    }
    return stem + (caseNumber ? "-" + caseNumber : "");
  }

  function cleanFinalValue(value) {
    return safeText(String(value || ""))
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractStructuredFacts(payload) {
    var metadata = (payload && payload.metadata) || {};
    var text = getAllSearchText(payload);
    var subjectValue = chooseCleanValue(
      metadata.subject,
      tryLabels(text, ["Subject"], CASE_FIELD_LABELS)
    );
    var subjectFacts = extractSubjectFacts(subjectValue);
    var caseNumber = chooseCleanValue(
      payload && payload.caseNumber,
      metadata["case number"],
      metadata.case
    );
    var endUser = chooseCleanValue(
      metadata["end user"]
    );
    var accountName = chooseCleanValue(
      metadata["account name"],
      metadata.account
    );
    var customerName = chooseCleanValue(
      metadata["customer name"],
      metadata.customer,
      endUser,
      accountName
    );
    var siteName = chooseCleanValue(
      metadata["site name"],
      metadata.site,
      metadata["customer site"],
      subjectFacts.siteName,
      endUser
    );
    var contactName = chooseCleanValue(
      metadata["contact name"],
      metadata["technician's name"],
      metadata["technician name"]
    );
    var contactEmail = chooseBestCustomerEmail(text, metadata);
    var integratorName = chooseCleanValue(
      metadata.integrator,
      metadata["system integrator"],
      metadata.dealer,
      metadata.reseller
    );
    var region = chooseCleanValue(
      metadata.region,
      subjectFacts.region
    );
    var primaryProduct = extractPrimaryProduct(text, metadata);
    var productVersion = extractVersion(metadata, text, subjectValue);
    var issueStatement = extractIssueStatement(metadata, text, subjectValue);
    var issueDetails = extractIssueDetails(metadata, text);
    var phone = chooseBestPhone(text, metadata, contactName);
    var folderSeed = chooseCleanValue(customerName, siteName, accountName, integratorName);

    return {
      caseNumber: cleanFinalValue(caseNumber),
      subjectLine: cleanFinalValue(subjectValue),
      integratorName: cleanFinalValue(integratorName),
      endUserName: cleanFinalValue(endUser || customerName),
      accountName: cleanFinalValue(accountName),
      customerName: cleanFinalValue(customerName),
      siteName: cleanFinalValue(siteName),
      locationName: cleanFinalValue(siteName),
      contactName: cleanFinalValue(contactName),
      contactEmail: cleanFinalValue(contactEmail),
      region: cleanFinalValue(region),
      primaryProduct: cleanFinalValue(primaryProduct),
      productVersion: cleanFinalValue(productVersion),
      issueStatement: cleanFinalValue(issueStatement),
      issueDetails: cleanFinalValue(issueDetails),
      phone: cleanFinalValue(phone),
      folderStem: cleanFinalValue(buildCleanFolderStem(folderSeed, caseNumber))
    };
  }

  function enrichPayload(payload) {
    var facts = extractStructuredFacts(payload);
    var enriched = {};
    var keys;
    var i;

    payload = payload || {};
    keys = Object.keys(payload);
    for (i = 0; i < keys.length; i += 1) {
      enriched[keys[i]] = payload[keys[i]];
    }

    enriched.caseNumber = chooseCleanValue(facts.caseNumber, payload.caseNumber);
    enriched.accountName = chooseCleanValue(facts.accountName, payload.accountName);
    enriched.contactName = chooseCleanValue(facts.contactName, payload.contactName);
    enriched.contactEmail = chooseCleanValue(facts.contactEmail, payload.contactEmail);
    enriched.customerName = chooseCleanValue(facts.customerName, payload.customerName, payload.accountName);
    enriched.integratorName = facts.integratorName;
    enriched.endUserName = facts.endUserName;
    enriched.siteName = facts.siteName;
    enriched.locationName = facts.locationName;
    enriched.region = facts.region;
    enriched.primaryProduct = facts.primaryProduct;
    enriched.productVersion = facts.productVersion;
    enriched.issueStatement = facts.issueStatement;
    enriched.issueDetails = facts.issueDetails;
    enriched.phone = facts.phone;
    enriched.subjectLine = facts.subjectLine;
    enriched.folderStem = facts.folderStem;
    enriched.events = (payload.events || []).filter(isUsefulEvent);
    enriched.caseHistory = (payload.caseHistory || []).filter(isUsefulEvent);
    enriched.escalation = (payload.escalation || []).filter(isUsefulEvent);

    var relatedListEmails = parseEmailsFromRelatedList(payload.rawVisibleText || "");
    var inferredEmails = Array.isArray(payload.emailsSummary) ? payload.emailsSummary.slice() : [];

    enriched.emailsSummary = relatedListEmails.length ? relatedListEmails : inferredEmails;

    [
      "caseNumber",
      "accountName",
      "customerName",
      "endUserName",
      "integratorName",
      "siteName",
      "locationName",
      "contactName",
      "contactEmail",
      "phone",
      "region",
      "subjectLine",
      "primaryProduct",
      "productVersion",
      "issueStatement",
      "issueDetails",
      "folderStem"
    ].forEach(function (key) {
      enriched[key] = cleanFinalValue(enriched[key]);
    });

    return enriched;
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
      "Account: " + (payload.accountName || payload.customerName || "Not stated"),
      "End User: " + (payload.endUserName || "Not stated"),
      "Integrator: " + (payload.integratorName || "Not stated"),
      "Site: " + (payload.siteName || "Not stated"),
      "Contact: " + (payload.contactName || "Not stated"),
      "Contact Email: " + (payload.contactEmail || "Not stated"),
      "Case: " + caseNum + " | " + (payload.title || ""),
      "Issue: " + (payload.issueStatement || "Not stated"),
      "",
      "### 4. Research Prompts for Rovo / Copilot",
      "#### Prompt 1: Error-Focused",
      "```",
      "Act as an expert Support Escalation Engineer specializing in " + primaryProduct + ".",
      "Search internal cases and engineering notes for matches to the following data:",
      "Account: " + (payload.accountName || payload.customerName || "Unknown"),
      "End User: " + (payload.endUserName || "Unknown"),
      "Site: " + (payload.siteName || "Unknown"),
      "Version: " + (payload.productVersion || "Unknown"),
      "Issue Statement: " + (payload.issueStatement || "Unknown"),
      "```"
    ];
    return lines.join("\n");
  }

  global.CCurateGpcrmParser = {
    classifyCard: classifyCard,
    extractRecordMetadata: extractRecordMetadata,
    extractCaseNumber: extractCaseNumber,
    extractEmailRelatedListSummary: extractEmailRelatedListSummary,
    extractFromMetadata: extractFromMetadata,
    parseEventsFromText: parseEventsFromText,
    splitByType: splitByType,
    extractStructuredFacts: extractStructuredFacts,
    enrichPayload: enrichPayload,
    buildAiText: buildAiText
  };
})(window);