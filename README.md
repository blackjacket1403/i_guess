# 🔐 TUMBLER

**Crack the word. Rob your crew.** A word-heist for one to four players — inspired by
five-letter word games, but it is *not* one of them. You crack escalating **vaults**,
bank the **loot**, and spend it to gear up… or to freeze, fog and bluff the friends
sitting next to you on the call.

▶ **Play:** https://blackjacket1403.github.io/4_of_us/

---

## Why it's different

It keeps the satisfying part of letter-guessing (green = right spot, gold = wrong spot)
and builds a whole heist around it:

- **A loot economy, not a streak counter.** Crack fast, with guesses and a quiet alarm
  to spare, and the payout is bigger. Vault after vault builds a **combo multiplier**.
- **A gear shop.** Spend loot on a **PROBE** (reveal a slot), **JIMMY** (+1 guess),
  **DEFUSE** (cool the alarm) or a **DECOY** (block the next hit).
- **Sabotage.** On a crew job, burn your own loot to wreck a rival's run: **FREEZE** a
  key on their next guess, **FOG** their feedback, or **PLANT** a fake hint in their ear.
- **An alarm with teeth.** Every wrong guess trips it. Max it out and the vault locks —
  you lose the haul *and* your combo.
- **Built for a video call.** Pure pass-the-laptop hotseat. One screen, take turns,
  no accounts, no server. First to crack each vault grabs the 🏆 jackpot; most loot
  after five vaults wins. Solo? It's a roguelike score chase against the alarm.

## Modes

| Mode | What it is |
|------|------------|
| **Heist Run** | Five escalating vaults (4 → 5 → 6 letters), a shop between guesses, badges at the end. |
| **Quick Crack** | A single 5-letter vault. One round, fast. |

Crew size **1–4**. Earn badges: 👑 Kingpin · 💎 Flawless · 👻 Ghost · 🎯 Safecracker · 💰 Big Score.

## Tech

A fully static site — no build step, no backend, no tracking.

- **Vanilla HTML / CSS / JS**, loaded as plain `<script>`s so it runs from GitHub Pages
  *and* from a double-clicked `index.html`.
- **Word data** lives in [`data/words.json`](data/words.json) and is mirrored to
  `js/words.js` (a global, so there is no `fetch`/CORS to worry about). **18,403** words
  are accepted as guesses; **2,960** common, proper-noun-free words can be the secret.
- **Sound** is synthesised with the Web Audio API — zero audio files ship.
- Honours `prefers-reduced-motion`, keyboard play, and visible focus.
- Your best haul, crew names and settings are cached in `localStorage`.

### Regenerating the word list

```bash
# common-words source (for fair secrets); validation comes from /usr/share/dict
curl -sLo /tmp/google10k.txt \
  https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt
python3 tools/build_words.py        # writes data/words.json + js/words.js
```

### Run locally

```bash
python3 -m http.server 8765      # then open http://localhost:8765
```

## Deploy (GitHub Pages)

The site lives at the repo root. In **Settings → Pages**, set the source to
**Deploy from a branch → `main` / `/ (root)`**. The included `.nojekyll` keeps Pages
from mangling the `js/` and `data/` folders. Done — it's live at the link up top.

## Credits

- Common-words list: [first20hours/google-10000-english](https://github.com/first20hours/google-10000-english) (no-swears subset).
- Validation dictionary: the system `american-english` / `british-english` word lists.

MIT licensed — see [`LICENSE`](LICENSE).
