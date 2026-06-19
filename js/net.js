/* TUMBLER — net.js
 * Transport-agnostic room sync. Two adapters behind one tiny interface:
 *   FirebaseNet  — real cross-device play (Firebase Realtime Database).
 *   LocalNet     — same-browser sync (BroadcastChannel + localStorage), used
 *                  for local testing and as a graceful demo before Firebase
 *                  is configured. NOT cross-device.
 *
 * Interface (all paths are slash-separated, relative to the room root):
 *   Net.mode                       'firebase' | 'local'
 *   Net.configured()               true when a real Firebase config is present
 *   Net.genCode()  Net.genId()
 *   Net.open(roomId)               begin a session on a room
 *   Net.onRoom(cb)                 cb(roomObject) on every change
 *   Net.set/update/push/remove(path, value)
 *   Net.onDisconnectRemove(path)   clean up presence when the tab closes
 *   Net.close()
 */
(function () {
  "use strict";
  var TUMBLER = (window.TUMBLER = window.TUMBLER || {});

  var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no easily-confused chars
  function genCode() {
    var s = "";
    for (var i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return s;
  }
  function genId() {
    return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  }

  /* ---- path helpers for the in-memory/local object model ---- */
  function getPath(obj, path) {
    var parts = path.split("/");
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }
  function setPath(obj, path, value) {
    var parts = path.split("/");
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      var k = parts[i];
      if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
      cur = cur[k];
    }
    if (value === null || value === undefined) delete cur[parts[parts.length - 1]];
    else cur[parts[parts.length - 1]] = value;
  }

  /* =========================== LocalNet =========================== */
  function LocalNet() {
    this.mode = "local";
    this.roomId = null;
    this.cb = null;
    this.channel = null;
    this.storageKey = null;
    this.cleanupPaths = [];
    var self = this;
    this._onStorage = function (e) { if (e.key === self.storageKey) self._emit(); };
    this._onUnload = function () { self._doDisconnectCleanup(); };
  }
  LocalNet.prototype.configured = function () { return false; };
  LocalNet.prototype.genCode = genCode;
  LocalNet.prototype.genId = genId;
  LocalNet.prototype._read = function () {
    try { return JSON.parse(localStorage.getItem(this.storageKey) || "{}"); }
    catch (e) { return {}; }
  };
  LocalNet.prototype._write = function (obj) {
    try { localStorage.setItem(this.storageKey, JSON.stringify(obj)); } catch (e) {}
  };
  LocalNet.prototype._emit = function () { if (this.cb) this.cb(this._read()); };
  LocalNet.prototype._notify = function () {
    if (this.channel) { try { this.channel.postMessage(1); } catch (e) {} }
    this._emit();
  };
  LocalNet.prototype.open = function (roomId) {
    this.roomId = roomId;
    this.storageKey = "tum.room." + roomId;
    var self = this;
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("tum.room." + roomId);
      this.channel.onmessage = function () { self._emit(); };
    }
    window.addEventListener("storage", this._onStorage);
    window.addEventListener("pagehide", this._onUnload);
    window.addEventListener("beforeunload", this._onUnload);
  };
  LocalNet.prototype.onRoom = function (cb) { this.cb = cb; this._emit(); };
  LocalNet.prototype.set = function (path, value) { var o = this._read(); setPath(o, path, value); this._write(o); this._notify(); };
  LocalNet.prototype.update = function (path, obj) {
    var o = this._read();
    for (var k in obj) if (obj.hasOwnProperty(k)) setPath(o, path + "/" + k, obj[k]);
    this._write(o); this._notify();
  };
  LocalNet.prototype.push = function (path, value) {
    var key = "k" + genId();
    var o = this._read(); setPath(o, path + "/" + key, value); this._write(o); this._notify();
    return key;
  };
  LocalNet.prototype.remove = function (path) { this.set(path, null); };
  LocalNet.prototype.onDisconnectRemove = function (path) { this.cleanupPaths.push(path); };
  LocalNet.prototype._doDisconnectCleanup = function () {
    if (!this.storageKey) return;
    var o = this._read();
    for (var i = 0; i < this.cleanupPaths.length; i++) setPath(o, this.cleanupPaths[i], null);
    this._write(o);
    if (this.channel) { try { this.channel.postMessage(1); } catch (e) {} }
  };
  // global (not room-scoped) data — e.g. the world leaderboard
  LocalNet.prototype._gkey = function (p) { return "tum.global." + p; };
  LocalNet.prototype._emitGlobal = function (p) {
    if (this._gcb && this._gcb[p]) { var o = {}; try { o = JSON.parse(localStorage.getItem(this._gkey(p)) || "{}"); } catch (e) {} this._gcb[p](o); }
  };
  LocalNet.prototype.pushGlobal = function (p, v) {
    var k = this._gkey(p), o = {};
    try { o = JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) {}
    o["k" + genId()] = v;
    try { localStorage.setItem(k, JSON.stringify(o)); } catch (e) {}
    if (typeof BroadcastChannel !== "undefined") { try { new BroadcastChannel("tum.g." + p).postMessage(1); } catch (e) {} }
    this._emitGlobal(p);
  };
  LocalNet.prototype.onGlobal = function (p, cb) {
    this._gcb = this._gcb || {}; this._gch = this._gch || {};
    this._gcb[p] = cb;
    var self = this;
    if (typeof BroadcastChannel !== "undefined") { var ch = new BroadcastChannel("tum.g." + p); ch.onmessage = function () { self._emitGlobal(p); }; this._gch[p] = ch; }
    this._emitGlobal(p);
  };
  LocalNet.prototype.offGlobal = function (p) {
    if (this._gch && this._gch[p]) { try { this._gch[p].close(); } catch (e) {} delete this._gch[p]; }
    if (this._gcb) delete this._gcb[p];
  };

  LocalNet.prototype.close = function () {
    this._doDisconnectCleanup();
    window.removeEventListener("storage", this._onStorage);
    window.removeEventListener("pagehide", this._onUnload);
    window.removeEventListener("beforeunload", this._onUnload);
    if (this.channel) { this.channel.close(); this.channel = null; }
    this.cb = null; this.roomId = null; this.cleanupPaths = [];
  };

  /* =========================== FirebaseNet =========================== */
  function FirebaseNet(cfg) {
    this.mode = "firebase";
    this.ref = null;
    this.cb = null;
    if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(cfg);
    this.db = firebase.database();
  }
  FirebaseNet.prototype.configured = function () { return true; };
  FirebaseNet.prototype.genCode = genCode;
  FirebaseNet.prototype.genId = genId;
  FirebaseNet.prototype.open = function (roomId) { this.roomId = roomId; this.ref = this.db.ref("rooms/" + roomId); };
  FirebaseNet.prototype.onRoom = function (cb) {
    this.cb = cb;
    this.ref.on("value", function (snap) { cb(snap.val() || {}); });
  };
  FirebaseNet.prototype.set = function (path, value) { this.ref.child(path).set(value); };
  FirebaseNet.prototype.update = function (path, obj) { this.ref.child(path).update(obj); };
  FirebaseNet.prototype.push = function (path, value) { var r = this.ref.child(path).push(); r.set(value); return r.key; };
  FirebaseNet.prototype.remove = function (path) { this.ref.child(path).remove(); };
  FirebaseNet.prototype.onDisconnectRemove = function (path) { this.ref.child(path).onDisconnect().remove(); };
  FirebaseNet.prototype.pushGlobal = function (p, v) { var r = this.db.ref(p).push(); return r.set(v); }; // returns a promise
  FirebaseNet.prototype.onGlobal = function (p, cb, errCb) {
    this._g = this._g || {};
    var ref = this.db.ref(p); this._g[p] = ref;
    ref.on("value", function (s) { cb(s.val() || {}); }, function (e) { if (errCb) errCb(e); });
  };
  FirebaseNet.prototype.offGlobal = function (p) { if (this._g && this._g[p]) { this._g[p].off(); delete this._g[p]; } };
  FirebaseNet.prototype.close = function () { if (this.ref) this.ref.off(); this.cb = null; this.ref = null; };

  /* =========================== factory =========================== */
  function looksValid(cfg) {
    return cfg && typeof cfg.apiKey === "string" && cfg.apiKey.indexOf("PASTE_") !== 0 &&
      typeof cfg.databaseURL === "string" && cfg.databaseURL.indexOf("http") === 0;
  }

  var cfg = window.TUMBLER_FIREBASE;
  var net;
  var firebaseReady = (typeof firebase !== "undefined" && firebase && firebase.initializeApp);
  if (looksValid(cfg) && firebaseReady) {
    try { net = new FirebaseNet(cfg); }
    catch (e) { console.warn("Firebase init failed, falling back to same-browser demo:", e); net = new LocalNet(); }
  } else {
    net = new LocalNet();
  }
  net.configuredReal = looksValid(cfg) && firebaseReady;

  TUMBLER.Net = net;
})();
