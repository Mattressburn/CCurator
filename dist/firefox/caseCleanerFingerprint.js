(function initCCurateFingerprint(global) {
  "use strict";

  var utils = global.CCurateUtils;

  function tagSignature(el) {
    if (!el || !el.querySelectorAll) {
      return [];
    }
    var counts = Object.create(null);
    var list = el.querySelectorAll("div,section,article,table,tr,td,p,span,a,img,ul,li,time");
    for (var i = 0; i < list.length; i += 1) {
      var tag = list[i].tagName.toLowerCase();
      counts[tag] = (counts[tag] || 0) + 1;
    }
    return Object.keys(counts)
      .sort()
      .slice(0, 16)
      .map(function (key) {
        return key + ":" + counts[key];
      });
  }

  function buildFingerprint(el, bodyClean) {
    if (!el || !(el instanceof Element)) {
      return null;
    }
    var r = utils.rect(el);
    var images = utils.deepQueryAll(el, "img").filter(function (img) {
      return utils.isElementVisible(img);
    });
    var links = utils.deepQueryAll(el, "a");
    var tables = utils.deepQueryAll(el, "table,tr,td,th");
    var lines = utils.splitLines(bodyClean || utils.textFromElement(el));
    var cleanedLines = lines.map(utils.normalizeText).filter(Boolean);

    var wideImageCount = 0;
    var bannerImageCount = 0;
    var imageShape = [];
    for (var i = 0; i < images.length; i += 1) {
      var ir = utils.rect(images[i]);
      var ratio = ir.width / Math.max(1, ir.height);
      if (ratio >= 1.8) {
        wideImageCount += 1;
      }
      if (ir.width >= 560 && ratio >= 2.5) {
        bannerImageCount += 1;
      }
      imageShape.push(utils.widthBucket(ir.width) + ":" + utils.ratioBucket(ir.width, ir.height));
    }

    return {
      nodeTag: el.tagName.toLowerCase(),
      areaBucket: utils.areaBucket(r.area),
      widthBucket: utils.widthBucket(r.width),
      childCount: el.children ? el.children.length : 0,
      imageCount: images.length,
      wideImageCount: wideImageCount,
      bannerImageCount: bannerImageCount,
      imageShape: imageShape.slice(0, 8),
      tagSignature: tagSignature(el),
      linkCount: links.length,
      tableLikeCount: tables.length,
      lineCount: cleanedLines.length,
      medianLineLength: median(cleanedLines.map(function (line) { return line.length; })),
      textLength: (bodyClean || "").length,
      quoteLineRatio: quoteLineRatio(cleanedLines),
      structureHash: utils.simpleHash([
        el.tagName,
        utils.areaBucket(r.area),
        utils.widthBucket(r.width),
        images.length,
        wideImageCount,
        bannerImageCount,
        links.length,
        cleanedLines.length,
        tagSignature(el).join("|")
      ].join("#"))
    };
  }

  function median(list) {
    if (!list || !list.length) {
      return 0;
    }
    var sorted = list.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    }
    return sorted[mid];
  }

  function quoteLineRatio(lines) {
    if (!lines || !lines.length) {
      return 0;
    }
    var quoted = 0;
    for (var i = 0; i < lines.length; i += 1) {
      if (/^(>|\|)/.test(lines[i])) {
        quoted += 1;
      }
    }
    return quoted / lines.length;
  }

  function setOverlapScore(a, b) {
    var setA = new Set(a || []);
    var setB = new Set(b || []);
    if (!setA.size || !setB.size) {
      return 0;
    }
    var overlap = 0;
    setA.forEach(function (item) {
      if (setB.has(item)) {
        overlap += 1;
      }
    });
    return overlap / Math.max(setA.size, setB.size);
  }

  function similarityScore(a, b) {
    if (!a || !b) {
      return 0;
    }
    var score = 0;
    if (a.areaBucket === b.areaBucket) {
      score += 10;
    }
    if (a.widthBucket === b.widthBucket) {
      score += 6;
    }
    score += Math.round(setOverlapScore(a.tagSignature, b.tagSignature) * 26);
    score += Math.round(setOverlapScore(a.imageShape, b.imageShape) * 12);
    score += utils.clamp(8 - Math.abs(a.imageCount - b.imageCount) * 2, 0, 8);
    score += utils.clamp(8 - Math.abs(a.wideImageCount - b.wideImageCount) * 2, 0, 8);
    score += utils.clamp(6 - Math.abs(a.linkCount - b.linkCount), 0, 6);
    score += utils.clamp(6 - Math.abs(a.tableLikeCount - b.tableLikeCount), 0, 6);
    score += utils.clamp(8 - Math.round(Math.abs(a.quoteLineRatio - b.quoteLineRatio) * 10), 0, 8);
    score += utils.clamp(8 - Math.abs(a.lineCount - b.lineCount), 0, 8);
    score += utils.clamp(8 - Math.round(Math.abs(a.medianLineLength - b.medianLineLength) / 10), 0, 8);
    if (a.nodeTag === b.nodeTag) {
      score += 4;
    }
    return score;
  }

  function wrapperPlausibility(fp) {
    if (!fp) {
      return 0;
    }
    var score = 0;
    if (fp.imageCount >= 2) {
      score += 18;
    }
    if (fp.wideImageCount >= 1) {
      score += 15;
    }
    if (fp.bannerImageCount >= 1) {
      score += 10;
    }
    if (fp.tableLikeCount >= 4) {
      score += 9;
    }
    if (fp.lineCount >= 10) {
      score += 8;
    }
    if (fp.textLength >= 150 && fp.textLength <= 10000) {
      score += 8;
    }
    if (fp.quoteLineRatio >= 0.2) {
      score += 6;
    }
    return score;
  }

  function looseTextSimilarity(textA, textB) {
    var a = utils.normalizeForLooseHash(textA || "");
    var b = utils.normalizeForLooseHash(textB || "");
    if (!a || !b) {
      return 0;
    }
    if (a === b) {
      return 1;
    }
    var aTokens = a.split(/\s+/).filter(function (t) { return t.length >= 3; });
    var bTokens = b.split(/\s+/).filter(function (t) { return t.length >= 3; });
    if (!aTokens.length || !bTokens.length) {
      return 0;
    }
    var setA = new Set(aTokens);
    var setB = new Set(bTokens);
    var overlap = 0;
    setA.forEach(function (t) {
      if (setB.has(t)) {
        overlap += 1;
      }
    });
    return overlap / Math.max(setA.size, setB.size);
  }

  function quotedChainFingerprint(cleanText) {
    var lines = utils.splitLines(cleanText || "");
    var quoted = [];
    for (var i = 0; i < lines.length; i += 1) {
      var line = utils.normalizeText(lines[i]);
      if (!line) {
        continue;
      }
      if (/^(>|\|)/.test(line) || /^[-_]{6,}$/.test(line)) {
        quoted.push(line.replace(/^(>|\|)\s*/, ""));
      }
    }
    if (!quoted.length) {
      return "";
    }
    return utils.simpleHash(quoted.slice(0, 60).join("\n"));
  }

  global.CCurateFingerprint = {
    buildFingerprint: buildFingerprint,
    similarityScore: similarityScore,
    wrapperPlausibility: wrapperPlausibility,
    looseTextSimilarity: looseTextSimilarity,
    quotedChainFingerprint: quotedChainFingerprint
  };
})(window);