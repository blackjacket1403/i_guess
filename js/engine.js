/* TUMBLER — engine.js
 * Pure game logic: no DOM, no globals beyond the TUMBLER namespace.
 * Feedback scoring, word selection/validation, and the loot economy live here.
 */
(function () {
  "use strict";
  var TUMBLER = (window.TUMBLER = window.TUMBLER || {});

  var WORDS = window.TUMBLER_WORDS || {};
  var validSets = {}; // len -> Set, built lazily

  function pool(len) {
    return WORDS[String(len)] || { answers: [], valid: [] };
  }

  function validSet(len) {
    var key = String(len);
    if (!validSets[key]) {
      var p = pool(len);
      var s = new Set(p.valid);
      for (var i = 0; i < p.answers.length; i++) s.add(p.answers[i]);
      validSets[key] = s;
    }
    return validSets[key];
  }

  function isValidWord(word) {
    if (!word) return false;
    word = word.toLowerCase();
    return validSet(word.length).has(word);
  }

  function randomAnswer(len, exclude) {
    var answers = pool(len).answers;
    if (!answers.length) return null;
    exclude = exclude || new Set();
    // Skip the very-common function words at the head of the frequency list so
    // secrets feel like "combinations", not filler. Bias toward variety.
    var floor = Math.min(40, Math.floor(answers.length * 0.15));
    for (var tries = 0; tries < 200; tries++) {
      var idx = floor + Math.floor(Math.random() * (answers.length - floor));
      var w = answers[idx];
      if (!exclude.has(w)) return w;
    }
    // fallback: linear scan
    for (var j = 0; j < answers.length; j++) {
      if (!exclude.has(answers[j])) return answers[j];
    }
    return answers[0];
  }

  /* Wordle-correct scoring with duplicate-letter handling (two passes). */
  function scoreGuess(guess, answer) {
    guess = guess.toLowerCase();
    answer = answer.toLowerCase();
    var n = guess.length;
    var result = new Array(n);
    var counts = {};
    var i, c;
    for (i = 0; i < n; i++) {
      c = answer[i];
      counts[c] = (counts[c] || 0) + 1;
    }
    // pass 1: exact hits
    for (i = 0; i < n; i++) {
      if (guess[i] === answer[i]) {
        result[i] = "hit";
        counts[guess[i]]--;
      } else {
        result[i] = null;
      }
    }
    // pass 2: present-but-misplaced, limited by remaining counts
    for (i = 0; i < n; i++) {
      if (result[i]) continue;
      c = guess[i];
      if (counts[c] > 0) {
        result[i] = "near";
        counts[c]--;
      } else {
        result[i] = "miss";
      }
    }
    return result;
  }

  function isSolved(scoreArr) {
    for (var i = 0; i < scoreArr.length; i++) {
      if (scoreArr[i] !== "hit") return false;
    }
    return true;
  }

  /* Merge a guess's letter verdicts into a keyboard state, keeping the best
   * status seen for each key (hit > near > miss). */
  function mergeKeyStates(keyStates, guess, scoreArr) {
    var rank = { miss: 1, near: 2, hit: 3 };
    for (var i = 0; i < guess.length; i++) {
      var k = guess[i];
      var cur = keyStates[k];
      if (!cur || rank[scoreArr[i]] > rank[cur]) keyStates[k] = scoreArr[i];
    }
    return keyStates;
  }

  /* Loot awarded for cracking a vault.
   *   base scales with word length; speed (rows left) and a quiet alarm pay more.
   *   combo multiplier is applied last and rounded.
   */
  function crackLoot(opts) {
    var len = opts.len;
    var rowsLeft = opts.rowsLeft || 0;        // unused guess rows
    var alarmLeft = opts.alarmLeft || 0;      // unused alarm pips
    var seconds = opts.seconds || 0;          // time taken (s)
    var combo = opts.combo || 1;
    var base = 20 * len;                      // 80 / 100 / 120
    var speed = rowsLeft * 15;
    var calm = alarmLeft * 10;
    var quick = Math.max(0, 60 - Math.floor(seconds)); // small time bonus, floors at 0
    var raw = base + speed + calm + quick;
    return Math.round(raw * combo);
  }

  var COMBO_STEPS = [1, 1.2, 1.4, 1.6, 1.8, 2];
  function comboMult(streak) {
    return COMBO_STEPS[Math.min(streak, COMBO_STEPS.length - 1)];
  }

  TUMBLER.Engine = {
    pool: pool,
    isValidWord: isValidWord,
    randomAnswer: randomAnswer,
    scoreGuess: scoreGuess,
    isSolved: isSolved,
    mergeKeyStates: mergeKeyStates,
    crackLoot: crackLoot,
    comboMult: comboMult,
    counts: function () {
      var out = {};
      ["4", "5", "6"].forEach(function (k) {
        out[k] = { answers: pool(k).answers.length, valid: pool(k).valid.length };
      });
      return out;
    },
  };
})();
