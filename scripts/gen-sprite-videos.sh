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

# Per-<fighter>/<state> start-image override. `--start-image` DOMINATES the prompt, so when a clip
# needs both an unusual STANCE and a motion, supplying the stance as the start frame and asking the
# prompt for the motion alone is far more reliable than asking for both. Found the hard way on
# monk/crouchLight: four prompt variants each produced the crouch OR the punch, never both — whichever
# constraint led, the other collapsed.
declare -A START_OVERRIDE=(
  # The monk has never visually crouched in ANY crouch state (measured 92-99% of his standing height
  # against the brawler's 67-89%), because no crouched monk frame existed to start from — so every
  # gen had to invent the stance AND the motion, and always dropped one. This is a still generated
  # for the purpose (nano_banana_pro from the Phase 05 ref, "discard the standing pose", phantom
  # second head removed by keeping the largest connected component): aspect 0.78 vs 0.45 standing.
  [monk/crouch]="concepts/characters/crouch-refs/monk-crouch.png"
  [monk/crouchLight]="concepts/characters/crouch-refs/monk-crouch.png"
  [monk/crouchHeavy]="concepts/characters/crouch-refs/monk-crouch.png"
  # jiujitsu needed no generated still: his own `crouch` clip already reaches a real crouch, and its
  # last frame is both the deepest (aspect 0.85 vs 0.69 at the start) and already on the magenta void
  # at the right scale. Starting a crouch ATTACK from the crouch state's own final frame also means
  # the two animations agree pixel-for-pixel at the moment the player presses the button.
  [jiujitsu/crouchLight]="concepts/characters/sprites/jiujitsu/crouch/03.png"
)

# per-fighter outfit clause so every state keeps the exact same look
declare -A OUTFIT=(
  [brawler]="red open jacket over a white tank top, blue jeans, red high-top sneakers, black fingerless gloves, spiky brown hair"
  [jiujitsu]="white judo gi with a blue belt, barefoot, short dark navy hair (hair colour identical every frame)"
  [monk]="orange Shaolin monk robe with wrapped forearms and shins, wooden prayer-bead necklace, bald head"
)
# The clip is 4s and ffmpeg samples N frames EVENLY across all of it, so a motion that finishes in the
# first second spends the remaining frames on a held pose — which is exactly how a 6-frame sheet ends
# up with 3 distinct poses (monk/attackLight measured steps 0.00 0.33 0.01 0.32 0.09). Telling the
# model to spread the action over the whole clip is what makes every sampled frame carry new
# information. Append to any one-shot motion; a cyclic one (walk, idle bob) fills the clip already.
SPAN_CLIP="Perform this single motion slowly and steadily so that it fills the ENTIRE clip from the very first moment to the very last: extending through the first half and returning through the second half. Never hold still, and never repeat the motion twice — at every instant the body is at a different position from every other instant."

declare -A MOTION=(
  # "subtly bobs" measured 0.06 peak silhouette change on jiujitsu and monk — the model took "subtle"
  # as "barely move at all" and the idles read as frozen photographs.
  # Two failed attempts, two different causes. "subtly bobs" scored 0.06 peak change — the model read
  # "subtle" as "do not move". Saying "bobs continuously and clearly" only reached 0.10, because the
  # amplitude was never the whole problem: N frames are sampled evenly across the 4s clip, so ONE slow
  # bob puts every sample at nearly the same phase. The brawler's sheet is the best of the three purely
  # because it happens to run ~2.5 cycles (steps 0.01/0.13/0.12 repeating). So name the COUNT as well
  # as the size — two cycles over 8 samples is four samples per cycle, and it loops seamlessly.
  [idle]="stands in a fighting idle stance and bobs up and down, dipping at the knees and rising again, exactly TWICE during the clip — one complete down-and-up about every two seconds, evenly paced. The dip is large and unmistakable, and his chest and shoulders visibly rise and fall with it. He is never still for a single instant, but his feet stay planted on the same spot"
  [walkF]="walks forward with a smooth full walk cycle, legs striding, arms in a light guard"
  # "backpedals, stepping backward" measured 0.14 on jiujitsu (vs 0.56-0.79 for walkF) — he slid
  # backward without moving his legs, and brawler froze for the first 4 of 8 frames. Name the cycle.
  [walkB]="walks backward with a complete and clearly visible walking cycle, repeated steadily for the whole clip: he lifts one foot right off the ground, swings that leg back behind him and plants it, then does the same with the other leg, over and over. The legs alternate continuously and are never both planted still at the same time. Guard stays up and his torso stays upright and facing right"
  [crouch]="ducks down low into a compact crouching guard and holds it"
  [jumpRise]="crouches slightly then leaps straight up, rising into the air with legs tucking up"
  [jumpFall]="falls downward from the peak of a jump, legs extending toward a landing"
  [attackLight]="throws one straight jab: the lead arm reaches forward until the elbow is completely straight and the fist is far out in front of his chest, then returns to guard. The arm fully extending is the single biggest movement in the clip. ${SPAN_CLIP}"
  [attackHeavy]="winds up and throws one powerful heavy lunging punch, then recovers to stance"
  [hitstun]="recoils backward as if struck hard, head and torso snapping back, staggering"
  [blockstun]="raises both forearms into a tight defensive block and braces in place"
  [knockdown]="is knocked off his feet and falls backward onto the ground"
  [ko]="collapses to the ground and lies there motionless, knocked out"
  [airLight]="leaps into the air and throws one fast jumping jab punch angled downward, staying airborne"
  [airHeavy]="leaps into the air and throws one heavy diving punch angled downward, staying airborne"
  [crouchLight]="is squatting all the way down in a deep full crouch the entire time, buttocks near his heels and thighs parallel to the ground, torso upright. He NEVER stands up tall and NEVER lies down. From that deep squat he throws one fast straight punch: the lead arm shoots forward at knee height until the elbow is completely straight and the fist is far out in front of his knees, then snaps back. The legs stay folded in the deep squat while only the arm moves"
  [crouchHeavy]="is squatting all the way down in a deep full crouch the entire time, thighs parallel to the ground, and swings one heavy low sweeping attack along the floor at ankle height. He NEVER stands up tall and NEVER lies down"
)
# Motion text used only when a START_OVERRIDE supplies the stance: the pose is already correct in the
# start frame, so the prompt asks for the ARM ALONE and explicitly freezes everything else.
declare -A MOTION_FROM_START=(
  [monk/crouch]="holds exactly the low crouched position of the start image, breathing and shifting his weight very slightly. He stays down the whole time and never rises"
  [monk/crouchLight]="stays in exactly the low crouched position of the start image without raising his hips or head at all, and punches: his lead arm shoots straight forward until the elbow is completely straight and the fist is far out in front of him, then pulls back to his chest. ONLY the arm moves"
  [monk/crouchHeavy]="stays in exactly the low crouched position of the start image without raising his hips or head at all, and sweeps one heavy low attack forward along the floor, the striking arm or leg extending far out in front of him and then returning. His hips stay down the whole time. ${SPAN_CLIP}"
  [jiujitsu/crouchLight]="stays in exactly the low crouched position of the start image without raising his hips or head at all, and punches: his lead arm shoots straight forward until the elbow is completely straight and the fist is far out in front of him, then pulls back to his chest. ONLY the arm moves. ${SPAN_CLIP}"
)
STATES=("$@"); [ ${#STATES[@]} -eq 0 ] && STATES=(walkF walkB crouch jumpRise jumpFall attackLight attackHeavy airLight airHeavy crouchLight crouchHeavy hitstun blockstun knockdown ko)

for ST in "${STATES[@]}"; do
  DIR="concepts/characters/sprites/$FID/$ST"; MP4="concepts/characters/video/$FID/$ST.mp4"
  N=$(node -e "console.log(require('./public/configs/character-gym.json').$FID.render.sheets.$ST.frames)")
  have=$(ls "$DIR"/[0-9][0-9].png 2>/dev/null | wc -l)
  if [ "$have" -ge "$N" ]; then echo "skip $FID/$ST (have $have/$N)"; continue; fi
  mkdir -p "$DIR" "concepts/characters/video/$FID"
  SI="$START"; [ -n "${START_OVERRIDE[$FID/$ST]:-}" ] && [ -f "${START_OVERRIDE[$FID/$ST]}" ] && SI="${START_OVERRIDE[$FID/$ST]}"
  MOT="${MOTION[$ST]}"; [ "$SI" != "$START" ] && MOT="${MOTION_FROM_START[$FID/$ST]:-$MOT}"
  PROMPT="The SAME single $FID fighter from the start image ${MOT}, side view facing RIGHT, centered in place. Keep his exact appearance every frame: ${OUTFIT[$FID]}. Flat solid #FF00FF magenta background, uniform and unchanged. Locked static camera, no zoom, no pan. Exactly ONE character, no other people, no weapons."
  echo "$PROMPT" > "$DIR/00.prompt.txt"
  ok=0
  for try in 1 2; do
    if higgsfield generate create seedance_2_0 --start-image "$SI" --prompt "$PROMPT" \
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
