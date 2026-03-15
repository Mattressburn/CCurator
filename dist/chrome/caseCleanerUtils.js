(function initCCurateUtils(global) {
  "use strict";

  var norm = global.CCurateNormalize;

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
    if (!el || !(el instanceof Element)) return false;
    var style = global.getComputedStyle ? global.getComputedStyle(el) : null;
    if (style && (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0)) return false;
    var r = rect(el);
    return r.width >= 2 && r.height >= 2;
  }

  function getSearchRoots(root) {
    var start = root || global.document;
    var roots = [];
    var seen = new Set();
    function walk(node) {
      if (!node || !node.querySelectorAll) return;
      if (!seen.has(node)) { seen.add(node); roots.push(node); }
      var all = node.querySelectorAll("*");
      for (var i = 0; i < all.length; i++) {
        if (all[i].shadowRoot && all[i].shadowRoot.mode === "open") walk(all[i].shadowRoot);
      }
    }
    walk(start);
    return roots;
  }

  function deepQueryAll(root, selector) {
    var out = [];
    var seen = new Set();
    var roots = getSearchRoots(root);
    for (var i = 0; i < roots.length; i++) {
      var list = roots[i].querySelectorAll(selector);
      for (var j = 0; j < list.length; j++) {
        if (!seen.has(list[j])) { seen.add(list[j]); out.push(list[j]); }
      }
    }
    return out;
  }

  // Bridging / Compatibility Layer
  // Redirects old utility calls to the new CCurateNormalize module
  var utils = {
    rect: rect,
    isElementVisible: isElementVisible,
    getSearchRoots: getSearchRoots,
    deepQueryAll: deepQueryAll,
    textFromElement: norm.textFromElement,
    normalizeText: norm.normalizeText,
    normalizeWhitespace: norm.normalizeWhitespace,
    splitLines: norm.splitLines,
    simpleHash: norm.simpleHash,
    copyToClipboard: function (text) {
      return global.navigator.clipboard.writeText(String(text || ""));
    }
  };

  global.CCurateUtils = utils;
})(window);