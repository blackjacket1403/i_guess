/* TUMBLER — Firebase config (powers cross-device online rooms)
 * ----------------------------------------------------------------------------
 * These values are NOT secrets — a Firebase web config is meant to live in the
 * client. Access is controlled by the Realtime Database rules (see README),
 * not by hiding this. Project: blackjacket1403-8e29d (Realtime DB, asia-southeast1).
 *
 * To regenerate: Firebase console → ⚙ Settings → General → Your apps → Web app.
 * Rules to publish (Realtime Database → Rules):
 *   { "rules": { ".read": false, ".write": false,
 *       "rooms": { "$room": { ".read": true, ".write": true } } } }
 * ----------------------------------------------------------------------------
 */
window.TUMBLER_FIREBASE = {
  apiKey: "AIzaSyArdHgGs_jdUE6NArX2aUTfzYmqpKFhh8c",
  authDomain: "blackjacket1403-8e29d.firebaseapp.com",
  databaseURL: "https://blackjacket1403-8e29d-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "blackjacket1403-8e29d",
  storageBucket: "blackjacket1403-8e29d.firebasestorage.app",
  messagingSenderId: "299771480485",
  appId: "1:299771480485:web:b08bfa9481588d57d6404c",
};
