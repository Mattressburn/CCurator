(function initCaseCleanerClassify(global) {
  "use strict";

  function classifyKind(subject) {
    var value = String(subject || "").trim();
    if (/^email\s*:/i.test(value)) { return "email"; }
    if (/^call(\s|:|$)/i.test(value)) { return "call"; }
    if (/^task\s*:/i.test(value)) { return "task"; }
    return "unknown";
  }

  global.CaseCleanerClassify = {
    classifyKind: classifyKind
  };
})(window);
