(function initCCurateParseLabels(global) {
  "use strict";

  function escapeRegex(str) {
    return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function extractLabeledValue(fullText, label, nextLabels) {
    var text = String(fullText || "");
    var labelPattern = new RegExp(escapeRegex(label) + "\\s*", "i");
    var labelMatch = text.match(labelPattern);
    if (!labelMatch) {
      return "";
    }

    var valueStart = labelMatch.index + labelMatch[0].length;
    var remainder = text.slice(valueStart);
    var end = remainder.length;
    var boundaries = nextLabels || [];

    for (var i = 0; i < boundaries.length; i += 1) {
      var boundaryPattern = new RegExp(escapeRegex(boundaries[i]), "i");
      var boundaryMatch = remainder.match(boundaryPattern);
      if (boundaryMatch && boundaryMatch.index < end) {
        end = boundaryMatch.index;
      }
    }

    return remainder.slice(0, end).replace(/\s+/g, " ").trim();
  }

  global.CCurateParseLabels = {
    extractLabeledValue: extractLabeledValue
  };
})(window);
