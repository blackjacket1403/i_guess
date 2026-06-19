/* TUMBLER — app.js
 * Controller + UI for a word-heist. Screens are rendered into #app and
 * overlays into #overlay. Hotseat: each crew member plays their whole vault,
 * then passes the laptop. Loot is score; gear and sabotage are bought with it.
 */
(function () {
  "use strict";
  var TUMBLER = (window.TUMBLER = window.TUMBLER || {});
  var E = TUMBLER.Engine;
  var A = TUMBLER.Audio;

  /* ---------- constants ---------- */
  var COLORS = ["#34E0A1", "#E8B24C", "#5AA9FF", "#C46BFF"]; // green, brass, blue, violet
  var VAULTS = [
    { len: 4 },
    { len: 5 },
    { len: 5 },
    { len: 6 },
    { len: 6 }, // boss
  ];
  function rowsFor(len) { return len + 1; }     // guess rows
  var JACKPOT = 50;                              // first-to-crack bonus (multiplayer)
  var BUST_FINE = 0.15;                          // fraction of loot lost on a bust

  var SHOP = {
    probe:  { name: "PROBE",  icon: "🔓", cost: 16, kind: "self", desc: "Reveal one correct slot" },
    jimmy:  { name: "JIMMY",  icon: "⏱", cost: 12, kind: "self", desc: "+1 guess (more alarm room)" },
    defuse: { name: "DEFUSE", icon: "🧯", cost: 14, kind: "self", desc: "Cool the alarm one notch" },
    decoy:  { name: "DECOY",  icon: "🛡", cost: 18, kind: "self", mp: true, desc: "Block the next sabotage on you" },
    freeze: { name: "FREEZE", icon: "❄", cost: 20, kind: "sab", mp: true, desc: "Lock a key on a rival's first guess" },
    fog:    { name: "FOG",    icon: "🌫", cost: 22, kind: "sab", mp: true, desc: "Delay a rival's next feedback" },
    plant:  { name: "PLANT",  icon: "🐀", cost: 14, kind: "sab", mp: true, desc: "Feed a rival a fake hint" },
  };
  var SHOP_ORDER = ["probe", "jimmy", "defuse", "decoy", "freeze", "fog", "plant"];

  var KB_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

  /* ---------- state ---------- */
  var S = null;            // game state, null on home
  var settings = loadSettings();
  var stats = loadStats();
  var timerHandle = null;

  /* ---------- tiny dom helpers ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function appEl() { return $("#app"); }
  function overlayEl() { return $("#overlay"); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function now() { return Date.now(); }

  /* ---------- persistence ---------- */
  function loadSettings() {
    try { return Object.assign({ sound: false, motion: true }, JSON.parse(localStorage.getItem("tumbler.settings") || "{}")); }
    catch (e) { return { sound: false, motion: true }; }
  }
  function saveSettings() { try { localStorage.setItem("tumbler.settings", JSON.stringify(settings)); } catch (e) {} }
  function loadStats() {
    try { return Object.assign({ bestLoot: 0, heists: 0, names: ["", "", "", ""] }, JSON.parse(localStorage.getItem("tumbler.stats") || "{}")); }
    catch (e) { return { bestLoot: 0, heists: 0, names: ["", "", "", ""] }; }
  }
  function saveStats() { try { localStorage.setItem("tumbler.stats", JSON.stringify(stats)); } catch (e) {} }

  /* ---------- toast / feed ---------- */
  var toastTimer = null;
  function toast(msg, kind) {
    var t = $("#toast");
    t.className = "toast show" + (kind ? " " + kind : "");
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = "toast"; }, 2200);
  }
  function feed(msg) {
    if (!S) return;
    S.feed.unshift(msg);
    if (S.feed.length > 8) S.feed.pop();
    var f = $(".feed");
    if (f) f.innerHTML = S.feed.map(function (m) { return '<div class="feed-item">' + m + "</div>"; }).join("");
  }

  /* ====================================================================
   *  HOME
   * ==================================================================== */
  function renderHome() {
    S = null;
    stopTimer();
    overlayEl().className = "overlay";
    overlayEl().innerHTML = "";
    var c = E.counts();
    var html =
      '<section class="screen home">' +
        '<div class="home-inner">' +
          dialSVG(0.62, { big: true }) +
          '<div class="home-copy">' +
            '<h1 class="display home-title">Crack the word.<br><span class="accent">Rob your crew.</span></h1>' +
            '<p class="lede">A word-heist for one to four. Crack escalating vaults, bank the loot, and spend it to gear up — or to freeze, fog, and bluff the friends sitting next to you. Pass the laptop and take turns.</p>' +
            '<div class="home-config">' +
              '<div class="cfg-row"><span class="cfg-label">CREW</span>' + seg("crew", ["1", "2", "3", "4"], String(S0.crew)) + "</div>" +
              '<div class="cfg-row"><span class="cfg-label">JOB</span>' + seg("mode", ["Heist Run", "Quick Crack"], S0.mode) + "</div>" +
              '<div class="crew-names" id="crew-names"></div>' +
              '<button class="btn btn--primary cta" id="start">ASSEMBLE CREW ▸</button>' +
            "</div>" +
          "</div>" +
        "</div>" +
        '<div class="best-strip">' +
          '<span>BEST HAUL <b>⛁ ' + stats.bestLoot + "</b></span>" +
          '<span>HEISTS PULLED <b>' + stats.heists + "</b></span>" +
          '<span>VAULT BANK <b>' + (c["4"].valid + c["5"].valid + c["6"].valid) + " words</b></span>" +
        "</div>" +
      "</section>";
    appEl().innerHTML = html;
    renderCrewNames();
    $("#start").addEventListener("click", startGame);
  }

  // home selections persist across re-renders within a session
  var S0 = { crew: 1, mode: "Heist Run" };

  function seg(name, opts, active) {
    return '<div class="seg" data-seg="' + name + '">' +
      opts.map(function (o) {
        return '<button class="seg-opt' + (o === active ? " active" : "") + '" data-val="' + esc(o) + '">' + esc(o) + "</button>";
      }).join("") + "</div>";
  }

  function renderCrewNames() {
    var wrap = $("#crew-names");
    if (!wrap) return;
    var n = S0.crew;
    var inputs = "";
    for (var i = 0; i < n; i++) {
      var ph = n === 1 ? "Your alias" : "Crew #" + (i + 1);
      var val = stats.names[i] || "";
      inputs += '<input class="crew-input" data-i="' + i + '" maxlength="12" placeholder="' + ph + '" value="' + esc(val) + '" style="--pc:' + COLORS[i] + '">';
    }
    wrap.innerHTML = inputs;
  }

  // delegated handling for the home segmented controls
  document.addEventListener("click", function (ev) {
    var opt = ev.target.closest && ev.target.closest(".seg-opt");
    if (opt) {
      var seg = opt.parentElement.getAttribute("data-seg");
      if (seg === "crew") { S0.crew = parseInt(opt.getAttribute("data-val"), 10); renderHome(); }
      else if (seg === "mode") { S0.mode = opt.getAttribute("data-val"); renderHome(); }
    }
  });

  function startGame() {
    // capture names
    var names = [];
    var fields = appEl().querySelectorAll(".crew-input");
    for (var i = 0; i < fields.length; i++) {
      var v = fields[i].value.trim();
      names.push(v);
      stats.names[i] = v;
    }
    saveStats();

    var crew = S0.crew;
    var mode = S0.mode === "Quick Crack" ? "quick" : "run";
    var plan = mode === "quick" ? [{ len: 5 }] : VAULTS.slice();

    var players = [];
    for (var p = 0; p < crew; p++) {
      players.push({
        id: "p" + p,
        name: names[p] || (crew === 1 ? "You" : "Crew " + (p + 1)),
        color: COLORS[p],
        loot: 0,
        streak: 0,
        cracks: 0,
        busts: 0,
        flags: { ghost: false, ace: false },
      });
    }

    S = {
      mode: mode,
      crew: crew,
      plan: plan,
      players: players,
      vaultIdx: -1,
      order: [],
      ptr: 0,
      boards: {},
      firstCracker: null,
      feed: [],
    };
    if (A) A.whoosh();
    nextVault();
  }

  /* ====================================================================
   *  VAULT / ROUND SETUP
   * ==================================================================== */
  function nextVault() {
    S.vaultIdx++;
    if (S.vaultIdx >= S.plan.length) return endGame();

    var len = S.plan[S.vaultIdx].len;
    var rows = rowsFor(len);
    var used = new Set();
    S.boards = {};
    S.players.forEach(function (pl) {
      var ans = E.randomAnswer(len, used);
      used.add(ans);
      S.boards[pl.id] = {
        answer: ans,
        len: len,
        rows: rows,
        alarmMax: rows,
        alarm: 0,
        guesses: [],          // {word, score, fogged, revealed}
        revealed: new Set(),  // probe-revealed positions
        solved: false,
        busted: false,
        startTime: 0,
        solveTime: 0,
        bought: [],           // labels of gear bought this vault (self)
        sabotaged: false,     // was hit by a sabotage this vault
        effects: { frozenKey: null, fog: 0, decoy: false },
        pending: [],          // queued incoming sabotage {type,label,by}
      };
    });

    // rotate who goes first each vault to balance sabotage turn-order
    var ord = S.players.map(function (p) { return p.id; });
    var shift = S.vaultIdx % ord.length;
    S.order = ord.slice(shift).concat(ord.slice(0, shift));
    S.ptr = 0;
    S.firstCracker = null;
    S.current = "";

    if (S.crew === 1) {
      beginTurn();
    } else {
      passScreen();
    }
  }

  function activeId() { return S.order[S.ptr]; }
  function activePlayer() { return playerById(activeId()); }
  function activeBoard() { return S.boards[activeId()]; }
  function playerById(id) { return S.players.filter(function (p) { return p.id === id; })[0]; }

  function beginTurn() {
    var b = activeBoard();
    // clear last-turn transient state, then apply queued sabotage
    b.effects.frozenKey = null;
    b.effects.fog = 0;
    var hint = null;
    var pend = b.pending; b.pending = [];
    pend.forEach(function (s) {
      if (b.effects.decoy) { b.effects.decoy = false; feed("🛡 " + activePlayer().name + "'s decoy ate " + s.by + "'s " + s.label); b.sabotaged = false; return; }
      b.sabotaged = true;
      if (s.type === "freeze") b.effects.frozenKey = pickFreezeKey(b);
      else if (s.type === "fog") b.effects.fog = 1;
      else if (s.type === "plant") hint = fakeHint(b);
    });
    b.startTime = now();
    S.current = "";
    renderPlay();
    startTimer();
    if (hint) toast("🐀 Intel: " + hint, "warn");
    if (b.effects.frozenKey) toast("❄ " + b.effects.frozenKey.toUpperCase() + " is frozen for your first guess", "warn");
    if (b.effects.fog) toast("🌫 Your next feedback will be jammed", "warn");
  }

  function pickFreezeKey(b) {
    var known = computeKeyStates(b);
    var cands = [];
    for (var i = 0; i < 26; i++) {
      var ch = String.fromCharCode(97 + i);
      if (known[ch] !== "hit") cands.push(ch); // don't freeze an already-placed letter
    }
    return cands[Math.floor(Math.random() * cands.length)];
  }
  function fakeHint(b) {
    var ch = String.fromCharCode(97 + Math.floor(Math.random() * 26));
    var pos = Math.floor(Math.random() * b.len) + 1;
    return 'there might be a "' + ch.toUpperCase() + '" in slot ' + pos;
  }

  /* ====================================================================
   *  PLAY SCREEN
   * ==================================================================== */
  function computeKeyStates(b) {
    var ks = {};
    b.guesses.forEach(function (g) {
      if (g.fogged && !g.revealed) return; // hidden feedback doesn't tint keys yet
      E.mergeKeyStates(ks, g.word, g.score);
    });
    return ks;
  }

  function renderPlay() {
    var b = activeBoard();
    var pl = activePlayer();
    var vlabel = (S.mode === "quick" ? "QUICK CRACK" : "VAULT " + (S.vaultIdx + 1) + " / " + S.plan.length);
    appEl().innerHTML =
      '<section class="screen play">' +
        '<div class="play-main">' +
          '<div class="vault-head">' +
            '<div class="vhl"><div class="vault-label">' + vlabel + '</div><div class="vault-sub">' + b.len + " DIGITS · " + (b.rows - b.guesses.length) + " GUESSES LEFT</div></div>" +
            '<div class="turn-chip" style="--pc:' + pl.color + '">' + (S.crew > 1 ? esc(pl.name) + "'S TURN" : "ON THE CLOCK") + "</div>" +
            '<button class="gear-btn" id="gear">GEAR ⚙ <b>⛁ ' + pl.loot + "</b></button>" +
          "</div>" +
          probeHint(b) +
          '<div class="grid" id="grid">' + gridRows(b) + "</div>" +
          effBar(b) +
          '<div class="kb" id="kb">' + keyboard(b) + "</div>" +
        "</div>" +
        crewRail() +
      "</section>";
    bindPlay();
    updateTimerDisplay();
  }

  function probeHint(b) {
    if (!b.revealed.size) return '<div class="probe-hint empty">no intel yet — buy a PROBE to reveal a slot</div>';
    var slots = "";
    for (var i = 0; i < b.len; i++) {
      var on = b.revealed.has(i);
      slots += '<span class="probe-slot' + (on ? " on" : "") + '">' + (on ? b.answer[i].toUpperCase() : "·") + "</span>";
    }
    return '<div class="probe-hint">INTEL ' + slots + "</div>";
  }

  function gridRows(b) {
    var html = "";
    for (var r = 0; r < b.rows; r++) {
      var g = b.guesses[r];
      var isCurrent = !b.solved && !b.busted && r === b.guesses.length;
      html += '<div class="grid-row' + (g && g.justFlipped ? " flip" : "") + '">';
      for (var i = 0; i < b.len; i++) {
        if (g) {
          var hideFx = g.fogged && !g.revealed;
          var cls = hideFx ? "fog" : g.score[i];
          html += '<div class="tile filled ' + cls + '" style="--d:' + i + '">' + g.word[i].toUpperCase() + "</div>";
        } else if (isCurrent) {
          var ch = S.current[i] || "";
          html += '<div class="tile' + (ch ? " active" : "") + '">' + (ch ? ch.toUpperCase() : "") + "</div>";
        } else {
          html += '<div class="tile"></div>';
        }
      }
      html += "</div>";
      if (g) g.justFlipped = false;
    }
    return html;
  }

  function effBar(b) {
    var chips = [];
    if (b.effects.frozenKey) chips.push('<span class="eff frost">❄ ' + b.effects.frozenKey.toUpperCase() + " frozen</span>");
    if (b.effects.fog) chips.push('<span class="eff fogc">🌫 feedback jammed</span>');
    if (b.effects.decoy) chips.push('<span class="eff dec">🛡 decoy armed</span>');
    if (!chips.length) return '<div class="effbar"></div>';
    return '<div class="effbar">' + chips.join("") + "</div>";
  }

  function keyboard(b) {
    var ks = computeKeyStates(b);
    var html = "";
    KB_ROWS.forEach(function (row, ri) {
      html += '<div class="kb-row">';
      if (ri === 2) html += '<button class="key wide" data-k="enter">ENTER</button>';
      for (var i = 0; i < row.length; i++) {
        var ch = row[i];
        var st = ks[ch] || "";
        var frozen = b.effects.frozenKey === ch ? " frozen" : "";
        html += '<button class="key ' + st + frozen + '" data-k="' + ch + '">' + ch.toUpperCase() + "</button>";
      }
      if (ri === 2) html += '<button class="key wide" data-k="back">⌫</button>';
      html += "</div>";
    });
    return html;
  }

  function crewRail() {
    var cards = S.players.map(function (pl) {
      var b = S.boards[pl.id];
      var isActive = pl.id === activeId();
      var status = b.solved ? "CRACKED" : b.busted ? "BUSTED" : (S.order.indexOf(pl.id) < S.ptr ? "DONE" : (isActive ? "▶ CRACKING" : "WAITING"));
      var pips = "";
      for (var i = 0; i < b.alarmMax; i++) pips += '<span class="pip' + (i < b.alarm ? " on" : "") + '"></span>';
      return '<div class="crew-card' + (isActive ? " active" : "") + (b.solved ? " solved" : "") + (b.busted ? " busted" : "") + '" style="--pc:' + pl.color + '">' +
        '<div class="cc-top"><span class="crew-name">' + esc(pl.name) + "</span>" + (pl.streak > 1 ? '<span class="combo">×' + E.comboMult(pl.streak - 1) + "</span>" : "") + "</div>" +
        '<div class="crew-loot">⛁ ' + pl.loot + "</div>" +
        '<div class="alarm" title="alarm">' + pips + "</div>" +
        '<div class="crew-status">' + status + "</div>" +
        "</div>";
    }).join("");
    var title = S.crew === 1 ? "STATUS" : "CREW";
    return '<aside class="crew">' +
      "<h3>" + title + ' <span class="timer" id="timer">0:00</span></h3>' +
      '<div class="crew-cards">' + cards + "</div>" +
      '<div class="feed-wrap"><div class="feed-title">HEIST FEED</div><div class="feed">' + S.feed.map(function (m) { return '<div class="feed-item">' + m + "</div>"; }).join("") + "</div></div>" +
      "</aside>";
  }

  /* ---------- input ---------- */
  function bindPlay() {
    var kb = $("#kb");
    kb.addEventListener("click", function (ev) {
      var key = ev.target.closest(".key");
      if (!key) return;
      handleKey(key.getAttribute("data-k"));
    });
    $("#gear").addEventListener("click", openShop);
  }

  function handleKey(k) {
    var b = activeBoard();
    if (!b || b.solved || b.busted) return;
    if (overlayEl().classList.contains("show")) return;
    if (k === "enter") return submitGuess();
    if (k === "back") { S.current = S.current.slice(0, -1); return refreshCurrentRow(); }
    if (/^[a-z]$/.test(k)) {
      if (b.effects.frozenKey === k) { toast("❄ " + k.toUpperCase() + " is frozen this guess", "warn"); flashFrozen(); return; }
      if (S.current.length < b.len) { S.current += k; if (A) A.key(); refreshCurrentRow(); }
    }
  }

  function flashFrozen() {
    var fk = $('#kb .key.frozen');
    if (fk) { fk.classList.remove("shake"); void fk.offsetWidth; fk.classList.add("shake"); }
  }

  function refreshCurrentRow() {
    var b = activeBoard();
    var rows = $("#grid").children;
    var idx = b.guesses.length;
    var row = rows[idx];
    if (!row) return;
    for (var i = 0; i < b.len; i++) {
      var ch = S.current[i] || "";
      var tile = row.children[i];
      tile.textContent = ch ? ch.toUpperCase() : "";
      tile.className = "tile" + (ch ? " active" : "");
    }
  }

  function submitGuess() {
    var b = activeBoard();
    var word = S.current;
    if (word.length < b.len) { shakeRow("not enough letters"); return; }
    if (!E.isValidWord(word)) { shakeRow("not in the dictionary"); if (A) A.error(); return; }

    // reveal any previously-fogged guess now (one-guess feedback delay)
    b.guesses.forEach(function (g) { if (g.fogged) g.revealed = true; });

    var score = E.scoreGuess(word, b.answer);
    var solved = E.isSolved(score);
    var fogged = b.effects.fog > 0;
    b.guesses.push({ word: word, score: score, fogged: fogged, revealed: false, justFlipped: true });
    if (b.effects.fog > 0) b.effects.fog--;
    b.effects.frozenKey = null; // freeze was a one-guess lock
    S.current = "";

    renderPlay();
    if (solved) onSolve(b);
    else onWrong(b);
  }

  function onSolve(b) {
    var pl = activePlayer();
    var secs = (now() - b.startTime) / 1000;
    var rowsLeft = b.rows - b.guesses.length;
    var alarmLeft = b.alarmMax - b.alarm;
    var combo = E.comboMult(pl.streak);
    var loot = E.crackLoot({ len: b.len, rowsLeft: rowsLeft, alarmLeft: alarmLeft, seconds: secs, combo: combo });
    b.solved = true;
    b.solveTime = secs;
    pl.loot += loot;
    pl.streak++;
    pl.cracks++;
    if (b.alarm === 0) pl.flags.ghost = true;
    if (b.guesses.length <= 2) pl.flags.ace = true;
    var jack = 0;
    if (!S.firstCracker && S.crew > 1) { S.firstCracker = pl.id; jack = JACKPOT; pl.loot += jack; }
    stopTimer();
    if (A) { A.crack(); setTimeout(function () { A.loot(); }, 320); }
    crackAnim();
    feed('<b style="color:' + pl.color + '">' + esc(pl.name) + "</b> cracked it · +⛁" + loot + (jack ? " 🏆+" + jack : "") + (combo > 1 ? " (×" + combo + ")" : ""));
    setTimeout(endTurn, 950);
  }

  function onWrong(b) {
    var pl = activePlayer();
    b.alarm++;
    var busted = b.alarm >= b.alarmMax || b.guesses.length >= b.rows;
    if (busted) {
      b.busted = true;
      var fine = Math.round(pl.loot * BUST_FINE);
      pl.loot = Math.max(0, pl.loot - fine);
      pl.streak = 0;
      pl.busts++;
      stopTimer();
      if (A) A.bust();
      bustAnim();
      feed('<b style="color:' + pl.color + '">' + esc(pl.name) + "</b> tripped the alarm — vault locked" + (fine ? " · −⛁" + fine : ""));
      setTimeout(endTurn, 1100);
    } else {
      if (A) { A.error(); if (b.alarm >= b.alarmMax - 1) A.alarm(); }
      if (b.alarm >= b.alarmMax - 1) toast("⚠ alarm almost maxed!", "bad");
    }
  }

  function endTurn() {
    // advance to next player who still has a turn this vault
    S.ptr++;
    if (S.ptr >= S.order.length) return endRound();
    if (S.crew === 1) beginTurn();
    else passScreen();
  }

  /* ====================================================================
   *  PASS SCREEN (hotseat hand-off)
   * ==================================================================== */
  function passScreen() {
    var pl = activePlayer();
    stopTimer();
    var ov = overlayEl();
    ov.innerHTML =
      '<div class="panel pass-panel" style="--pc:' + pl.color + '">' +
        dialSVG(0.5, {}) +
        '<div class="pass-vault">VAULT ' + (S.vaultIdx + 1) + " / " + S.plan.length + "</div>" +
        '<h2 class="display">Pass the laptop to<br><span class="accent" style="color:' + pl.color + '">' + esc(pl.name) + "</span></h2>" +
        '<p class="muted">No peeking. Each crew member cracks their own vault.</p>' +
        '<button class="btn btn--primary" id="pass-go">I\'M ' + esc(pl.name.toUpperCase()) + " — READY ▸</button>" +
      "</div>";
    ov.className = "overlay show";
    $("#pass-go").addEventListener("click", function () {
      ov.className = "overlay";
      ov.innerHTML = "";
      if (A) A.whoosh();
      beginTurn();
    });
  }

  /* ====================================================================
   *  SHOP
   * ==================================================================== */
  function openShop() {
    var b = activeBoard();
    if (b.solved || b.busted) return;
    var pl = activePlayer();
    var ov = overlayEl();
    // who can still be sabotaged this vault? players later in the order, not done
    var targets = S.order.slice(S.ptr + 1).map(playerById).filter(function (t) { return !S.boards[t.id].solved && !S.boards[t.id].busted; });

    var items = SHOP_ORDER.filter(function (key) {
      var it = SHOP[key];
      if (it.mp && S.crew === 1) return false;
      return true;
    }).map(function (key) {
      var it = SHOP[key];
      var afford = pl.loot >= it.cost;
      var needTarget = it.kind === "sab";
      var disabled = !afford || (needTarget && !targets.length);
      var why = !afford ? "not enough loot" : (needTarget && !targets.length ? "no rivals left this vault" : "");
      return '<button class="shop-item' + (disabled ? " disabled" : "") + '" data-item="' + key + '" ' + (disabled ? "disabled" : "") + '>' +
        '<span class="si-icon">' + it.icon + "</span>" +
        '<span class="si-body"><span class="si-name">' + it.name + (it.kind === "sab" ? ' <em class="sab-tag">sabotage</em>' : "") + "</span>" +
        '<span class="si-desc">' + it.desc + (why ? ' <em class="si-why">· ' + why + "</em>" : "") + "</span></span>" +
        '<span class="shop-cost">⛁ ' + it.cost + "</span>" +
        "</button>";
    }).join("");

    var targetUI = (S.crew > 1)
      ? '<div class="target-select"><span>SABOTAGE TARGET</span><div class="target-opts" id="target-opts">' +
          (targets.length ? targets.map(function (t, i) {
            return '<button class="target-opt' + (i === 0 ? " active" : "") + '" data-tid="' + t.id + '" style="--pc:' + t.color + '">' + esc(t.name) + "</button>";
          }).join("") : '<span class="muted">no rivals left this vault</span>') +
          "</div></div>"
      : "";

    ov.innerHTML =
      '<div class="panel shop-panel">' +
        '<div class="shop-head"><h2 class="display">GEAR SHOP</h2><span class="shop-bank">⛁ ' + pl.loot + " loot</span></div>" +
        '<p class="muted">Spend your haul to gear up — or burn it to wreck a rival.</p>' +
        targetUI +
        '<div class="shop-grid">' + items + "</div>" +
        '<button class="btn btn--ghost" id="shop-close">BACK TO THE VAULT</button>' +
      "</div>";
    ov.className = "overlay show";

    var chosenTarget = targets.length ? targets[0].id : null;
    var topts = $("#target-opts");
    if (topts) topts.addEventListener("click", function (ev) {
      var o = ev.target.closest(".target-opt");
      if (!o) return;
      chosenTarget = o.getAttribute("data-tid");
      Array.prototype.forEach.call(topts.children, function (c) { c.classList.toggle("active", c === o); });
    });

    ov.querySelector(".shop-grid").addEventListener("click", function (ev) {
      var btn = ev.target.closest(".shop-item");
      if (!btn || btn.disabled) return;
      buy(btn.getAttribute("data-item"), chosenTarget);
    });
    $("#shop-close").addEventListener("click", closeShop);
  }
  function closeShop() {
    overlayEl().className = "overlay";
    overlayEl().innerHTML = "";
    renderPlay();
  }

  function buy(key, targetId) {
    var it = SHOP[key];
    var pl = activePlayer();
    var b = activeBoard();
    if (pl.loot < it.cost) return;

    if (it.kind === "sab") {
      if (!targetId) return;
      var tb = S.boards[targetId];
      var label = it.icon + " " + it.name;
      tb.pending.push({ type: key, label: label, by: pl.name });
      pl.loot -= it.cost;
      if (A) A.sabotage();
      feed('<b style="color:' + pl.color + '">' + esc(pl.name) + "</b> rigged " + it.name + " for " + esc(playerById(targetId).name));
      toast(it.icon + " " + it.name + " planted on " + playerById(targetId).name, "good");
    } else {
      // self gear
      if (key === "probe") {
        var hidden = [];
        for (var i = 0; i < b.len; i++) if (!b.revealed.has(i)) hidden.push(i);
        if (!hidden.length) { toast("every slot is already revealed", "warn"); return; }
        b.revealed.add(hidden[Math.floor(Math.random() * hidden.length)]);
      } else if (key === "jimmy") {
        b.rows++; b.alarmMax++;
      } else if (key === "defuse") {
        if (b.alarm === 0) { toast("alarm is already cold", "warn"); return; }
        b.alarm = Math.max(0, b.alarm - 1);
      } else if (key === "decoy") {
        if (b.effects.decoy) { toast("decoy already armed", "warn"); return; }
        b.effects.decoy = true;
      }
      pl.loot -= it.cost;
      b.bought.push(it.name);
      if (A) A.tick();
      toast(it.icon + " " + it.name + " — done", "good");
    }
    openShop(); // refresh shop (loot/targets/affordability)
  }

  /* ====================================================================
   *  ROUND SUMMARY (between vaults, multiplayer) / auto-advance solo
   * ==================================================================== */
  function endRound() {
    stopTimer();
    if (S.crew === 1) { return nextVault(); }
    var ov = overlayEl();
    var rows = S.players.slice().sort(function (a, b) { return b.loot - a.loot; }).map(function (pl) {
      var b = S.boards[pl.id];
      var res = b.solved ? '<span class="r-good">CRACKED “' + b.answer.toUpperCase() + "”</span>"
        : '<span class="r-bad">BUSTED — was “' + b.answer.toUpperCase() + "”</span>";
      return '<div class="standing-row" style="--pc:' + pl.color + '"><span class="sr-name">' + esc(pl.name) + (pl.id === S.firstCracker ? " 🏆" : "") + "</span>" +
        '<span class="sr-res">' + res + "</span><span class=\"sr-loot\">⛁ " + pl.loot + "</span></div>";
    }).join("");
    var last = S.vaultIdx >= S.plan.length - 1;
    ov.innerHTML =
      '<div class="panel summary-panel">' +
        '<h2 class="display">VAULT ' + (S.vaultIdx + 1) + " SEALED</h2>" +
        '<div class="standings">' + rows + "</div>" +
        '<button class="btn btn--primary" id="round-next">' + (last ? "FINAL TALLY ▸" : "CRACK VAULT " + (S.vaultIdx + 2) + " ▸") + "</button>" +
      "</div>";
    ov.className = "overlay show";
    $("#round-next").addEventListener("click", function () {
      ov.className = "overlay"; ov.innerHTML = "";
      nextVault();
    });
  }

  /* ====================================================================
   *  GAME OVER
   * ==================================================================== */
  function endGame() {
    stopTimer();
    var ranked = S.players.slice().sort(function (a, b) { return b.loot - a.loot; });
    var top = ranked[0];
    // persist
    stats.heists++;
    if (top.loot > stats.bestLoot) stats.bestLoot = top.loot;
    saveStats();

    var badges = computeBadges(ranked);
    var standings = ranked.map(function (pl, i) {
      var bs = badges[pl.id].map(function (bd) { return '<span class="badge">' + bd + "</span>"; }).join("");
      return '<div class="standing-row big" style="--pc:' + pl.color + '">' +
        '<span class="sr-rank">' + (i + 1) + "</span>" +
        '<span class="sr-name">' + esc(pl.name) + "</span>" +
        '<span class="sr-meta">cracked ' + pl.cracks + "/" + S.plan.length + (pl.busts ? " · " + pl.busts + " busts" : "") + " " + bs + "</span>" +
        '<span class="sr-loot">⛁ ' + pl.loot + "</span></div>";
    }).join("");

    var headline = S.crew === 1
      ? (top.cracks === S.plan.length ? "CLEAN GETAWAY" : "JOB DONE")
      : esc(top.name) + " TAKES THE SCORE";

    var ov = overlayEl();
    ov.innerHTML =
      '<div class="panel gameover-panel">' +
        dialSVG(1, { open: true }) +
        '<div class="go-kicker">HEIST COMPLETE</div>' +
        '<h2 class="display go-title">' + headline + "</h2>" +
        '<div class="standings">' + standings + "</div>" +
        '<div class="go-actions">' +
          '<button class="btn btn--ghost" id="go-share">COPY RESULT</button>' +
          '<button class="btn btn--ghost" id="go-home">NEW CREW</button>' +
          '<button class="btn btn--primary" id="go-again">PULL ANOTHER JOB ▸</button>' +
        "</div>" +
      "</div>";
    ov.className = "overlay show";
    if (A) { A.crack(); setTimeout(function () { A.loot(); }, 300); }
    $("#go-again").addEventListener("click", function () { ov.className = "overlay"; ov.innerHTML = ""; startGame(); });
    $("#go-home").addEventListener("click", function () { ov.className = "overlay"; ov.innerHTML = ""; renderHome(); });
    $("#go-share").addEventListener("click", function () { shareResult(ranked, badges); });
  }

  function computeBadges(ranked) {
    var out = {};
    var top = ranked[0];
    ranked.forEach(function (pl) {
      var b = [];
      if (pl.id === top.id && (S.crew > 1 || pl.cracks === S.plan.length)) b.push("👑 KINGPIN");
      if (pl.cracks === S.plan.length && pl.busts === 0) b.push("💎 FLAWLESS");
      if (pl.flags.ghost) b.push("👻 GHOST");
      if (pl.flags.ace) b.push("🎯 SAFECRACKER");
      if (pl.loot >= 800) b.push("💰 BIG SCORE");
      out[pl.id] = b;
    });
    return out;
  }

  function shareResult(ranked, badges) {
    var url = location.origin + location.pathname;
    var lines = ["🔐 TUMBLER — " + (S.mode === "quick" ? "Quick Crack" : "Heist Run")];
    ranked.forEach(function (pl) {
      lines.push((pl.id === ranked[0].id && S.crew > 1 ? "🏆 " : "") + pl.name + ": cracked " + pl.cracks + "/" + S.plan.length + " · ⛁" + pl.loot + (badges[pl.id].length ? " " + badges[pl.id].join(" ") : ""));
    });
    lines.push("crack a vault → " + url);
    var text = lines.join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("result copied — paste it in the chat", "good"); },
        function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("result copied", "good"); } catch (e) { toast("copy failed — select manually", "bad"); }
    document.body.removeChild(ta);
  }

  /* ====================================================================
   *  ANIMATIONS + TIMER
   * ==================================================================== */
  function crackAnim() {
    if (!settings.motion) return;
    var grid = $("#grid");
    if (grid) { grid.classList.remove("cracked"); void grid.offsetWidth; grid.classList.add("cracked"); }
  }
  function bustAnim() {
    if (!settings.motion) return;
    var play = $(".play");
    if (play) { play.classList.remove("bust"); void play.offsetWidth; play.classList.add("bust"); }
  }
  function shakeRow(msg) {
    if (msg) toast(msg, "bad");
    var b = activeBoard();
    var row = $("#grid").children[b.guesses.length];
    if (row && settings.motion) { row.classList.remove("shake"); void row.offsetWidth; row.classList.add("shake"); }
  }

  function startTimer() {
    stopTimer();
    timerHandle = setInterval(updateTimerDisplay, 250);
  }
  function stopTimer() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } }
  function updateTimerDisplay() {
    var t = $("#timer");
    if (!t || !S) return;
    var b = activeBoard();
    if (!b || !b.startTime) { t.textContent = "0:00"; return; }
    var secs = Math.floor((now() - b.startTime) / 1000);
    var m = Math.floor(secs / 60), s = secs % 60;
    t.textContent = m + ":" + (s < 10 ? "0" : "") + s;
  }

  /* ====================================================================
   *  DIAL SIGNATURE (svg)
   * ==================================================================== */
  function dialSVG(progress, opts) {
    opts = opts || {};
    var ticks = 36;
    var on = Math.round(progress * ticks);
    var marks = "";
    for (var i = 0; i < ticks; i++) {
      var ang = (i / ticks) * Math.PI * 2 - Math.PI / 2;
      var r1 = 86, r2 = i % 3 === 0 ? 70 : 76;
      var x1 = 100 + Math.cos(ang) * r1, y1 = 100 + Math.sin(ang) * r1;
      var x2 = 100 + Math.cos(ang) * r2, y2 = 100 + Math.sin(ang) * r2;
      marks += '<line class="dt' + (i < on ? " hot" : "") + '" x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>';
    }
    var cls = "dial" + (opts.big ? " dial--big" : "") + (opts.open ? " dial--open" : "");
    return '<div class="' + cls + '"><svg viewBox="0 0 200 200" aria-hidden="true">' +
      '<circle class="dial-rim" cx="100" cy="100" r="92"/>' +
      '<circle class="dial-face" cx="100" cy="100" r="64"/>' +
      marks +
      '<g class="dial-knob"><circle cx="100" cy="100" r="46"/>' +
      '<line class="dial-grip" x1="100" y1="62" x2="100" y2="100"/>' +
      '<circle class="dial-hub" cx="100" cy="100" r="7"/></g>' +
      '<text class="dial-num" x="100" y="150" text-anchor="middle">' + Math.round(progress * 99) + "</text>" +
      "</svg></div>";
  }

  /* ====================================================================
   *  TOP BAR + GLOBAL KEYS + BOOT
   * ==================================================================== */
  function bindTopbar() {
    $("#btn-how").addEventListener("click", openHow);
    var sb = $("#btn-sound");
    function paint() { sb.innerHTML = "SOUND " + (settings.sound ? "◉" : "◎"); sb.classList.toggle("on", settings.sound); }
    paint();
    sb.addEventListener("click", function () {
      settings.sound = !settings.sound; saveSettings();
      if (A) { A.setEnabled(settings.sound); if (settings.sound) A.tick(); }
      paint();
    });
    $(".brand").addEventListener("click", function () { if (S) { if (confirm("Abandon the heist and return home?")) renderHome(); } });
  }

  function openHow() {
    var ov = overlayEl();
    ov.innerHTML =
      '<div class="panel how-panel">' +
        '<h2 class="display">HOW TO PULL IT OFF</h2>' +
        '<ol class="how-list">' +
          "<li><b>Crack the vault.</b> Guess the hidden word. A <span class=\"chip hit\">pin set</span> is the right letter in the right slot; a <span class=\"chip near\">loose pin</span> is in the word, wrong slot; <span class=\"chip miss\">dead</span> isn't in it.</li>" +
          "<li><b>Mind the alarm.</b> Every wrong guess trips it one notch. Max it out and the vault locks — you lose the haul and your combo.</li>" +
          "<li><b>Bank the loot ⛁.</b> Crack fast, with guesses and a quiet alarm to spare, for a bigger payout. Cracking vault after vault builds a combo multiplier.</li>" +
          "<li><b>Spend it in the GEAR shop.</b> Buy a PROBE, JIMMY or DEFUSE to help yourself — or burn loot to FREEZE, FOG and PLANT fake intel on a rival's run. A DECOY blocks the next hit.</li>" +
          "<li><b>Take turns.</b> On a crew job, pass the laptop. Each player cracks their own vault; first to crack each one grabs the 🏆 jackpot. Most loot after five vaults wins.</li>" +
        "</ol>" +
        '<button class="btn btn--primary" id="how-close">GOT IT</button>' +
      "</div>";
    ov.className = "overlay show";
    $("#how-close").addEventListener("click", function () { ov.className = "overlay"; ov.innerHTML = ""; });
  }

  document.addEventListener("keydown", function (ev) {
    if (!S) return;
    if (overlayEl().classList.contains("show")) {
      if (ev.key === "Enter") { var pg = $("#pass-go") || $("#round-next") || $("#how-close"); if (pg) pg.click(); }
      return;
    }
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var k = ev.key;
    if (k === "Enter") { ev.preventDefault(); handleKey("enter"); }
    else if (k === "Backspace") { ev.preventDefault(); handleKey("back"); }
    else if (/^[a-zA-Z]$/.test(k)) { handleKey(k.toLowerCase()); }
  });

  function boot() {
    if (!window.TUMBLER_WORDS) {
      appEl().innerHTML = '<section class="screen"><div class="panel"><h2>Word vault failed to load</h2><p class="muted">Make sure <code>js/words.js</code> is present.</p></div></section>';
      return;
    }
    if (A) A.setEnabled(settings.sound);
    // honour OS reduced-motion as the default unless user toggled
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) settings.motion = false;
    bindTopbar();
    renderHome();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
