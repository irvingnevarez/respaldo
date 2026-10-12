# demo/ — tooling around the game

Everything here reads the BUILT `../game.html`, never `src/`. Rebuild first:

    node src/build.js          # src/*.js -> game.html + artifact.html
    node demo/verify.js        # boots, no-WebGL fallback, touch layouts, both boss arenas

`verify.js` exits non-zero on any failure, so it can gate a commit.

## The bot

| file | what it is |
|---|---|
| `aprollout.js` | one-ply rollout controller: replays the engine's own physics for each candidate action |
| `autopilot.js` | per-level policy; hands boss arenas to `AP_BOSS` |
| `policy-penguin.js` | `AP_BOSS`, the shared emit/stuck machinery, and the Penguin |
| `policy-joker.js` | `BJ_joker`; **must be loaded after** `policy-penguin.js` |

Both bosses are beaten outright, deterministically, with a single life:

    node demo/runlevel.js 3 60 --lives 1 --policy policy-penguin.js,policy-joker.js   # Penguin, 18.3s
    node demo/runlevel.js 7 60 --lives 1 --policy policy-penguin.js,policy-joker.js   # Joker,   30.5s

The autopilot still only clears level 1-1 end to end; the reel cuts the other
levels short, before the bot's first mistake.

## Finding fight strategies: search, do not derive

Six strategies for the Joker's last hit were reasoned out from card arcs and all
failed. Replaying open-loop plans against the real engine solved it in minutes.

- `plan3.js` — Joker phase 3 (`transition` or `steady`): where to wait, when to run, when to jump
- `planpeng.js [phase]` — the Penguin's slam: standoff distance, jump time, steering
- `safedist.js`, `safedist3.js` — pin the player at fixed positions, count hits

## Diagnostics

- `jokerdiag.js [secs] [level]` — which collision test fired at the instant of each hit
- `statetrace.js` — boss state transitions, with level reloads flagged
- `dipdump.js`, `f2dump.js`, `pickdump.js` — frame-level traces for individual decisions

## Look and video

- `shot.js <game.html> <prefix> [scenes]` — deterministic screenshots; `SIN_RAYO=1` holds the lightning off
- `mktex.py` + `texturas/` — how the three surface maps in `src/_texdata.js` were made
- `segment.js`, `reel.sh`, `music.js` — record one clip, assemble the highlight reel, synthesise the score

## Things that cost hours, so they are written down

1. **Time must be monotonic across trials.** The game computes `dt = ts - last`.
   Restarting `ts` at 0 for each trial makes `dt` negative until it catches up with the
   previous trial's final timestamp, and the whole trial sits frozen. A scan of 8640
   trials "finished" in four seconds (4.6M frames cannot) and reported "no plan wins".
2. **Restart the whole run per trial** (`g.startRun(); g.loadLevel(n)`). `loadLevel`
   alone leaves a pending death behind.
3. **Re-attach hooks after a respawn.** `loadLevel` builds a NEW player object, so a
   wrapper installed once on `player.hurt` stops recording at the first death.
4. **Print the tally of outcomes.** Impossible speed, or one outcome swallowing
   everything, means the harness is frozen, not that the answer is "none".
5. **Do not edit `reel.sh`, `segment.js` or the policies, and do not rebuild
   `game.html`, while a render runs.** Bash reads scripts incrementally and each
   segment re-reads the others from disk; a mid-render change gives a reel whose
   early and late clips disagree.
6. **`pkill -f` patterns match the killing shell's own command line.** Write
   `[s]egment.js`, not `segment.js`.
7. The recorders look for `node_modules/ffmpeg-static` and fall back to the system
   `ffmpeg`; a container rebuild once removed it and every tool died on ENOENT.
