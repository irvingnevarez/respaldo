#!/bin/bash
# Builds the trailer: records the shot groups (two at a time), joins them, renders
# the score from the recorders' logs and muxes everything into one MP4.
#   voxel/demo/trailer/make.sh <outdir> [W H]
# A group is a run of shots that must be played in one page because each one
# continues the last (the leap into the glide, the Penguin into his slam).
set -e
OUT=${1:?outdir}; W=${2:-1920}; H=${3:-1080}
D="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
# two lanes of about the same number of frames, recorded side by side
run() { [ -s "$OUT/$3.mp4" ] && [ -s "$OUT/$3.json" ] && { echo "ya está $3"; return; }
        node "$D/capture.js" $1 $2 "$OUT/$3" $W $H 30 > "$OUT/$3.log" 2>&1 || { echo "falló el grupo $3"; tail -5 "$OUT/$3.log"; return 1; }; tail -1 "$OUT/$3.log"; }
echo "== grabando a ${W}x${H} =="
( run 0 3 g1 && run 3 6 g2 && run 18 20 g6 ) &
( run 6 12 g3 && run 12 14 g4 && run 14 18 g5 ) &
wait
for g in g1 g2 g3 g4 g5 g6; do [ -s "$OUT/$g.mp4" ] || { echo "falta $g"; exit 1; }; done
echo "== uniendo =="
: > "$OUT/list.txt"
for g in g1 g2 g3 g4 g5 g6; do echo "file '$OUT/$g.mp4'" >> "$OUT/list.txt"; done
ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "$OUT/list.txt" -c copy "$OUT/video.mp4"
echo "== música =="
node "$D/mkscore.js" "$OUT/score.wav" "$OUT"/g1.json "$OUT"/g2.json "$OUT"/g3.json "$OUT"/g4.json "$OUT"/g5.json "$OUT"/g6.json
echo "== mezcla final =="
ffmpeg -y -hide_banner -loglevel error -i "$OUT/video.mp4" -i "$OUT/score.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart "$OUT/gotham-trailer.mp4"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$OUT/gotham-trailer.mp4"
