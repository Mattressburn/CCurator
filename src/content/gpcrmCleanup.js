(function initGpcrmCleanup(global) {
  "use strict";

  var norm = global.CaseCleanerNormalize;

  var QUOTE_MARKERS = [
    "--------------- original message ---------------",
    "from:",
    "sent:",
    "subject:",
    "to:",
    "cc:",
    "thread::"
  ];

  var HTML_ENTITIES = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'"
  };

  function decodeHtmlEntities(text) {
    var value = String(text || "");
    var keys = Object.keys(HTML_ENTITIES);
    for (var i = 0; i < keys.length; i += 1) {
      value = value.split(keys[i]).join(HTML_ENTITIES[keys[i]]);
    }
    return value.replace(/&#(\d+);/g, function (_m, num) {
      var n = Number(num);
      if (!Number.isFinite(n)) {
        return _m;
      }
      return String.fromCharCode(n);
    });
  }

  function normalizeTextHard(text) {
    return norm.normalizeWhitespace(decodeHtmlEntities(String(text || "").replace(/\u00a0/g, " ")));
  }

  function findQuoteStart(lines) {
    var minContentLines = 2;
    for (var i = 0; i < lines.length; i += 1) {
      var lowered = String(lines[i] || "").trim().toLowerCase();
      if (!lowered) {
        continue;
      }
      var markerMatched = false;
      for (var m = 0; m < QUOTE_MARKERS.length; m += 1) {
        if (lowered.indexOf(QUOTE_MARKERS[m]) === 0) {
          markerMatched = true;
          break;
        }
      }
      if (markerMatched && i >= minContentLines) {
        return i;
      }
    }
    return -1;
  }

  function stripQuotedEmailChain(text) {
    var normalized = normalizeTextHard(text);
    if (!normalized) {
      return "";
    }

    var lines = norm.splitLines(normalized);
    var quoteStart = findQuoteStart(lines);
    if (quoteStart < 0) {
      return normalized;
    }
    return norm.normalizeWhitespace(lines.slice(0, quoteStart).join("\n"));
  }

  global.CaseCleanerGpcrmCleanup = {
    QUOTE_MARKERS: QUOTE_MARKERS.slice(),
    decodeHtmlEntities: decodeHtmlEntities,
    normalizeTextHard: normalizeTextHard,
    stripQuotedEmailChain: stripQuotedEmailChain
  };
})(window);