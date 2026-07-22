#!/usr/bin/env bash
# SUPERSEDED (do not use). This Phase 09 one-off generated a single still keyframe per state via
# nano_banana_flash, and its STATES list is the old 12-state roster — it does NOT cover the
# resolution-pass states (airLight/airHeavy/crouchLight/crouchHeavy). Independent still gens also
# drift (outfit/identity), which is exactly why the shipped pipeline is Seedance image-to-VIDEO.
# Use scripts/gen-sprite-videos.sh instead (it has all 16 states). Kept only for provenance.
echo "gen-real-sprites.sh is superseded — use: bash scripts/gen-sprite-videos.sh <fighter> [states...]" >&2
exit 1
# --- legacy body below, unreachable ---
# Phase 09 one-off: generate one keyframe per state x 3 fighters via nano_banana_flash (Nano Banana 2),
# each anchored to that fighter's Phase 05 reference image for identity. Raw poses land in
# concepts/characters/sprites/<id>/<state>/00-raw.png (+ prompt + job record) for build-sprites.py.
set -u
cd "$(dirname "$0")/.." || exit 1

# --image takes a local file path (auto-uploaded) or a UUID — NOT a URL.
declare -A REF=(
  [brawler]="concepts/characters/2026-07-17/brawler.png"
  [jiujitsu]="concepts/characters/2026-07-17/jiujitsu.png"
  [monk]="concepts/characters/2026-07-17/monk.png"
)

declare -A POSE=(
  [idle]="in a neutral fighting idle stance, weight centered, both fists up in a guard"
  [walkF]="walking forward mid-stride, lead leg forward, arms in a light guard"
  [walkB]="stepping backward, weight shifted back, guard up"
  [crouch]="crouching low, knees deeply bent, compact defensive posture"
  [jumpRise]="leaping straight upward, both legs tucked up, arms raised"
  [jumpFall]="descending from a jump, legs extending downward toward a landing"
  [attackLight]="throwing a fast straight jab, the lead fist punched forward and fully extended"
  [attackHeavy]="committing to a heavy low attack, lunging low with a big forward strike"
  [hitstun]="recoiling from being hit, head and torso snapped backward, off balance"
  [blockstun]="blocking, both forearms raised in front guarding the face and chest, braced"
  [knockdown]="knocked down, lying on the ground on the back, legs up"
  [ko]="knocked out cold, lying flat on the ground, motionless"
)
STATES="idle walkF walkB crouch jumpRise jumpFall attackLight attackHeavy hitstun blockstun knockdown ko"
SUFFIX="Flat solid #FF00FF magenta background, no scenery, no shadow, no ground, no text, no border. Full body head-to-feet inside the frame with a small margin, clearly FACING RIGHT. Crisp SNES-era pixel/cel shading matching the reference art style."

for FID in brawler jiujitsu monk; do
  for ST in $STATES; do
    DIR="concepts/characters/sprites/$FID/$ST"
    OUT="$DIR/00-raw.png"
    if [ -f "$OUT" ]; then echo "skip $FID/$ST (exists)"; continue; fi
    mkdir -p "$DIR"
    PROMPT="Full-body 2D fighting-game character sprite of the SAME character shown in the reference image (same face, hair, outfit and colors), ${POSE[$ST]}. $SUFFIX"
    echo "$PROMPT" > "$DIR/00.prompt.txt"
    ok=0
    for try in 1 2 3; do
      if higgsfield generate create nano_banana_flash --image "${REF[$FID]}" --prompt "$PROMPT" \
          --aspect_ratio 3:4 --resolution 1k --wait --wait-timeout 6m --json > "$DIR/00.job.json" 2>/dev/null; then
        URL=$(node -e "const j=require('./$DIR/00.job.json');const a=Array.isArray(j)?j[0]:j;process.stdout.write((a&&a.result_url)||'')" 2>/dev/null)
        if [ -n "$URL" ]; then
          node -e "const https=require('https'),fs=require('fs');https.get('$URL',r=>{const w=fs.createWriteStream('$OUT');r.pipe(w);w.on('finish',()=>process.exit(0))}).on('error',()=>process.exit(1))" && ok=1 && break
        fi
      fi
      echo "retry $FID/$ST ($try failed)"; sleep 3
    done
    [ "$ok" = 1 ] && echo "done $FID/$ST" || echo "FAIL $FID/$ST"
  done
done
echo "ALL DONE"
