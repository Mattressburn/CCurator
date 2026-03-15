(function initCaseCleanerDedupe(global) {
  "use strict";

  var norm = global.CaseCleanerNormalize;

  function buildDedupeKey(row) {
    var kind = row.kind || "unknown";
    var canonical = norm.normalizeForKey(row.canonicalSubject || row.subject || "");
    if (kind === "email") {
      return [
        "email",
        canonical,
        norm.normalizeForKey(row.name || ""),
        norm.normalizeForKey(row.dueDate || "")
      ].join("|");
    }
    if (kind === "call" || kind === "task") {
      return [kind, canonical, norm.normalizeForKey(row.dueDate || "")].join("|");
    }
    return row.fingerprint || ("unknown|" + canonical);
  }

  function richnessScore(row) {
    var score = 0;
    if (row.name) { score += 10; }
    if (row.task) { score += 10; }
    if (row.dueDate) { score += 10; }
    if (row.subject) { score += 5; }
    score += Math.min(200, String(row.fullText || "").length);
    return score;
  }

  function shallowCopy(value) {
    var out = {};
    var keys = Object.keys(value || {});
    for (var i = 0; i < keys.length; i += 1) {
      out[keys[i]] = value[keys[i]];
    }
    return out;
  }

  function dedupeCasePreviewRows(rows) {
    if (!rows || !rows.length) {
      return [];
    }

    var groups = [];
    var byKey = new Map();

    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var key = buildDedupeKey(row);
      if (!byKey.has(key)) {
        byKey.set(key, groups.length);
        groups.push({ key: key, rows: [] });
      }
      groups[byKey.get(key)].rows.push(row);
    }

    var result = [];
    for (var g = 0; g < groups.length; g += 1) {
      var group = groups[g];
      var best = group.rows[0];
      for (var r = 1; r < group.rows.length; r += 1) {
        if (richnessScore(group.rows[r]) > richnessScore(best)) {
          best = group.rows[r];
        }
      }

      var minIndex = best.index;
      for (var m = 0; m < group.rows.length; m += 1) {
        if (group.rows[m].index < minIndex) {
          minIndex = group.rows[m].index;
        }
      }

      var normalized = shallowCopy(best);
      normalized.index = minIndex;
      normalized.dedupeCount = group.rows.length;
      normalized.dedupeGroupKey = group.key;
      normalized.isDuplicate = group.rows.length > 1;
      result.push(normalized);
    }

    result.sort(function (a, b) { return a.index - b.index; });
    for (var x = 0; x < result.length; x += 1) {
      result[x].index = x;
    }
    return result;
  }

  global.CaseCleanerDedupe = {
    dedupeCasePreviewRows: dedupeCasePreviewRows,
    buildDedupeKey: buildDedupeKey
  };
})(window);
