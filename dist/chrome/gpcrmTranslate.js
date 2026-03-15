(function initGpcrmTranslate(global) {
  "use strict";

  function maybeTranslateToEnglish(text) {
    var original = String(text || "");
    return {
      originalText: original,
      translatedText: ""
    };
  }

  global.CCurateGpcrmTranslate = {
    maybeTranslateToEnglish: maybeTranslateToEnglish
  };
})(window);