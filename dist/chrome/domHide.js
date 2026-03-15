(function initCCurateDomHide(global) {
  "use strict";

  var HIDDEN_ATTR = "data-ccurate-hidden";
  var PLACEHOLDER_ATTR = "data-ccurate-placeholder";
  var LINK_ATTR = "data-ccurate-link";
  var PREV_STYLE_ATTR = "data-ccurate-prevstyle";
  var NO_STYLE = "__CC_NO_STYLE__";
  var seed = 1;

  function isHidden(el) {
    return !!(el && el.getAttribute(HIDDEN_ATTR) === "1");
  }

  function hideEl(el, label) {
    if (!el || isHidden(el)) {
      return false;
    }

    var id = String(seed++);
    var previousStyle = el.getAttribute("style");
    var placeholder = global.document.createElement("div");
    placeholder.className = "cc-hidden-placeholder";
    placeholder.setAttribute(PLACEHOLDER_ATTR, id);

    var text = global.document.createElement("span");
    text.textContent = label || "Duplicate wrapper hidden by CCurate";
    placeholder.appendChild(text);

    var show = global.document.createElement("button");
    show.type = "button";
    show.className = "cc-show-btn";
    show.textContent = "Show";
    show.addEventListener("click", function () {
      restoreEl(el);
    });
    placeholder.appendChild(show);

    el.setAttribute(HIDDEN_ATTR, "1");
    el.setAttribute(LINK_ATTR, id);
    el.setAttribute(PREV_STYLE_ATTR, previousStyle === null ? NO_STYLE : previousStyle);
    el.style.setProperty("display", "none", "important");
    el.style.setProperty("visibility", "hidden", "important");

    if (el.parentNode) {
      el.parentNode.insertBefore(placeholder, el.nextSibling);
      return true;
    }

    restoreEl(el);
    return false;
  }

  function restoreEl(el) {
    if (!el || !isHidden(el)) {
      return false;
    }

    var id = el.getAttribute(LINK_ATTR);
    var placeholder = id
      ? global.document.querySelector("[" + PLACEHOLDER_ATTR + "='" + id + "']")
      : null;
    if (placeholder) {
      placeholder.remove();
    }

    var previousStyle = el.getAttribute(PREV_STYLE_ATTR);
    if (previousStyle === null || previousStyle === NO_STYLE) {
      el.removeAttribute("style");
    } else {
      el.setAttribute("style", previousStyle);
    }

    el.removeAttribute(HIDDEN_ATTR);
    el.removeAttribute(LINK_ATTR);
    el.removeAttribute(PREV_STYLE_ATTR);
    return true;
  }

  function hideMany(elements, label) {
    var count = 0;
    var list = elements || [];
    for (var i = 0; i < list.length; i += 1) {
      if (hideEl(list[i], label)) {
        count += 1;
      }
    }
    return count;
  }

  function restoreAll(root) {
    var base = root || global.document;
    var hidden = base.querySelectorAll("[" + HIDDEN_ATTR + "='1']");
    for (var i = 0; i < hidden.length; i += 1) {
      restoreEl(hidden[i]);
    }
    var placeholders = base.querySelectorAll("[" + PLACEHOLDER_ATTR + "]");
    for (var j = 0; j < placeholders.length; j += 1) {
      placeholders[j].remove();
    }
  }

  global.CCurateDomHide = {
    isHidden: isHidden,
    hideEl: hideEl,
    hideMany: hideMany,
    restoreEl: restoreEl,
    restoreAll: restoreAll,
    attrs: {
      hidden: HIDDEN_ATTR,
      placeholder: PLACEHOLDER_ATTR,
      link: LINK_ATTR,
      prevStyle: PREV_STYLE_ATTR
    }
  };
})(window);
