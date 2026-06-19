/* TUMBLER — online.js
 * Live online rooms over TUMBLER.Net. Everyone races the SAME vault word
 * (derived locally from a shared seed, never sent over the wire), on their own
 * device, with a live crew HUD and real-time sabotage. Reuses the play-screen
 * markup/classes from styles.css.
 */
(function () {
  "use strict";
  var TUMBLER = (window.TUMBLER = window.TUMBLER || {});
  var E = TUMBLER.Engine;
  var A = TUMBLER.Audio;
  var Net = TUMBLER.Net;

  var COLORS = ["#34E0A1", "#E8B24C", "#5AA9FF", "#C46BFF"];
  var VAULT_LENS = [4, 5, 5, 6, 6];
  var JACKPOT = 50, BUST_FINE = 0.15;
  var KB_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
  var SHOP = {
    probe:  { name: "PROBE",  icon: "🔓", cost: 16, kind: "self", desc: "Reveal one correct slot" },
    jimmy:  { name: "JIMMY",  icon: "⏱", cost: 12, kind: "self", desc: "+1 guess (more alarm room)" },
    defuse: { name: "DEFUSE", icon: "🧯", cost: 14, kind: "self", desc: "Cool the alarm one notch" },
    decoy:  { name: "DECOY",  icon: "🛡", cost: 18, kind: "self", desc: "Block the next sabotage on you" },
    freeze: { name: "FREEZE", icon: "❄", cost: 20, kind: "sab", desc: "Lock a key on a rival's next guess" },
    fog:    { name: "FOG",    icon: "🌫", cost: 22, kind: "sab", desc: "Jam a rival's next feedback" },
    plant:  { name: "PLANT",  icon: "🐀", cost: 14, kind: "sab", desc: "Feed a rival a fake hint" },
  };
  var SHOP_ORDER = ["probe", "jimmy", "defuse", "decoy", "freeze", "fog", "plant"];

  var O = null;       // online session state
  var timer = null;

  /* ---- tiny dom helpers (shared with the page) ---- */
  function $(s) { return document.querySelector(s); }
  function app() { return $("#app"); }
  function ov() { return $("#overlay"); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function toast(m, k) { if (TUMBLER.toast) TUMBLER.toast(m, k); }
  function shareLink() { return location.origin + location.pathname + "?room=" + O.roomId; }
  function demoBanner() {
    return Net.mode === "local"
      ? '<div class="demo-banner">⚠ DEMO MODE — same browser only. Add your Firebase config (<code>js/firebase-config.js</code>) for real cross-device play.</div>'
      : "";
  }

  /* ====================================================================
   *  ENTRY MENU  (Create / Join)
   * ==================================================================== */
  function menu(opts) {
    opts = opts || {};
    teardown();
    var lastName = "";
    try { lastName = (JSON.parse(localStorage.getItem("tumbler.stats") || "{}").names || [])[0] || ""; } catch (e) {}
    app().innerHTML =
      '<section class="screen online-menu">' +
        '<div class="panel online-panel">' +
          '<h2 class="display">PLAY ONLINE</h2>' +
          '<p class="muted">Everyone on their own screen, live. Make a room, drop the link in your Meet chat, and crack together.</p>' +
          demoBanner() +
          '<label class="fld"><span>YOUR ALIAS</span><input id="on-name" class="crew-input" maxlength="12" placeholder="Your alias" value="' + esc(lastName) + '" style="--pc:' + COLORS[0] + '"></label>' +
          '<button class="btn btn--primary block" id="on-create">CREATE A ROOM ▸</button>' +
          '<div class="or-line"><span>or join one</span></div>' +
          '<div class="join-row"><input id="on-code" class="crew-input code-input" maxlength="4" placeholder="CODE" value="' + esc(opts.join || "") + '"><button class="btn btn--ghost" id="on-join">JOIN</button></div>' +
          '<button class="btn btn--ghost block back" id="on-back">← BACK</button>' +
        "</div>" +
      "</section>";
    $("#on-create").addEventListener("click", function () { createRoom(nameVal()); });
    $("#on-join").addEventListener("click", function () {
      var code = ($("#on-code").value || "").trim().toUpperCase();
      if (code.length < 3) { toast("enter a room code", "bad"); return; }
      joinRoom(code, nameVal());
    });
    $("#on-back").addEventListener("click", function () { teardown(); if (TUMBLER.goHome) TUMBLER.goHome(); });
    if (opts.join) $("#on-name").focus();
  }
  function nameVal() { var v = ($("#on-name") && $("#on-name").value || "").trim(); return v.slice(0, 12); }

  /* ====================================================================
   *  CREATE / JOIN
   * ==================================================================== */
  function freshSession() {
    return { active: true, meId: Net.genId(), roomId: null, name: "", color: COLORS[0], isHost: false,
      joined: false, room: {}, board: null, current: "", vaultIdx: -1, streak: 0,
      applied: {}, overShown: false, advancing: false, tallied: false };
  }

  function createRoom(name) {
    O = freshSession();
    O.name = name || "Host";
    O.isHost = true; O.joined = true; O.color = COLORS[0];
    O.roomId = Net.genCode();
    var seed = (Math.floor(Math.random() * 0xffffffff)) >>> 0;
    Net.open(O.roomId);
    Net.onRoom(onRoom);
    Net.update("meta", { host: O.meId, status: "lobby", seed: seed, mode: "run", createdAt: Date.now() });
    Net.update("players/" + O.meId, seatRecord(O.name, 0));
    Net.onDisconnectRemove("players/" + O.meId);
    setUrl(O.roomId);
    if (A) A.whoosh();
  }

  function joinRoom(code, name) {
    O = freshSession();
    O.name = name || "Crew";
    O.roomId = code;
    Net.open(O.roomId);
    Net.onRoom(onRoom);
    setUrl(O.roomId);
    if (A) A.whoosh();
  }
  function joinFromLink(code) { menu({ join: code }); }

  function seatRecord(name, idx) {
    return { name: name || ("Crew " + (idx + 1)), idx: idx, color: COLORS[idx], loot: 0, cracks: 0, busts: 0,
      ready: true, joinedAt: Date.now(), vault: { idx: -1, alarm: 0, guessesUsed: 0, solved: false, busted: false },
      flags: { ghost: false, ace: false } };
  }

  function setUrl(code) {
    try { history.replaceState(null, "", location.pathname + "?room=" + code); } catch (e) {}
  }
  function clearUrl() { try { history.replaceState(null, "", location.pathname); } catch (e) {} }

  /* ====================================================================
   *  ROOM SNAPSHOT ROUTER
   * ==================================================================== */
  function onRoom(room) {
    if (!O || !O.active) return;
    O.room = room || {};
    var meta = O.room.meta;
    if (!meta) {
      if (O.isHost) return;        // our own create hasn't landed yet
      return roomNotFound();
    }
    // seat ourselves on first valid snapshot (joiners)
    if (!O.joined) return seatSelf();

    if (meta.status === "lobby") { renderLobby(); }
    else if (meta.status === "playing") { onPlaying(); }
    else if (meta.status === "over") { renderOver(); }
  }

  function roomNotFound() {
    toast("room " + O.roomId + " not found", "bad");
    teardown();
    menu({});
  }

  function seatSelf() {
    var players = O.room.players || {};
    var ids = Object.keys(players);
    if (ids.length >= 4) { toast("room is full (4 max)", "bad"); teardown(); menu({}); return; }
    var used = {};
    ids.forEach(function (id) { used[players[id].idx] = true; });
    var idx = 0; while (used[idx] && idx < 4) idx++;
    O.color = COLORS[idx]; O.joined = true;
    Net.update("players/" + O.meId, seatRecord(O.name, idx));
    Net.onDisconnectRemove("players/" + O.meId);
    // next snapshot will route to lobby
  }

  /* ====================================================================
   *  LOBBY
   * ==================================================================== */
  function sortedPlayers() {
    var players = O.room.players || {};
    return Object.keys(players).map(function (id) { return Object.assign({ id: id }, players[id]); })
      .sort(function (a, b) { return (a.idx || 0) - (b.idx || 0); });
  }

  function renderLobby() {
    var list = sortedPlayers();
    var seats = "";
    for (var i = 0; i < 4; i++) {
      var p = list[i];
      seats += p
        ? '<div class="lobby-seat filled" style="--pc:' + p.color + '"><span class="ls-dot"></span><span class="ls-name">' + esc(p.name) + (p.id === O.meId ? " (you)" : "") + (p.id === O.room.meta.host ? " · host" : "") + "</span></div>"
        : '<div class="lobby-seat empty"><span class="ls-dot"></span><span class="ls-name">waiting…</span></div>';
    }
    var canStart = O.isHost && list.length >= 2;
    app().innerHTML =
      '<section class="screen lobby">' +
        '<div class="panel lobby-panel">' +
          '<div class="room-code"><span class="rc-label">ROOM CODE</span><span class="rc-code">' + esc(O.roomId) + "</span></div>" +
          demoBanner() +
          '<button class="btn btn--ghost block" id="lb-copy">📋 COPY INVITE LINK</button>' +
          '<div class="lobby-seats">' + seats + "</div>" +
          groupBoardHTML() +
          (O.isHost
            ? '<button class="btn btn--primary block" id="lb-start"' + (canStart ? "" : " disabled") + '>' + (canStart ? "START THE HEIST ▸" : "WAITING FOR CREW (2+)…") + "</button>"
            : '<div class="lobby-wait">Waiting for the host to start…</div>') +
          '<button class="btn btn--ghost block back" id="lb-leave">LEAVE ROOM</button>' +
        "</div>" +
      "</section>";
    $("#lb-copy").addEventListener("click", copyInvite);
    $("#lb-leave").addEventListener("click", leave);
    if (O.isHost) { var s = $("#lb-start"); if (s && canStart) s.addEventListener("click", startHeist); }
  }

  function copyInvite() {
    var link = shareLink();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(function () { toast("invite link copied — paste it in the Meet chat", "good"); },
        function () { toast(link, "warn"); });
    } else { toast(link, "warn"); }
  }

  function startHeist() {
    Net.update("meta", { status: "playing", vaultIdx: 0, startedAt: Date.now() });
  }

  /* ====================================================================
   *  PLAYING
   * ==================================================================== */
  function onPlaying() {
    var idx = O.room.meta.vaultIdx || 0;
    if (idx !== O.vaultIdx) { buildBoard(idx); renderPlay(); }
    else { processInbox(); patchCrew(); hostMaybeAdvance(); }
  }

  function buildBoard(idx) {
    var len = VAULT_LENS[idx] || 5;
    var rows = len + 1;
    O.board = {
      answer: E.seededAnswer(len, E.mixSeed(O.room.meta.seed, idx)),
      len: len, rows: rows, alarmMax: rows, alarm: 0,
      guesses: [], revealed: new Set(), solved: false, busted: false,
      startTime: Date.now(),
      effects: { frozenKey: null, fog: 0, decoy: false },
    };
    O.current = ""; O.vaultIdx = idx; O.advancing = false;
    if (idx === 0) O.tallied = false; // a fresh run can be tallied again at its end
    Net.update("players/" + O.meId + "/vault", { idx: idx, alarm: 0, guessesUsed: 0, solved: false, busted: false });
    startTimer();
  }

  function pushPublic() {
    var b = O.board;
    Net.update("players/" + O.meId + "/vault", {
      idx: O.vaultIdx, alarm: b.alarm, guessesUsed: b.guesses.length, solved: b.solved, busted: b.busted,
    });
  }

  function me() { return (O.room.players || {})[O.meId] || {}; }

  /* ---- render: play-main + crew are patched independently to avoid
         clobbering local typing on remote updates ---- */
  function renderPlay() {
    app().innerHTML =
      '<section class="screen play">' +
        '<div id="play-main" class="play-main">' + playMainHTML() + "</div>" +
        '<aside id="crew" class="crew">' + crewHTML() + "</aside>" +
      "</section>";
    bindPlayMain();
  }
  function patchPlayMain() { var el = $("#play-main"); if (el) { el.innerHTML = playMainHTML(); bindPlayMain(); } }
  function patchCrew() { var el = $("#crew"); if (el) el.innerHTML = crewHTML(); }
  function bindPlayMain() {
    var kb = $("#kb"); if (kb) kb.addEventListener("click", function (ev) { var k = ev.target.closest(".key"); if (k) handleKey(k.getAttribute("data-k")); });
    var g = $("#gear"); if (g) g.addEventListener("click", openShop);
  }

  function computeKeyStates(b) {
    var ks = {};
    b.guesses.forEach(function (g) { if (g.fogged && !g.revealed) return; E.mergeKeyStates(ks, g.word, g.score); });
    return ks;
  }

  function playMainHTML() {
    var b = O.board;
    var loot = me().loot || 0;
    var vlabel = "VAULT " + (O.vaultIdx + 1) + " / " + VAULT_LENS.length;
    var probe = b.revealed.size
      ? (function () { var s = ""; for (var i = 0; i < b.len; i++) s += '<span class="probe-slot' + (b.revealed.has(i) ? " on" : "") + '">' + (b.revealed.has(i) ? b.answer[i].toUpperCase() : "·") + "</span>"; return '<div class="probe-hint">INTEL ' + s + "</div>"; })()
      : '<div class="probe-hint empty">no intel yet — buy a PROBE to reveal a slot</div>';

    var grid = "";
    for (var r = 0; r < b.rows; r++) {
      var g = b.guesses[r];
      var isCur = !b.solved && !b.busted && r === b.guesses.length;
      grid += '<div class="grid-row' + (g && g.flip ? " flip" : "") + '">';
      for (var i = 0; i < b.len; i++) {
        if (g) { var hide = g.fogged && !g.revealed; grid += '<div class="tile filled ' + (hide ? "fog" : g.score[i]) + '" style="--d:' + i + '">' + g.word[i].toUpperCase() + "</div>"; }
        else if (isCur) { var ch = O.current[i] || ""; grid += '<div class="tile' + (ch ? " active" : "") + '">' + (ch ? ch.toUpperCase() : "") + "</div>"; }
        else grid += '<div class="tile"></div>';
      }
      grid += "</div>";
      if (g) g.flip = false;
    }

    var ks = computeKeyStates(b);
    var kb = "";
    KB_ROWS.forEach(function (row, ri) {
      kb += '<div class="kb-row">';
      if (ri === 2) kb += '<button class="key wide" data-k="enter">ENTER</button>';
      for (var i = 0; i < row.length; i++) { var ch = row[i]; kb += '<button class="key ' + (ks[ch] || "") + (b.effects.frozenKey === ch ? " frozen" : "") + '" data-k="' + ch + '">' + ch.toUpperCase() + "</button>"; }
      if (ri === 2) kb += '<button class="key wide" data-k="back">⌫</button>';
      kb += "</div>";
    });

    var chips = [];
    if (b.effects.frozenKey) chips.push('<span class="eff frost">❄ ' + b.effects.frozenKey.toUpperCase() + " frozen</span>");
    if (b.effects.fog) chips.push('<span class="eff fogc">🌫 feedback jammed</span>');
    if (b.effects.decoy) chips.push('<span class="eff dec">🛡 decoy armed</span>');

    var state = b.solved ? '<div class="turn-chip solved-chip">CRACKED ✓</div>'
      : b.busted ? '<div class="turn-chip busted-chip">LOCKED OUT</div>'
      : '<div class="turn-chip" style="--pc:' + O.color + '">CRACKING — ' + (b.rows - b.guesses.length) + " LEFT</div>";

    return '<div class="vault-head">' +
        '<div class="vhl"><div class="vault-label">' + vlabel + '</div><div class="vault-sub">' + b.len + " DIGITS · " + (b.solved ? "solved" : b.busted ? "locked" : (b.rows - b.guesses.length) + " guesses left") + ' · <span id="timer">0:00</span></div></div>' +
        state +
        '<button class="gear-btn" id="gear">GEAR ⚙ <b>⛁ ' + loot + "</b></button>" +
      "</div>" + probe +
      '<div class="grid" id="grid">' + grid + "</div>" +
      '<div class="effbar">' + chips.join("") + "</div>" +
      '<div class="kb" id="kb">' + kb + "</div>";
  }

  function crewHTML() {
    var list = sortedPlayers();
    var cards = list.map(function (p) {
      var v = p.vault || {};
      var alarmMax = (VAULT_LENS[O.vaultIdx] || 5) + 1;
      var pips = "";
      for (var i = 0; i < alarmMax; i++) pips += '<span class="pip' + (i < (v.alarm || 0) ? " on" : "") + '"></span>';
      var status = v.solved ? "CRACKED" : v.busted ? "BUSTED" : (v.idx === O.vaultIdx ? "▶ CRACKING" : "…");
      var isMe = p.id === O.meId;
      return '<div class="crew-card' + (isMe ? " active" : "") + (v.solved ? " solved" : "") + (v.busted ? " busted" : "") + '" style="--pc:' + p.color + '">' +
        '<div class="cc-top"><span class="crew-name">' + esc(p.name) + (isMe ? " (you)" : "") + "</span></div>" +
        '<div class="crew-loot">⛁ ' + (p.loot || 0) + "</div>" +
        '<div class="alarm">' + pips + "</div>" +
        '<div class="crew-status">' + status + "</div>" +
      "</div>";
    }).join("");
    var feed = (O.room.feed ? Object.keys(O.room.feed).map(function (k) { return O.room.feed[k]; }).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }).slice(0, 8) : []);
    var feedHtml = feed.map(function (f) { return '<div class="feed-item">' + f.msg + "</div>"; }).join("");
    return "<h3>CREW <span class=\"timer\" id=\"timer\"></span></h3>" +
      '<div class="crew-cards">' + cards + "</div>" +
      '<div class="feed-wrap"><div class="feed-title">HEIST FEED</div><div class="feed">' + feedHtml + "</div></div>";
  }

  function feed(msg) { Net.push("feed", { msg: msg, ts: Date.now() }); }

  /* ---- input ---- */
  function handleKey(k) {
    var b = O.board;
    if (!b || b.solved || b.busted) return;
    if (ov().classList.contains("show")) return;
    if (k === "enter") return submit();
    if (k === "back") { O.current = O.current.slice(0, -1); return patchCurrentRow(); }
    if (/^[a-z]$/.test(k)) {
      if (b.effects.frozenKey === k) { toast("❄ " + k.toUpperCase() + " is frozen this guess", "warn"); return; }
      if (O.current.length < b.len) { O.current += k; if (A) A.key(); patchCurrentRow(); }
    }
  }
  function patchCurrentRow() {
    var b = O.board, rows = $("#grid"); if (!rows) return;
    var row = rows.children[b.guesses.length]; if (!row) return;
    for (var i = 0; i < b.len; i++) { var ch = O.current[i] || ""; var t = row.children[i]; t.textContent = ch ? ch.toUpperCase() : ""; t.className = "tile" + (ch ? " active" : ""); }
  }

  function submit() {
    var b = O.board, word = O.current;
    if (word.length < b.len) { shake("not enough letters"); return; }
    if (!E.isValidWord(word)) { shake("not in the dictionary"); if (A) A.error(); return; }
    b.guesses.forEach(function (g) { if (g.fogged) g.revealed = true; });
    var score = E.scoreGuess(word, b.answer);
    var solved = E.isSolved(score);
    b.guesses.push({ word: word, score: score, fogged: b.effects.fog > 0, revealed: false, flip: true });
    if (b.effects.fog > 0) b.effects.fog--;
    b.effects.frozenKey = null;
    O.current = "";
    patchPlayMain();
    if (solved) onSolve(); else onWrong();
  }

  function onSolve() {
    var b = O.board, p = me();
    var secs = (Date.now() - b.startTime) / 1000;
    var combo = E.comboMult(O.streak);
    var loot = E.crackLoot({ len: b.len, rowsLeft: b.rows - b.guesses.length, alarmLeft: b.alarmMax - b.alarm, seconds: secs, combo: combo });
    b.solved = true; O.streak++;
    var newLoot = (p.loot || 0) + loot;
    var first = claimFirst();
    if (first) newLoot += JACKPOT;
    Net.update("players/" + O.meId, {
      loot: newLoot, cracks: (p.cracks || 0) + 1,
      "flags/ghost": (p.flags && p.flags.ghost) || b.alarm === 0,
      "flags/ace": (p.flags && p.flags.ace) || b.guesses.length <= 2,
    });
    pushPublic();
    stopTimer();
    if (A) { A.crack(); setTimeout(function () { A.loot(); }, 320); }
    crackAnim();
    feed('<b style="color:' + O.color + '">' + esc(O.name) + "</b> cracked it · +⛁" + loot + (first ? " 🏆+" + JACKPOT : ""));
    setTimeout(function () { patchPlayMain(); hostMaybeAdvance(); }, 200);
  }

  function onWrong() {
    var b = O.board, p = me();
    b.alarm++;
    if (b.alarm >= b.alarmMax || b.guesses.length >= b.rows) {
      b.busted = true; O.streak = 0;
      var fine = Math.round((p.loot || 0) * BUST_FINE);
      Net.update("players/" + O.meId, { loot: Math.max(0, (p.loot || 0) - fine), busts: (p.busts || 0) + 1 });
      pushPublic();
      stopTimer();
      if (A) A.bust();
      bustAnim();
      feed('<b style="color:' + O.color + '">' + esc(O.name) + "</b> tripped the alarm — vault locked" + (fine ? " · −⛁" + fine : ""));
      setTimeout(function () { patchPlayMain(); hostMaybeAdvance(); }, 200);
    } else {
      pushPublic();
      if (A) { A.error(); if (b.alarm >= b.alarmMax - 1) A.alarm(); }
      if (b.alarm >= b.alarmMax - 1) toast("⚠ alarm almost maxed!", "bad");
    }
  }

  // best-effort "first to crack this vault" claim (jackpot)
  function claimFirst() {
    var meta = O.room.meta || {};
    var first = meta.first || {};
    if (first[O.vaultIdx]) return false;
    Net.set("meta/first/" + O.vaultIdx, O.meId);
    return true;
  }

  /* ---- sabotage inbox ---- */
  function processInbox() {
    if (!O.board) return;
    var box = (O.room.inbox || {})[O.meId];
    if (!box) return;
    var changed = false;
    Object.keys(box).forEach(function (key) {
      if (O.applied[key]) return;
      O.applied[key] = true;
      var item = box[key];
      Net.remove("inbox/" + O.meId + "/" + key);
      if (O.board.solved || O.board.busted) return;
      if (O.board.effects.decoy) { O.board.effects.decoy = false; toast("🛡 decoy blocked " + (item.by || "a rival") + "'s " + item.type.toUpperCase(), "good"); changed = true; return; }
      if (item.type === "freeze") { O.board.effects.frozenKey = pickFreeze(); toast("❄ " + (item.by || "someone") + " froze " + O.board.effects.frozenKey.toUpperCase(), "warn"); }
      else if (item.type === "fog") { O.board.effects.fog = 1; toast("🌫 " + (item.by || "someone") + " jammed your next feedback", "warn"); }
      else if (item.type === "plant") { toast("🐀 Intel: " + fakeHint(), "warn"); }
      if (A) A.sabotage();
      changed = true;
    });
    if (changed) patchPlayMain();
  }
  function pickFreeze() {
    var ks = computeKeyStates(O.board), c = [];
    for (var i = 0; i < 26; i++) { var ch = String.fromCharCode(97 + i); if (ks[ch] !== "hit") c.push(ch); }
    return c[Math.floor(Math.random() * c.length)];
  }
  function fakeHint() {
    var ch = String.fromCharCode(97 + Math.floor(Math.random() * 26));
    return 'there might be a "' + ch.toUpperCase() + '" in slot ' + (Math.floor(Math.random() * O.board.len) + 1);
  }

  /* ---- shop ---- */
  function openShop() {
    var b = O.board; if (!b || b.solved || b.busted) return;
    var loot = me().loot || 0;
    var targets = sortedPlayers().filter(function (p) { return p.id !== O.meId && p.vault && p.vault.idx === O.vaultIdx && !p.vault.solved && !p.vault.busted; });
    var items = SHOP_ORDER.map(function (key) {
      var it = SHOP[key], afford = loot >= it.cost, need = it.kind === "sab", dis = !afford || (need && !targets.length);
      var why = !afford ? "not enough loot" : (need && !targets.length ? "no live rivals" : "");
      return '<button class="shop-item' + (dis ? " disabled" : "") + '" data-item="' + key + '"' + (dis ? " disabled" : "") + '>' +
        '<span class="si-icon">' + it.icon + '</span><span class="si-body"><span class="si-name">' + it.name + (need ? ' <em class="sab-tag">sabotage</em>' : "") + '</span><span class="si-desc">' + it.desc + (why ? ' <em class="si-why">· ' + why + "</em>" : "") + "</span></span>" +
        '<span class="shop-cost">⛁ ' + it.cost + "</span></button>";
    }).join("");
    var targetUI = '<div class="target-select"><span>SABOTAGE TARGET</span><div class="target-opts" id="target-opts">' +
      (targets.length ? targets.map(function (t, i) { return '<button class="target-opt' + (i === 0 ? " active" : "") + '" data-tid="' + t.id + '" style="--pc:' + t.color + '">' + esc(t.name) + "</button>"; }).join("") : '<span class="muted">no live rivals right now</span>') + "</div></div>";
    ov().innerHTML =
      '<div class="panel shop-panel"><div class="shop-head"><h2 class="display">GEAR SHOP</h2><span class="shop-bank">⛁ ' + loot + " loot</span></div>" +
      '<p class="muted">Spend your haul to gear up — or burn it to wreck a rival, live.</p>' + targetUI +
      '<div class="shop-grid">' + items + '</div><button class="btn btn--ghost" id="shop-close">BACK TO THE VAULT</button></div>';
    ov().className = "overlay show";
    var chosen = targets.length ? targets[0].id : null;
    var topts = $("#target-opts");
    if (topts) topts.addEventListener("click", function (ev) { var o = ev.target.closest(".target-opt"); if (!o) return; chosen = o.getAttribute("data-tid"); Array.prototype.forEach.call(topts.children, function (c) { c.classList.toggle("active", c === o); }); });
    ov().querySelector(".shop-grid").addEventListener("click", function (ev) { var btn = ev.target.closest(".shop-item"); if (!btn || btn.disabled) return; buy(btn.getAttribute("data-item"), chosen); });
    $("#shop-close").addEventListener("click", closeShop);
  }
  function closeShop() { ov().className = "overlay"; ov().innerHTML = ""; patchPlayMain(); }

  function buy(key, targetId) {
    var it = SHOP[key], b = O.board, p = me(), loot = p.loot || 0;
    if (loot < it.cost) return;
    if (it.kind === "sab") {
      if (!targetId) return;
      Net.push("inbox/" + targetId, { type: key, by: O.name });
      Net.update("players/" + O.meId, { loot: loot - it.cost });
      if (A) A.sabotage();
      var tn = ((O.room.players || {})[targetId] || {}).name || "rival";
      feed('<b style="color:' + O.color + '">' + esc(O.name) + "</b> rigged " + it.name + " for " + esc(tn));
      toast(it.icon + " " + it.name + " sent to " + tn, "good");
    } else {
      if (key === "probe") { var hid = []; for (var i = 0; i < b.len; i++) if (!b.revealed.has(i)) hid.push(i); if (!hid.length) { toast("all slots revealed", "warn"); return; } b.revealed.add(hid[Math.floor(Math.random() * hid.length)]); }
      else if (key === "jimmy") { b.rows++; b.alarmMax++; }
      else if (key === "defuse") { if (b.alarm === 0) { toast("alarm already cold", "warn"); return; } b.alarm = Math.max(0, b.alarm - 1); }
      else if (key === "decoy") { if (b.effects.decoy) { toast("decoy already armed", "warn"); return; } b.effects.decoy = true; }
      Net.update("players/" + O.meId, { loot: loot - it.cost });
      pushPublic();
      if (A) A.tick();
      toast(it.icon + " " + it.name + " — done", "good");
    }
    openShop();
  }

  /* ---- host advances the vault when everyone is done ---- */
  function hostMaybeAdvance() {
    if (!O.isHost || O.advancing) return;
    if (!O.room.meta || O.room.meta.status !== "playing") return;
    var idx = O.room.meta.vaultIdx || 0;
    var players = sortedPlayers();
    if (!players.length) return;
    var allDone = players.every(function (p) { var v = p.vault || {}; return v.idx === idx && (v.solved || v.busted); });
    if (!allDone) return;
    O.advancing = true;
    setTimeout(function () {
      if (idx >= VAULT_LENS.length - 1) Net.update("meta", { status: "over", endedAt: Date.now() });
      else Net.update("meta", { vaultIdx: idx + 1 });
    }, 1200);
  }

  /* ====================================================================
   *  GAME OVER
   * ==================================================================== */
  // cumulative room standings across games (host writes once per game)
  function tallyGame() {
    if (!O.isHost || O.tallied) return;
    var players = sortedPlayers();
    if (!players.length) return;
    O.tallied = true;
    var winnerId = players.slice().sort(function (a, b) { return (b.loot || 0) - (a.loot || 0); })[0].id;
    var tally = O.room.tally || {};
    players.forEach(function (p) {
      var t = tally[p.id] || { wins: 0, loot: 0, games: 0 };
      Net.update("tally/" + p.id, {
        name: p.name,
        wins: (t.wins || 0) + (p.id === winnerId ? 1 : 0),
        loot: (t.loot || 0) + (p.loot || 0),
        games: (t.games || 0) + 1,
      });
    });
  }
  function groupBoardHTML() {
    var tally = O.room.tally;
    if (!tally) return "";
    var arr = Object.keys(tally).map(function (id) { return Object.assign({ id: id }, tally[id]); });
    if (!arr.length) return "";
    arr.sort(function (a, b) { return (b.wins || 0) - (a.wins || 0) || (b.loot || 0) - (a.loot || 0); });
    var players = O.room.players || {};
    var rows = arr.map(function (t) {
      var color = (players[t.id] && players[t.id].color) || "#8a96a2";
      return '<div class="group-row" style="--pc:' + color + '"><span class="gr-name">' + esc(t.name || "?") + '</span><span class="gr-wins">' + (t.wins || 0) + " 🏆</span><span class=\"gr-loot\">⛁ " + (t.loot || 0) + "</span></div>";
    }).join("");
    return '<div class="group-board"><div class="group-title">Group standings · ' + (arr[0].games || 0) + " game" + ((arr[0].games || 0) === 1 ? "" : "s") + "</div>" + rows + "</div>";
  }

  function renderOver() {
    stopTimer();
    tallyGame();
    var ranked = sortedPlayers().sort(function (a, b) { return (b.loot || 0) - (a.loot || 0); });
    var top = ranked[0] || {};
    var badges = computeBadges(ranked, top);
    var rows = ranked.map(function (p, i) {
      var bs = badges[p.id].map(function (x) { return '<span class="badge">' + x + "</span>"; }).join("");
      return '<div class="standing-row big" style="--pc:' + p.color + '"><span class="sr-rank">' + (i + 1) + '</span><span class="sr-name">' + esc(p.name) + (p.id === O.meId ? " (you)" : "") + '</span><span class="sr-meta">cracked ' + (p.cracks || 0) + "/" + VAULT_LENS.length + (p.busts ? " · " + p.busts + " busts" : "") + " " + bs + '</span><span class="sr-loot">⛁ ' + (p.loot || 0) + "</span></div>";
    }).join("");
    ov().innerHTML =
      '<div class="panel gameover-panel"><div class="go-kicker">HEIST COMPLETE</div>' +
      '<h2 class="display go-title">' + esc(top.name || "") + " TAKES THE SCORE</h2>" +
      '<div class="standings">' + rows + "</div>" +
      groupBoardHTML() +
      '<button class="btn btn--ghost block" id="go-post">🏆 POST YOUR ⛁' + (me().loot || 0) + " TO THE WORLD BOARD</button>" +
      '<div class="go-actions"><button class="btn btn--ghost" id="go-share">COPY RESULT</button>' +
      '<button class="btn btn--ghost" id="go-world">WORLD BOARD</button>' +
      (O.isHost ? '<button class="btn btn--primary" id="go-again">PLAY AGAIN ▸</button>' : '<button class="btn btn--ghost" id="go-lobby">BACK TO LOBBY</button>') +
      '<button class="btn btn--ghost" id="go-leave">LEAVE</button></div></div>';
    ov().className = "overlay show";
    if (!O.overShown && A) { O.overShown = true; A.crack(); setTimeout(function () { A.loot(); }, 300); }
    $("#go-share").addEventListener("click", function () { shareResult(ranked, badges); });
    $("#go-leave").addEventListener("click", leave);
    $("#go-post").addEventListener("click", function () {
      var b = this; b.disabled = true; b.textContent = "posting…";
      if (TUMBLER.postScore) TUMBLER.postScore({ name: O.name, loot: me().loot || 0, mode: "run", cracks: me().cracks || 0 }, function (ok) {
        b.textContent = ok ? "✓ POSTED" : "✗ couldn't post — tap to retry"; if (!ok) b.disabled = false;
      });
      else { b.textContent = "✗ unavailable"; }
    });
    var gw = $("#go-world");
    if (gw) gw.addEventListener("click", function () { teardown(); if (TUMBLER.showLeaderboard) TUMBLER.showLeaderboard(); });
    if (O.isHost) $("#go-again").addEventListener("click", playAgain);
    else { var gl = $("#go-lobby"); if (gl) gl.addEventListener("click", function () { ov().className = "overlay"; ov().innerHTML = ""; }); }
  }

  function computeBadges(ranked, top) {
    var out = {};
    ranked.forEach(function (p) {
      var b = []; var f = p.flags || {};
      if (p.id === top.id) b.push("👑 KINGPIN");
      if ((p.cracks || 0) === VAULT_LENS.length && !(p.busts || 0)) b.push("💎 FLAWLESS");
      if (f.ghost) b.push("👻 GHOST");
      if (f.ace) b.push("🎯 SAFECRACKER");
      if ((p.loot || 0) >= 800) b.push("💰 BIG SCORE");
      out[p.id] = b;
    });
    return out;
  }

  function shareResult(ranked, badges) {
    var lines = ["🔐 i_guess — Online Heist (room " + O.roomId + ")"];
    ranked.forEach(function (p, i) { lines.push((i === 0 ? "🏆 " : "") + p.name + ": cracked " + (p.cracks || 0) + "/" + VAULT_LENS.length + " · ⛁" + (p.loot || 0) + (badges[p.id].length ? " " + badges[p.id].join(" ") : "")); });
    lines.push("play → " + location.origin + location.pathname);
    var text = lines.join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast("result copied", "good"); }, function () { toast("copy failed", "bad"); });
    else toast("copy failed", "bad");
  }

  function playAgain() {
    // host resets the room for a new run
    var players = O.room.players || {};
    var seed = (Math.floor(Math.random() * 0xffffffff)) >>> 0;
    Object.keys(players).forEach(function (id) {
      Net.update("players/" + id, { loot: 0, cracks: 0, busts: 0, vault: { idx: -1, alarm: 0, guessesUsed: 0, solved: false, busted: false }, flags: { ghost: false, ace: false } });
    });
    Net.remove("inbox"); Net.remove("feed"); Net.remove("meta/first");
    O.streak = 0; O.vaultIdx = -1; O.overShown = false;
    ov().className = "overlay"; ov().innerHTML = "";
    Net.update("meta", { status: "lobby", seed: seed });
  }

  /* ====================================================================
   *  ANIMATIONS / TIMER / TEARDOWN
   * ==================================================================== */
  var motion = true;
  try { motion = !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) {}
  function crackAnim() { if (!motion) return; var g = $("#grid"); if (g) { g.classList.remove("cracked"); void g.offsetWidth; g.classList.add("cracked"); } }
  function bustAnim() { if (!motion) return; var p = $(".play"); if (p) { p.classList.remove("bust"); void p.offsetWidth; p.classList.add("bust"); } }
  function shake(msg) { if (msg) toast(msg, "bad"); var b = O.board, row = $("#grid") && $("#grid").children[b.guesses.length]; if (row && motion) { row.classList.remove("shake"); void row.offsetWidth; row.classList.add("shake"); } }

  function startTimer() { stopTimer(); timer = setInterval(updateTimer, 250); updateTimer(); }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function updateTimer() {
    var t = $("#timer"); if (!t || !O.board || !O.board.startTime) return;
    var s = Math.floor((Date.now() - O.board.startTime) / 1000);
    t.textContent = Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
  }

  function leave() {
    teardown();
    clearUrl();
    if (TUMBLER.goHome) TUMBLER.goHome();
  }
  function teardown() {
    stopTimer();
    try { Net.close(); } catch (e) {}
    if (ov()) { ov().className = "overlay"; ov().innerHTML = ""; }
    O = null;
  }

  /* keyboard input (only while an online game is on screen) */
  document.addEventListener("keydown", function (ev) {
    if (!O || !O.active || !O.board) return;
    if (ov().classList.contains("show")) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var k = ev.key;
    if (k === "Enter") { ev.preventDefault(); handleKey("enter"); }
    else if (k === "Backspace") { ev.preventDefault(); handleKey("back"); }
    else if (/^[a-zA-Z]$/.test(k)) handleKey(k.toLowerCase());
  });

  TUMBLER.Online = { menu: menu, joinFromLink: joinFromLink, active: function () { return !!(O && O.active); } };
})();
