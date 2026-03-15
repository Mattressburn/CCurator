(function initGpcrmTranslate(global) {
  "use strict";

  var norm = global.CaseCleanerNormalize;

  var SPANISH_HINT_WORDS = [
    "hola", "gracias", "adjunto", "estimado", "estimada", "solicitud", "cliente", "equipo",
    "error", "incidencia", "escalamiento", "caso", "comentario", "historial", "ayuda",
    "por favor", "buenos dias", "buenas tardes", "fecha", "correo", "enviado", "respondio"
  ];

  function countSpanishSignals(text) {
    var value = norm.normalizeForKey(text || "");
    if (!value) {
      return 0;
    }

    var count = 0;
    for (var i = 0; i < SPANISH_HINT_WORDS.length; i += 1) {
      if (value.indexOf(SPANISH_HINT_WORDS[i]) >= 0) {
        count += 1;
      }
    }

    if (/[\u00C0-\u017F]/.test(String(text || ""))) {
      count += 1;
    }

    return count;
  }

  function detectSpanish(text) {
    return countSpanishSignals(text) >= 2;
  }

  function maybeTranslateToEnglish(text) {
    var original = String(text || "");
    var spanishDetected = detectSpanish(original);
    return {
      originalText: original,
      translatedText: "",
      spanishDetected: spanishDetected,
      translationAvailable: false
    };
  }

  global.CaseCleanerGpcrmTranslate = {
    detectSpanish: detectSpanish,
    maybeTranslateToEnglish: maybeTranslateToEnglish
  };
})(window);