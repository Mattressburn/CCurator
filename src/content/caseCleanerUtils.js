(function initCaseCleanerUtils(global) {
  "use strict";

  function debounce(fn, delay) {
    var wait = typeof delay === "number" ? delay : 200;
    var timer = null;
    return function debounced() {
      var args = arguments;
      var ctx = this;
      if (timer) {
        global.clearTimeout(timer);
      }
      timer = global.setTimeout(function run() {
        fn.apply(ctx, args);
      }, wait);
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function rect(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") {
      return { width: 0, height: 0, top: 0, left: 0, area: 0 };
    }
    var r = el.getBoundingClientRect();
    var width = Math.max(0, Math.round(r.width));
    var height = Math.max(0, Math.round(r.height));
    return {
      width: width,
      height: height,
      top: Math.round((global.scrollY || 0) + r.top),
      left: Math.round((global.scrollX || 0) + r.left),
      area: width * height
    };
  }

  function isElementVisible(el) {
    if (!el || !(el instanceof Element)) {
      return false;
    }
    var style = global.getComputedStyle ? global.getComputedStyle(el) : null;
    if (style) {
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      if (Number(style.opacity) === 0) {
        return false;
      }
    }
    var r = rect(el);
    return r.width >= 2 && r.height >= 2;
  }

  function getSearchRoots(root) {
    var start = root || global.document;
    var roots = [];
    var seen = new Set();

    function addRoot(candidate) {
      if (!candidate || seen.has(candidate)) {
        return;
      }
      seen.add(candidate);
      roots.push(candidate);
    }

    function walk(node) {
      if (!node || !node.querySelectorAll) {
        return;
      }
      addRoot(node);
      var all = node.querySelectorAll("*");
      for (var i = 0; i < all.length; i += 1) {
        var el = all[i];
        if (el.shadowRoot && el.shadowRoot.mode === "open") {
          walk(el.shadowRoot);
        }
      }
    }

    walk(start);
    return roots;
  }

  function deepQueryAll(root, selector) {
    var out = [];
    var seen = new Set();
    var roots = getSearchRoots(root);
    for (var i = 0; i < roots.length; i += 1) {
      var sr = roots[i];
      if (!sr.querySelectorAll) {
        continue;
      }
      var list = sr.querySelectorAll(selector);
      for (var j = 0; j < list.length; j += 1) {
        if (!seen.has(list[j])) {
          seen.add(list[j]);
          out.push(list[j]);
        }
      }
    }
    return out;
  }

  function getDeepElementFromPoint(root, x, y) {
    var currentRoot = root || global.document;
    var currentEl = null;
    var guard = 0;
    while (currentRoot && guard < 24) {
      guard += 1;
      if (typeof currentRoot.elementFromPoint !== "function") {
        break;
      }
      currentEl = currentRoot.elementFromPoint(x, y);
      if (!currentEl || !currentEl.shadowRoot || currentEl.shadowRoot.mode !== "open") {
        break;
      }
      currentRoot = currentEl.shadowRoot;
    }
    return currentEl;
  }

  function uniqueElements(nodes) {
    var out = [];
    var seen = new Set();
    for (var i = 0; i < (nodes || []).length; i += 1) {
      var node = nodes[i];
      if (node && !seen.has(node)) {
        seen.add(node);
        out.push(node);
      }
    }
    return out;
  }

  function smallestElements(nodes) {
    var list = uniqueElements(nodes || []);
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      var el = list[i];
      var hasContainedCandidate = false;
      for (var j = 0; j < list.length; j += 1) {
        var other = list[j];
        if (el !== other && el.contains(other)) {
          hasContainedCandidate = true;
          break;
        }
      }
      if (!hasContainedCandidate) {
        out.push(el);
      }
    }
    return out;
  }

  function textFromElement(el) {
    if (!el) {
      return "";
    }
    return String(el.innerText || el.textContent || "").replace(/\u00a0/g, " ");
  }

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
    return normalizeWhitespace(String(text || "")).replace(/\n+/g, " ").trim();
  }

  function normalizeForLooseHash(text) {
    return normalizeText(text)
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, "[url]")
      .replace(/[a-f0-9]{8,}/g, "[hex]")
      .replace(/\b\d{2,}\b/g, "[num]");
  }

  function splitLines(text) {
    return stripInvisible(text).split("\n");
  }

  function safeUrlPath(rawUrl) {
    var src = String(rawUrl || "");
    if (!src) {
      return "";
    }
    try {
      var u = new URL(src, global.location ? global.location.href : "https://example.invalid/");
      return (u.pathname || "").split("/").slice(-3).join("/").toLowerCase();
    } catch (err) {
      return src.split("?")[0].toLowerCase();
    }
  }

  function simpleHash(text) {
    var src = String(text || "");
    var h = 2166136261;
    for (var i = 0; i < src.length; i += 1) {
      h ^= src.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    var n = h >>> 0;
    return "h" + n.toString(16).padStart(8, "0");
  }

  function widthBucket(w) {
    var n = Number(w) || 0;
    if (n >= 1200) {
      return "w1200";
    }
    if (n >= 900) {
      return "w900";
    }
    if (n >= 600) {
      return "w600";
    }
    if (n >= 360) {
      return "w360";
    }
    return "w0";
  }

  function ratioBucket(width, height) {
    var w = Math.max(1, Number(width) || 0);
    var h = Math.max(1, Number(height) || 0);
    var ratio = w / h;
    if (ratio >= 3.2) {
      return "ultra-wide";
    }
    if (ratio >= 1.8) {
      return "wide";
    }
    if (ratio >= 1.2) {
      return "landscape";
    }
    if (ratio >= 0.8) {
      return "square";
    }
    return "portrait";
  }

  function areaBucket(area) {
    var n = Number(area) || 0;
    if (n >= 1500000) {
      return "a1500k";
    }
    if (n >= 900000) {
      return "a900k";
    }
    if (n >= 400000) {
      return "a400k";
    }
    if (n >= 150000) {
      return "a150k";
    }
    if (n >= 60000) {
      return "a60k";
    }
    return "a0";
  }

  function parseDateFromText(raw) {
    var text = normalizeText(raw);
    if (!text) {
      return null;
    }
    var patterns = [
      /\b\d{4}-\d{2}-\d{2}[ t]\d{2}:\d{2}(:\d{2})?(?: ?(?:z|utc|gmt|[+-]\d{2}:?\d{2}))?/i,
      /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}(?:[ ,]+\d{1,2}:\d{2}(?::\d{2})? ?(?:am|pm)?)?/i,
      /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)?/i
    ];
    for (var i = 0; i < patterns.length; i += 1) {
      var match = text.match(patterns[i]);
      if (!match) {
        continue;
      }
      var found = new Date(match[0]);
      if (!isNaN(found.getTime())) {
        return {
          timestampText: match[0],
          timestampSortable: found.toISOString(),
          confidence: 0.72
        };
      }
    }
    var fallback = new Date(text);
    if (!isNaN(fallback.getTime())) {
      return {
        timestampText: text,
        timestampSortable: fallback.toISOString(),
        confidence: 0.5
      };
    }
    return null;
  }

  function getDomPathHint(el) {
    if (!el || !(el instanceof Element)) {
      return "";
    }
    var parts = [];
    var cur = el;
    var hop = 0;
    while (cur && cur.nodeType === 1 && hop < 8) {
      var name = cur.tagName ? cur.tagName.toLowerCase() : "node";
      var part = name;
      if (cur.id) {
        part += "#" + cur.id;
        parts.unshift(part);
        break;
      }
      if (cur.parentElement) {
        var index = 0;
        var sib = cur;
        while (sib) {
          if (sib.tagName === cur.tagName) {
            index += 1;
          }
          sib = sib.previousElementSibling;
        }
        part += ":nth-of-type(" + index + ")";
      }
      parts.unshift(part);
      cur = cur.parentElement;
      hop += 1;
    }
    return parts.join(" > ");
  }

  function dedupeArray(items) {
    var out = [];
    var seen = new Set();
    for (var i = 0; i < (items || []).length; i += 1) {
      var value = normalizeText(items[i]);
      if (value && !seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    }
    return out;
  }

  function copyToClipboard(text) {
    var payload = String(text || "");
    if (!payload) {
      return Promise.resolve(false);
    }
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      return global.navigator.clipboard.writeText(payload).then(function () {
        return true;
      });
    }
    return new Promise(function (resolve) {
      try {
        var area = global.document.createElement("textarea");
        area.value = payload;
        area.setAttribute("readonly", "readonly");
        area.style.position = "fixed";
        area.style.left = "-1000px";
        global.document.body.appendChild(area);
        area.select();
        var ok = global.document.execCommand("copy");
        area.remove();
        resolve(!!ok);
      } catch (err) {
        resolve(false);
      }
    });
  }

  function downloadTextFile(filename, text, mimeType) {
    try {
      var blob = new Blob([String(text || "")], { type: mimeType || "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = global.document.createElement("a");
      a.href = url;
      a.download = filename || "case-cleaner-output.txt";
      global.document.body.appendChild(a);
      a.click();
      a.remove();
      global.setTimeout(function revoke() {
        URL.revokeObjectURL(url);
      }, 1200);
      return true;
    } catch (err) {
      return false;
    }
  }

  global.CaseCleanerUtils = {
    clamp: clamp,
    debounce: debounce,
    rect: rect,
    isElementVisible: isElementVisible,
    getSearchRoots: getSearchRoots,
    deepQueryAll: deepQueryAll,
    getDeepElementFromPoint: getDeepElementFromPoint,
    uniqueElements: uniqueElements,
    smallestElements: smallestElements,
    textFromElement: textFromElement,
    stripInvisible: stripInvisible,
    normalizeWhitespace: normalizeWhitespace,
    normalizeText: normalizeText,
    normalizeForLooseHash: normalizeForLooseHash,
    splitLines: splitLines,
    safeUrlPath: safeUrlPath,
    simpleHash: simpleHash,
    widthBucket: widthBucket,
    ratioBucket: ratioBucket,
    areaBucket: areaBucket,
    parseDateFromText: parseDateFromText,
    getDomPathHint: getDomPathHint,
    dedupeArray: dedupeArray,
    copyToClipboard: copyToClipboard,
    downloadTextFile: downloadTextFile
  };
})(window);