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
  # block / blockCrouch must OPEN already braced (frame 0 = the guard pose), so re-entering guard after
  # a blockstun doesn't replay a raise-guard wind-up (worst on a crouch, which flashed a stand-up). Each
  # starts from its OWN validated guard frame — the last frame of the first-pass clip, kept in
  # guard-refs/ — and the prompt just holds it. Regenerated 2026-07-25.
  [brawler/block]="concepts/characters/guard-refs/brawler-block.png"
  [jiujitsu/block]="concepts/characters/guard-refs/jiujitsu-block.png"
  [monk/block]="concepts/characters/guard-refs/monk-block.png"
  [brawler/blockCrouch]="concepts/characters/guard-refs/brawler-blockCrouch.png"
  [jiujitsu/blockCrouch]="concepts/characters/guard-refs/jiujitsu-blockCrouch.png"
  # NOT guard-refs/monk-blockCrouch.png: that "crouched guard" reference is a fighter STANDING in a
  # wide horse stance, which is why his low block measured 158-175px against a 183px stand — 86-96%
  # of his standing height, i.e. not a crouch at all. `--start-image` DOMINATES the prompt, so no
  # wording could have fixed it. crouch-refs/monk-crouch.png is the purpose-generated deep squat used
  # by his other crouch states and already holds a guard at the chin, so his crouch and crouch-block
  # now also agree pixel-for-pixel — the same argument as jiujitsu/crouchLight below.
  [monk/blockCrouch]="concepts/characters/crouch-refs/monk-crouch.png"
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
  # ...and then the AMPLITUDE half was over-corrected: "the dip is large and unmistakable, dipping at
  # the knees" gave the brawler a full squat-and-rise every 0.4s, which reads as doing squats rather
  # than holding a stance ("why can the characters not stay idle by standing"). The cycle COUNT is the
  # part that fixed the sampling; the size was never what was wrong. Keep the count, shrink the motion,
  # and forbid the knee dip by name — the head must stay at nearly one height.
  [idle]="holds a READY FIGHTING STANCE and stays standing in it the whole time — knees only slightly bent, exactly as they are in the start image, and his head staying at very nearly the same height throughout. He must NEVER squat, NEVER dip down at the knees, and NEVER crouch. Within that stance he is subtly but continuously alive: he settles and rises again very slightly, exactly TWICE during the clip (one small, evenly paced cycle about every two seconds), breathing so his chest and shoulders rise and fall, his guard hands drifting and his weight easing from one foot to the other. His feet stay planted on the same spot"
  [walkF]="walks forward with a smooth full walk cycle, legs striding, arms in a light guard"
  # "backpedals, stepping backward" measured 0.14 on jiujitsu (vs 0.56-0.79 for walkF) — he slid
  # backward without moving his legs, and brawler froze for the first 4 of 8 frames. Name the cycle.
  [walkB]="walks backward with a complete and clearly visible walking cycle, repeated steadily for the whole clip: he lifts one foot right off the ground, swings that leg back behind him and plants it, then does the same with the other leg, over and over. The legs alternate continuously and are never both planted still at the same time. Guard stays up and his torso stays upright and facing right"
  [crouch]="ducks down low into a compact crouching guard and holds it"
  [block]="settles into a tight high guard, both forearms raised in front of his head and chest, and braces there steadily on his feet, weight shifting only slightly the whole time"
  [blockCrouch]="squats all the way down into a deep low crouch, thighs parallel to the ground and torso upright, both forearms raised in a low guard covering his body, and braces there. He NEVER stands up tall and NEVER lies down; only his weight shifts slightly"
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
  # jiujitsu ONLY. `audit:boxes` measured his air normals as the roster's outliers: the fist lands at
  # 163-193px on airLight against a box at 80-130, and 113-169 against 40-100 -- he throws them at his
  # own head height while the brawler and monk both angle down into their boxes. "Angled downward" was
  # evidently too weak on its own, so these name the TARGET below him and the height the fist ends at.
  # Keyed per-fighter rather than edited in place: the shared text is correct for the other two.
  [jiujitsu/airLight]="leaps into the air with his knees tucked up and throws one fast jumping jab punched STEEPLY DOWNWARD at an opponent standing on the ground below him: the fist drives down and forward together, ending well out in front of him and BELOW the level of his own hips, so his whole arm slants down toward the ground. He never punches straight out at his own head height. He stays airborne with his feet off the ground the whole time"
  [jiujitsu/airHeavy]="leaps into the air with his knees tucked up and throws one heavy diving punch aimed STEEPLY DOWNWARD at an opponent standing on the ground below him: he commits his whole body behind it, the fist driving down and forward until it is far out in front of him and DOWN AT THE LEVEL OF HIS OWN KNEES, his arm slanting steeply toward the ground. He never punches straight out at his own head height. He stays airborne with his feet off the ground the whole time"
  [crouchLight]="is squatting all the way down in a deep full crouch the entire time, buttocks near his heels and thighs parallel to the ground, torso upright. He NEVER stands up tall and NEVER lies down. From that deep squat he throws one fast straight punch: the lead arm shoots forward at knee height until the elbow is completely straight and the fist is far out in front of his knees, then snaps back. The legs stay folded in the deep squat while only the arm moves"
  [crouchHeavy]="is squatting all the way down in a deep full crouch the entire time, thighs parallel to the ground, and swings one heavy low sweeping attack along the floor at ankle height. He NEVER stands up tall and NEVER lies down"
  # Phase 15 supers. Each is a MULTI-HIT flurry, so unlike every other attack here the prompt names a
  # repeat COUNT: the sim lands one hit per authored window (brawler 4, jiujitsu 5, monk 5) and the art
  # has to show that many blows or the count on screen disagrees with the count in the boxes. The clip
  # also has to open on the charge — the sheet's first frames ARE the wind-up (there is no separate
  # specialCharge state), which is why the charge is described first and explicitly given "a moment".
  # Do NOT append SPAN_CLIP to these: it forbids repeating the motion, which is the whole move.
  # First pass asked for a "REVOLVING uppercut — spinning as he rises ... comes down and rises again"
  # and the model put him FLAT ON HIS BACK on frame 1. Same failure the crouch prompts hit: any wording
  # that lets the body leave vertical gets taken to the floor. The spin is decoration; the four rising
  # fists are the move. Drop the spin, name the arm travel, and forbid the ground by name.
  # Pass 3 got the fist high but PURELY VERTICAL — the arm rose beside his own head and never travelled
  # toward the opponent, so on screen the super never reached across the gap the hit box claims (the
  # box reaches 145px forward). An attack animation has to move the striking hand FORWARD, into the
  # space where the other fighter stands; height alone reads as raising your arm, not as hitting.
  [brawler/special]="throws FOUR big rising uppercuts, one after another, at an opponent standing just in front of him to the RIGHT. On each one his fist starts down beside his hip and drives FORWARD and upward together, punching out to the RIGHT far in front of his own body — the arm ends completely straight and stretched out ahead of him, elbow locked, the fist reaching well past where his own toes are and up at head height — and he HOLDS it stretched out there for a beat before pulling it back to his hip and immediately driving the other fist forward the same way. The fist reaching FAR OUT IN FRONT OF HIM to the right is the single biggest and most obvious thing in the clip; he is at full forward stretch far more of the time than he is with his arms in. He stays standing upright on his feet the ENTIRE time — he NEVER falls over, NEVER lies down, NEVER goes to the ground, NEVER spins, and never leaves the frame. Perfectly flat uniform magenta background, no texture or speckle"
  [jiujitsu/special]="drops into a low braced stance for a moment with his arms tucked, then launches into a SPINNING BREAKDANCE SWEEP — rotating on one hand and one foot with his legs scything around him in a wide circle — completing FIVE full distinct rotations across the clip, each sweep of the legs clearly separate from the last. He stays low and centred and never leaves the frame. Perfectly flat uniform magenta background, no texture or speckle"
  # First pass named the move ("a RISING PALM BARRAGE") but never named the ARM TRAVEL, and measured the
  # lowest motion on the roster (0.31 peak, 8 near-identical horse-stance frames). Describing the limb
  # reaching full extension is what made attackLight work; describing the move's name is not enough.
  [monk/special]="sinks into a deep horse stance for a moment with both palms drawn back at his waist, then drives out FIVE distinct open-palm thrusts, alternating hands: on each one the arm shoots forward and upward until the elbow is completely straight and the open palm is far out in front of him, then pulls all the way back to his waist ready for the next. Each strike reaches higher than the last, from chest height up to above his own head. The arm fully extending is the single biggest movement in the clip. His feet stay planted, he stays standing, and he never leaves the frame. Perfectly flat uniform magenta background, no texture or speckle"
)
# Motion text used only when a START_OVERRIDE supplies the stance: the pose is already correct in the
# start frame, so the prompt asks for the ARM ALONE and explicitly freezes everything else.
declare -A MOTION_FROM_START=(
  [monk/crouch]="holds exactly the low crouched position of the start image, breathing and shifting his weight very slightly. He stays down the whole time and never rises"
  # The monk's crouch normals named the CROUCH but never the strike's HEIGHT, and `audit:boxes`
  # measured the result: his fist lands at 100-123px on crouchLight against a box at 18-58, and
  # 73-126 against 6-48 on crouchHeavy -- he squats correctly and then punches at chest height. The
  # box cannot follow the art here the way the jiujitsu special's could, because crouch normals are
  # DEFINED as lows (they have to clear guardStand's 70 floor), so the art is what has to come down.
  # Asking for KNEE height landed the fist at 61-127px against a box at 18-58 -- better than the
  # 100-123 it measured before, still 3px short. The model lands consistently HIGHER than asked (the
  # Phase 04 "inflates any requested band" lesson, in the vertical), so aim at the SHIN to get a knee.
  [monk/crouchLight]="stays in exactly the low crouched position of the start image without raising his hips or head at all, and punches LOW along the floor: his lead arm shoots straight forward at SHIN HEIGHT, the fist skimming forward just above the ground level with his own ankles and NEVER rising as high as his own knees, until the elbow is completely straight and the fist is far out in front of him, then pulls back. ONLY the arm moves -- his head, shoulders and hips do not rise at all"
  [monk/crouchHeavy]="stays in exactly the low crouched position of the start image without raising his hips or head at all, and sweeps one heavy low attack forward ALONG THE GROUND at ankle height: the striking arm or leg skims just above the floor, reaching far out in front of him and never rising as high as his own knees, then returns. His hips stay down the whole time. ${SPAN_CLIP}"
  [jiujitsu/crouchLight]="stays in exactly the low crouched position of the start image without raising his hips or head at all, and punches: his lead arm shoots straight forward until the elbow is completely straight and the fist is far out in front of him, then pulls back to his chest. ONLY the arm moves. ${SPAN_CLIP}"
  # block / blockCrouch start FROM the guard pose, so the prompt just holds it — no wind-up, the guard
  # is up from frame 0. Only a slight, steady weight shift; the pose itself never changes.
  [brawler/block]="holds exactly the high guard pose of the start image, both forearms up covering the head and chest, bracing steadily on his feet with only a slight weight shift. The guard never lowers and the pose never changes"
  [jiujitsu/block]="holds exactly the high guard pose of the start image, both forearms up covering the head and chest, bracing steadily on his feet with only a slight weight shift. The guard never lowers and the pose never changes"
  [monk/block]="holds exactly the high guard pose of the start image, both arms up in front of the head and chest, bracing steadily on his feet with only a slight weight shift. The guard never lowers and the pose never changes"
  # blockCrouch: stay fully crouched but keep a gentle, continuous breathing sway so the pose is alive
  # (not a frozen still). The background must stay a perfectly flat uniform magenta with no texture or
  # speckle, or the chroma key leaves green fragments floating around him.
  [brawler/blockCrouch]="stays fully crouched in a low guard the ENTIRE time — hips down, knees bent, forearms up covering his body — and breathes with a gentle continuous sway, his shoulders and torso rising and settling a little and his weight shifting slightly. He NEVER rises up, NEVER straightens his legs, and NEVER lowers the guard. Perfectly flat uniform magenta background, no texture or speckle"
  # Phase 13b asked these two for a BOB, to stop a held guard reading as a frozen still. Playing it,
  # the bob is what reads wrong: jiujitsu measured 9px of vertical spread and monk 17px (9% of his
  # standing height) and both look like a fighter jumping on the spot rather than braced. The bob was
  # never load-bearing — `blockCrouch` loops (loop:true), and a loop of near-identical held frames is
  # simply a steady guard, which is the intent. So these now HOLD, exactly like the high `block`
  # prompts above: a breath, not a bounce. Do not reintroduce a bob count here.
  [jiujitsu/blockCrouch]="holds exactly the deep low crouching guard pose of the start image for the whole clip — hips down near his heels, knees bent, forearms up in front of his face and chest — and simply breathes there, his shoulders rising and settling very slightly and his weight easing a little from one foot to the other. He does NOT bob, does NOT bounce, and does NOT dip up and down: the top of his head stays at very nearly the same height in every single frame. He NEVER stands up, NEVER straightens his legs, and NEVER lowers the guard. Perfectly flat uniform magenta background, no texture or speckle"
  [monk/blockCrouch]="holds exactly the deep crouching pose of the start image for the whole clip — hips dropped low near his heels, knees bent well past ninety degrees, torso upright — with both forearms raised in a tight guard covering his face and chest, and simply breathes there, his shoulders rising and settling very slightly. He does NOT bob, does NOT bounce, and does NOT dip up and down: the top of his bald head stays at very nearly the same height in every single frame, no higher than it is in the start image. He NEVER stands up, NEVER straightens his legs, NEVER rises out of the squat, and NEVER lowers the guard. Perfectly flat uniform magenta background, no texture or speckle"
)
STATES=("$@"); [ ${#STATES[@]} -eq 0 ] && STATES=(walkF walkB crouch block blockCrouch jumpRise jumpFall attackLight attackHeavy airLight airHeavy crouchLight crouchHeavy special hitstun blockstun knockdown ko)

for ST in "${STATES[@]}"; do
  DIR="concepts/characters/sprites/$FID/$ST"; MP4="concepts/characters/video/$FID/$ST.mp4"
  N=$(node -e "console.log(require('./public/configs/character-gym.json').$FID.render.sheets.$ST.frames)")
  have=$(ls "$DIR"/[0-9][0-9].png 2>/dev/null | wc -l)
  if [ "$have" -ge "$N" ]; then echo "skip $FID/$ST (have $have/$N)"; continue; fi
  mkdir -p "$DIR" "concepts/characters/video/$FID"
  SI="$START"; [ -n "${START_OVERRIDE[$FID/$ST]:-}" ] && [ -f "${START_OVERRIDE[$FID/$ST]}" ] && SI="${START_OVERRIDE[$FID/$ST]}"
  # A motion may be keyed per-fighter (<fid>/<state>) when the move itself differs between fighters —
  # the specials do, since each has its own super. Fall back to the shared per-state text.
  MOT="${MOTION[$FID/$ST]:-${MOTION[$ST]:-}}"
  [ -n "$MOT" ] || { echo "FAIL $FID/$ST (no MOTION entry)"; continue; }
  [ "$SI" != "$START" ] && MOT="${MOTION_FROM_START[$FID/$ST]:-$MOT}"
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
