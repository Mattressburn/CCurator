(function initCaseCleanerNormalize(global) {
  "use strict";

  function stripInvisible(text) {
    return String(text || "")
      .replace(/[\u200B-\u200F\uFEFF]/g, "")
      .replace(/\r\n?/g, "\n");
  }

  function normalizeWhitespace(text) {
    return stripInvisible(text)
      .replace(/[\t\f\v]+/g, " ")
      .replace(/[ ]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizeText(text) {
    return normalizeWhitespace(String(text || ""))
      .replace(/\n+/g, " ")
      .trim();
  }

  function normalizeForKey(text) {
    return normalizeText(text).toLowerCase().replace(/\s+/g, " ").trim();
  }

  function canonicalSubject(subject) {
    var value = normalizeText(subject || "");
    value = value.replace(/^(email|call|task)\s*:?\s*/i, "");
    var changed = true;
    while (changed) {
      var before = value;
      value = value.replace(/^(re|fw|fwd)\s*:\s*/i, "");
      changed = before !== value;
    }
    return value.toLowerCase().trim();
  }

  function simpleHash(text) {
    var input = String(text || "");
    var hash = 2166136261;
    for (var i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return "h" + (hash >>> 0).toString(16).padStart(8, "0");
  }

  function textFromElement(el) {
    if (!el) { return ""; }
    return String(el.innerText || el.textContent || "").replace(/\u00a0/g, " ");
  }

  function splitLines(text) {
    return stripInvisible(String(text || "")).split("\n");
  }

  global.CaseCleanerNormalize = {
    stripInvisible: stripInvisible,
    normalizeWhitespace: normalizeWhitespace,
    normalizeText: normalizeText,
    normalizeForKey: normalizeForKey,
    canonicalSubject: canonicalSubject,
    simpleHash: simpleHash,
    textFromElement: textFromElement,
    splitLines: splitLines
  };
})(window);
