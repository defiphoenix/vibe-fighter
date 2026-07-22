#!/usr/bin/env bash
# Phase 09: per-state character animation via Seedance 2.0 image-to-video (temporally consistent —
# fixes the identity/outfit drift + hallucinated 2nd figures from independent still gens). One clip
# per state, started from the fighter's canonical idle frame, then ffmpeg samples N frames (N =
# render.sheets[state].frames in character-gym.json) into concepts/characters/sprites/<id>/<state>/.
# Usage: bash scripts/gen-sprite-videos.sh <fighter> [state1 state2 ...]   (default: all but idle)
set -u
cd "$(dirname "$0")/.." || exit 1
FID="${1:?fighter id required}"; shift || true

# canonical start image (has the finalized look); fall back to the Phase 05 ref
START="concepts/characters/sprites/$FID/idle/00.png"
[ -f "$START" ] || START="concepts/characters/2026-07-17/$FID.png"

# per-fighter outfit clause so every state keeps the exact same look
declare -A OUTFIT=(
  [brawler]="red open jacket over a white tank top, blue jeans, red high-top sneakers, black fingerless gloves, spiky brown hair"
  [jiujitsu]="white judo gi with a blue belt, barefoot, short dark navy hair (hair colour identical every frame)"
  [monk]="orange Shaolin monk robe with wrapped forearms and shins, wooden prayer-bead necklace, bald head"
)
declare -A MOTION=(
  [idle]="holds a neutral fighting idle stance and subtly bobs, breathing and shifting weight, staying in place"
  [walkF]="walks forward with a smooth full walk cycle, legs striding, arms in a light guard"
  [walkB]="backpedals, stepping backward with guard up"
  [crouch]="ducks down low into a compact crouching guard and holds it"
  [jumpRise]="crouches slightly then leaps straight up, rising into the air with legs tucking up"
  [jumpFall]="falls downward from the peak of a jump, legs extending toward a landing"
  [attackLight]="throws one fast straight jab punch forward, then snaps the fist back to guard"
  [attackHeavy]="winds up and throws one powerful heavy lunging punch, then recovers to stance"
  [hitstun]="recoils backward as if struck hard, head and torso snapping back, staggering"
  [blockstun]="raises both forearms into a tight defensive block and braces in place"
  [knockdown]="is knocked off his feet and falls backward onto the ground"
  [ko]="collapses to the ground and lies there motionless, knocked out"
  [airLight]="leaps into the air and throws one fast jumping jab punch angled downward, staying airborne"
  [airHeavy]="leaps into the air and throws one heavy diving punch angled downward, staying airborne"
  [crouchLight]="is squatting all the way down in a deep full crouch the entire time, buttocks near his heels and thighs parallel to the ground, torso upright, and flicks one quick low jab straight forward at knee height. He NEVER stands up tall and NEVER lies down"
  [crouchHeavy]="is squatting all the way down in a deep full crouch the entire time, thighs parallel to the ground, and swings one heavy low sweeping attack along the floor at ankle height. He NEVER stands up tall and NEVER lies down"
)
STATES=("$@"); [ ${#STATES[@]} -eq 0 ] && STATES=(walkF walkB crouch jumpRise jumpFall attackLight attackHeavy airLight airHeavy crouchLight crouchHeavy hitstun blockstun knockdown ko)

for ST in "${STATES[@]}"; do
  DIR="concepts/characters/sprites/$FID/$ST"; MP4="concepts/characters/video/$FID/$ST.mp4"
  N=$(node -e "console.log(require('./public/configs/character-gym.json').$FID.render.sheets.$ST.frames)")
  have=$(ls "$DIR"/[0-9][0-9].png 2>/dev/null | wc -l)
  if [ "$have" -ge "$N" ]; then echo "skip $FID/$ST (have $have/$N)"; continue; fi
  mkdir -p "$DIR" "concepts/characters/video/$FID"
  PROMPT="The SAME single $FID fighter from the start image ${MOTION[$ST]}, side view facing RIGHT, centered in place. Keep his exact appearance every frame: ${OUTFIT[$FID]}. Flat solid #FF00FF magenta background, uniform and unchanged. Locked static camera, no zoom, no pan. Exactly ONE character, no other people, no weapons."
  echo "$PROMPT" > "$DIR/00.prompt.txt"
  ok=0
  for try in 1 2; do
    if higgsfield generate create seedance_2_0 --start-image "$START" --prompt "$PROMPT" \
        --aspect_ratio 3:4 --resolution 720p --duration 4 --mode fast --generate_audio false \
        --wait --wait-timeout 12m --json > "$DIR/00.job.json" 2>/dev/null; then
      URL=$(node -e "const j=require('./$DIR/00.job.json');const a=Array.isArray(j)?j[0]:j;process.stdout.write((a&&a.result_url)||'')" 2>/dev/null)
      if [ -n "$URL" ]; then
        node -e "const https=require('https'),fs=require('fs');https.get('$URL',r=>{const w=fs.createWriteStream('$MP4');r.pipe(w);w.on('finish',()=>process.exit(0))}).on('error',()=>process.exit(1))" || { echo "dl fail $FID/$ST"; continue; }
        rm -f "$DIR"/[0-9][0-9].png
        ffmpeg -y -i "$MP4" -vf "fps=$N/4" -frames:v "$N" "$DIR/%02d.png" 2>/dev/null
        # rename 01..N -> 00..N-1
        idx=0; for f in $(ls "$DIR"/[0-9][0-9].png | sort); do mv "$f" "$DIR/t_$(printf %02d $idx).png"; idx=$((idx+1)); done
        for f in "$DIR"/t_*.png; do mv "$f" "${f/t_/}"; done
        cnt=$(ls "$DIR"/[0-9][0-9].png 2>/dev/null | wc -l)
        [ "$cnt" -ge "$N" ] && ok=1 && echo "done $FID/$ST ($cnt frames)" && break
      fi
    fi
    echo "retry $FID/$ST"; sleep 3
  done
  [ "$ok" = 1 ] || echo "FAIL $FID/$ST"
done
echo "ALL DONE $FID"
