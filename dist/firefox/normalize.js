(function initCCurateNormalize(global) {
  "use strict";

  /**
   * Removes invisible characters and standardizes line endings.
   */
  function stripInvisible(text) {
    return String(text || "")
      .replace(/[\u200B-\u200F\uFEFF]/g, "")
      .replace(/\r\n?/g, "\n");
  }

  /**
   * Normalizes whitespace for technical comparisons.
   */
  function normalizeWhitespace(text) {
    return stripInvisible(text)
      .replace(/[\t\f\v]+/g, " ")
      .replace(/[ ]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /**
   * Flattens text into a single line for previews or simple labels.
   */
  function normalizeText(text) {
    return normalizeWhitespace(String(text || ""))
      .replace(/\n+/g, " ")
      .trim();
  }

  /**
   * Normalizes for use as a lookup key.
   */
  function normalizeForKey(text) {
    return normalizeText(text).toLowerCase().replace(/\s+/g, " ").trim();
  }

  /**
   * Specifically for deduplication; masks dynamic IDs like hex/urls.
   */
  function normalizeForLooseHash(text) {
    return normalizeText(text)
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, "[url]")
      .replace(/[a-f0-9]{8,}/g, "[hex]")
      .replace(/\b\d{2,}\b/g, "[num]");
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

  global.CCurateNormalize = {
    stripInvisible: stripInvisible,
    normalizeWhitespace: normalizeWhitespace,
    normalizeText: normalizeText,
    normalizeForKey: normalizeForKey,
    normalizeForLooseHash: normalizeForLooseHash,
    canonicalSubject: canonicalSubject,
    simpleHash: simpleHash,
    textFromElement: textFromElement,
    splitLines: splitLines
  };
})(window);