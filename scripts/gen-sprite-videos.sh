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
  # crouchHeavy gets its OWN reference, not the shared monk-crouch.png. Phase 16: five generations
  # from the shared crouch measured limb reach 50/61/57/55/60px (sd ~4.6) against a box far edge of
  # 156 — run-to-run variance swamped every prompt change, so no amount of resampling or rewording was
  # going to find the +27px needed. CLAUDE.md already named the remaining lever and it was right: the
  # shared reference plants him low AND TUCKED, with his toes under his hips, so a sweep measured
  # "past where his own toes are" barely leaves his body. This reference is that same pose with ONE
  # thing changed — the lead leg stretched out along the floor — built with nano_banana_pro from
  # monk-crouch.png and measured against it: height IDENTICAL (1558px), rear extent identical (700 ->
  # 701), forward extent from the head centre 512 -> 820px. Then shifted 260px left on the canvas
  # (area preserved to the pixel) because the generated foot landed 4px from the right edge, leaving
  # the sweep nowhere to travel; scale must NOT change, since build-sprites applies one idle-derived
  # scale to every sheet and a smaller figure here would ship a smaller monk on this state alone.
  [monk/crouchHeavy]="concepts/characters/crouch-refs/monk-crouchHeavy.png"
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
  # of his standing height, i.e. not a crouch at all.
  #
  # ...and NOT crouch-refs/monk-crouch.png either, which replaced it. That fixed the height and broke
  # the POSE: it is the very reference his `crouch` sheet is generated from, so his crouch-block came
  # out 95% identical to his crouch (measured IoU 0.95) and he had no readable low guard at all. A
  # prompt cannot argue its way out of that — `--start-image` DOMINATES, and a rewrite naming the arm
  # change explicitly was generated and measured: IoU stayed at 0.95, amp at 0.05, completely
  # unchanged. The reference is the lever, not the wording.
  #
  # So: a PURPOSE-BUILT low-guard reference, made by nano_banana_pro FROM monk-crouch.png with the
  # legs/hips/height held and only the arms replaced (both forearms up, elbows tucked, a boxer's
  # cover). Measured 1558px against the crouch reference's 1557px on the same canvas — the same deep
  # squat, a different upper body, which is exactly the pair of properties this state needs.
  [monk/blockCrouch]="concepts/characters/guard-refs/monk-blockCrouch-v2.png"
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
  # The roster's worst box-vs-art disagreement, and the one sheet in the pass that a box trim could
  # not fix: measured limb reach 50px against a box far edge of 156px, so it connected with ~92px of
  # empty air; trimming the box to the art instead would drop the monk from 118 to 86 effective reach,
  # worst on the move, and turn reach-parity.test.ts red. Its forward spread was also only 6px, which
  # is why check:sync calls it INDETERMINATE and it never got a phase-aligned contact frame either.
  # Two lessons applied: every motion metric is DIRECTION-BLIND (a big vertical swing scores exactly as
  # well as a forward one, and the vertical one is the one that misses), so name the TARGET and the
  # distance rather than the move; and the model lands a strike HIGHER than asked, so name the joint
  # one lower than wanted — this prompt already said "ankle height" and measured a 0..129px band.
  # Keeps ${SPAN_CLIP} and the "HOLDS at full extension" clause TOGETHER, even though they contradict
  # each other on paper ("never hold still" vs "holds"). That combination is the one that measured
  # BEST: limb reach 61px, forward spread 15px, against 50/6 for the shipped version. Replacing it
  # with a clean, non-contradictory explicit timeline ("reach the furthest point by the MIDDLE, hold
  # there, draw the leg back over the final third") sounded strictly better and measured strictly
  # worse — 57px reach, 7px spread, back under the 8px spread floor. Reasoning about these prompts
  # loses to measuring them; do not "fix" this back into something tidier.
  [monk/crouchHeavy]="stays in exactly the low crouched position of the start image without raising his hips or head at all, and sweeps one heavy low attack forward ALONG THE GROUND at an opponent standing just in front of him to the RIGHT: his striking leg skims the floor and extends fully sideways until it reaches well past where his own toes are, far enough to sweep that opponent's ankles, and HOLDS at that full extension before pulling back. The leg never rises as high as his own knees and his hips stay down the whole time. The single biggest movement in the clip is the leg travelling FORWARD, not up. ${SPAN_CLIP}"
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
  # simply a steady guard, which is the intent. So these HOLD: a breath, not a bounce. Do not
  # reintroduce a bob count here.
  #
  # ...but the no-bounce rewrite then overshot into a FROZEN still, which is the other failure and the
  # one a player actually complained about: jiujitsu measured amp 0.06 and monk 0.05, the two lowest
  # numbers on the roster (brawler, untouched, sits at 0.12 and reads fine). Both prompts caused it,
  # in different ways, and both are fixed below:
  #
  #   jiujitsu — asked for breathing and then negated motion FOUR times in one sentence ("does NOT
  #   bob, does NOT bounce, does NOT dip up and down, head at very nearly the same height"). The model
  #   maximises, and what it maximised was the stillness. The height constraint is the one that
  #   killed the bob, so it stays; the three redundant negations go, and the requested motion moves to
  #   where the height clause cannot forbid it — hands and shoulders only.
  #
  #   monk — worse: his START IMAGE is `crouch-refs/monk-crouch.png`, the very reference his `crouch`
  #   sheet is generated from, and the prompt said "holds EXACTLY the pose of the start image".
  #   `--start-image` dominates, so a 95%-identical result is precisely what was ordered — measured
  #   IoU 0.95 against his own `crouch`, i.e. he has no distinguishable low guard at all. The start
  #   image stays (it is what fixed his 86-96%-of-standing-height regression; the older
  #   `guard-refs/monk-blockCrouch.png` is a STANDING pose and must not come back), so the prompt now
  #   names the DIFFERENCE from it — the arms — instead of asking for a copy.
  #
  # Both also name a CYCLE COUNT: ffmpeg samples N frames evenly across the whole 4s clip, so motion
  # without a stated count lands several samples on the same instant and reads as a still.
  # jiujitsu: the head-height clause was DROPPED here after measuring. It is what killed the Phase 13b
  # bob, but it also suppressed everything else with it — the "breathe, do not bob" wording measured
  # amp 0.065, and a rewrite that kept the clause and added a named cycle count measured 0.032, i.e.
  # further toward frozen. So he is now asked for a small, explicit, VISIBLE weight shift instead,
  # accepting a little vertical movement. If the bob returns (measure the head-row spread across the
  # sheet, not the amplitude), the answer is a smaller named shift, not the blanket height clause.
  [jiujitsu/blockCrouch]="holds the deep low crouching guard of the start image for the whole clip — hips down near his heels, knees bent, both forearms up in front of his face and chest — and stays visibly alive in it: he shifts his weight from his back foot to his front foot and back again TWICE, slowly and evenly across the clip, his shoulders and guard hands moving with it. He never stands up, never straightens his legs, and never lowers the guard. Perfectly flat uniform magenta background, no texture or speckle"
  # monk: the start image IS his two-armed low guard now, so this no longer has to argue the pose into
  # existence — which is the whole point of building the reference first.
  #
  # The word "EXACTLY" is deliberately absent. This prompt and the jiujitsu one above were otherwise
  # the same sentence, and the monk's measured amp 0.05 against the jiujitsu's 0.23 — the single
  # difference was "holds exactly the ... guard of the start image" versus "holds the ... guard".
  # "Exactly" reads as an instruction not to change anything, and it wins over every later request for
  # movement. Same family as the four negations that froze the jiujitsu: do not reintroduce it.
  #
  # The motion sentence is the jiujitsu one VERBATIM, and deliberately so. Four attempts on this sheet
  # measured 0.049 / 0.049 / 0.055 / 0.029 while the identically-structured jiujitsu prompt measured
  # 0.225, so the wording that is known to work is worth more than any reasoning about what ought to
  # work: an attempt that swapped the weight shift for hip-rocking — which seemed better suited to a
  # deep squat, since both heels are planted — measured 0.029, the worst of the four. Changing two
  # things at once (that swap AND dropping "exactly") is what made that result uninterpretable.
  # If this needs another pass, change ONE clause and measure.
  [monk/blockCrouch]="holds the deep crouching two-armed guard of the start image for the whole clip — hips dropped low near his heels, knees bent well past ninety degrees, torso upright, both forearms up together in front of his face and chest with the elbows tucked in — and stays visibly alive in it: he shifts his weight from his back foot to his front foot and back again TWICE, slowly and evenly across the clip, his shoulders and guard hands moving with it. He never stands up, never straightens his legs, and never lowers the guard. Perfectly flat uniform magenta background, no texture or speckle"
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
