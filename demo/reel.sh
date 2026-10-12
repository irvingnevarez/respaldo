#!/bin/bash
# Builds the highlight reel: records each segment, concatenates them, renders a
# score of exactly the right length, and muxes it in.
#
# Segment lengths come from measurement, not guesswork — runlevel.js reports how
# long each level plays clean, and each cut stops about a second before the bot
# would slip, so no death is ever on camera. Both bosses are now beaten outright,
# so their segments run to the end of the fight instead of stopping short.
set -e
cd "$(dirname "$0")"

# Single-instance lock. Two builds once ran at the same time and both wrote the
# same segment file — the result was a corrupt clip whose log interleaved two
# different runs. flock makes that impossible rather than unlikely.
exec 9>.reel.lock
flock -n 9 || { echo "ya hay un montaje en curso; abortando"; exit 3; }
echo $$ > .reel.pid
SCALE=${SCALE:-1.3333}          # 1280x720
OUT=${OUT:-batman-highlights.mp4}
FF=./node_modules/ffmpeg-static/ffmpeg
[ -x "$FF" ] || FF=$(command -v ffmpeg) || { echo 'no encuentro ffmpeg'; exit 4; }
mkdir -p seg

#   level  seconds  label                        why this length
#   -----  -------  ---------------------------  --------------------------------
#   0      27.0     title + MUELLES DE GOTHAM    clears at 21.4s, plus the card
#   1      5.0      AZOTEAS                      clean to 5.5s
#   2      15.0     TORRE DE ARKHAM              clean to 16.2s
#   3      20.8     EL PINGÜINO                  BEATEN: hits at 6.6, 11.1, 15.7s, no
#                                                deaths; the clear screen runs 2.6s
#                                                from 18.3s and the next level loads
#                                                at 20.9s, so 20.8 is the last safe cut
#   4      12.0     ALCANTARILLAS                clean to 12.9s
#   5      25.0     FUNDICIÓN DE ACERO           never dies, 31.8s
#   6      6.5      EL PUENTE                    clean to 6.9s
#   7      37.5     EL JOKER                     BEATEN: five hits, last at 27.9s, no
#                                                deaths; clear at 30.5s, victory screen
#                                                at 33.1s and held (segment.js freezes
#                                                the bot in 'win') for 4.4s
SEGS=(
  "0 27.0 1"
  "1 5.0 0"
  "2 15.0 0"
  "3 20.8 0"
  "4 12.0 0"
  "5 25.0 0"
  "6 6.5 0"
  "7 37.5 0"
)

echo "== grabando segmentos =="
i=0
: > seg/list.txt
for s in "${SEGS[@]}"; do
  set -- $s
  lv=$1; secs=$2; title=$3
  f="seg/s$(printf %02d $i)_lv$lv.mp4"
  echo "-- nivel $lv, ${secs}s -> $f"
  # Three lives, like a real run. Nine were used while tuning so a slip could not
  # end a segment early, but every cut already stops before the bot's first
  # mistake — and a HUD showing nine bat icons reads as a cheat run.
  if [ -s "$f" ]; then
    echo "   reusando $f"
  else
    node segment.js "$lv" "$secs" "$f" "$SCALE" "$title" 0 3
  fi
  echo "file '$(basename "$f")'" >> seg/list.txt
  i=$((i+1))
done

echo "== uniendo =="
"$FF" -y -hide_banner -loglevel error -f concat -safe 0 -i seg/list.txt -c copy seg/silent.mp4
DUR=$("$FF" -hide_banner -i seg/silent.mp4 2>&1 | sed -n 's/.*Duration: \([0-9:.]*\).*/\1/p' \
      | awk -F: '{printf "%.2f", $1*3600+$2*60+$3}')
echo "   duración: ${DUR}s"

echo "== música =="
node music.js "$DUR" seg/score.wav

echo "== mezcla final =="
"$FF" -y -hide_banner -loglevel error -i seg/silent.mp4 -i seg/score.wav \
  -filter_complex "[1:a]afade=t=in:st=0:d=1.5,afade=t=out:st=$(echo "$DUR-2.5" | bc):d=2.5[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest "$OUT"

ls -la "$OUT"
echo "LISTO: $OUT"
