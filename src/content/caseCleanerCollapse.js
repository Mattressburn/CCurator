(function initCaseCleanerCollapse(global) {
  "use strict";

  var COLLAPSED_ATTR = "data-case-cleaner-collapsed";
  var PLACEHOLDER_ATTR = "data-case-cleaner-placeholder";
  var LINK_ID_ATTR = "data-case-cleaner-link-id";
  var PREV_STYLE_ATTR = "data-case-cleaner-prev-style";
  var NO_STYLE_TOKEN = "__CASE_CLEANER_NO_STYLE__";
  var seed = 1;

  function isCollapsed(el) {
    return !!(el && el.getAttribute(COLLAPSED_ATTR) === "1");
  }

  function restoreElement(el) {
    if (!el || !isCollapsed(el)) {
      return false;
    }
    var id = el.getAttribute(LINK_ID_ATTR);
    var ph = id ? global.document.querySelector("[" + PLACEHOLDER_ATTR + "='" + id + "']") : null;
    if (ph) {
      ph.remove();
    }

    var prev = el.getAttribute(PREV_STYLE_ATTR);
    if (prev === null || prev === NO_STYLE_TOKEN) {
      el.removeAttribute("style");
    } else {
      el.setAttribute("style", prev);
    }

    el.removeAttribute(COLLAPSED_ATTR);
    el.removeAttribute(LINK_ID_ATTR);
    el.removeAttribute(PREV_STYLE_ATTR);
    return true;
  }

  function collapseBlock(el, options) {
    var opts = options || {};
    var label = opts.label || "Repeated block hidden";
    if (!el || isCollapsed(el)) {
      return false;
    }

    var id = String(seed++);
    var placeholder = global.document.createElement("div");
    placeholder.className = "case-cleaner-placeholder";
    placeholder.setAttribute(PLACEHOLDER_ATTR, id);

    var text = global.document.createElement("span");
    text.className = "case-cleaner-placeholder-text";
    text.textContent = label;

    var btn = global.document.createElement("button");
    btn.type = "button";
    btn.className = "case-cleaner-show-btn";
    btn.textContent = "Show";
    btn.addEventListener("click", function onShowClick() {
      restoreElement(el);
    });

    placeholder.appendChild(text);
    placeholder.appendChild(btn);

    var prevStyle = el.getAttribute("style");

    el.setAttribute(COLLAPSED_ATTR, "1");
    el.setAttribute(LINK_ID_ATTR, id);
    el.setAttribute(PREV_STYLE_ATTR, prevStyle === null ? NO_STYLE_TOKEN : prevStyle);
    el.style.setProperty("display", "none", "important");
    el.style.setProperty("visibility", "hidden", "important");

    if (el.parentNode) {
      el.parentNode.insertBefore(placeholder, el.nextSibling);
      return true;
    }

    restoreElement(el);
    return false;
  }

  function restoreAll(root) {
    var base = root || global.document;
    var collapsed = base.querySelectorAll("[" + COLLAPSED_ATTR + "='1']");
    for (var i = 0; i < collapsed.length; i += 1) {
      restoreElement(collapsed[i]);
    }
    var placeholders = base.querySelectorAll("[" + PLACEHOLDER_ATTR + "]");
    for (var j = 0; j < placeholders.length; j += 1) {
      placeholders[j].remove();
    }
  }

  function collapseMany(elements, options) {
    var list = elements || [];
    var count = 0;
    for (var i = 0; i < list.length; i += 1) {
      if (collapseBlock(list[i], options)) {
        count += 1;
      }
    }
    return count;
  }

  global.CaseCleanerCollapse = {
    isCollapsed: isCollapsed,
    collapseBlock: collapseBlock,
    collapseMany: collapseMany,
    restoreElement: restoreElement,
    restoreAll: restoreAll,
    attrs: {
      collapsed: COLLAPSED_ATTR,
      placeholder: PLACEHOLDER_ATTR,
      linkId: LINK_ID_ATTR,
      prevStyle: PREV_STYLE_ATTR
    }
  };
})(window);