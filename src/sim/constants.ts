// Fixed-simulation constants. All timing is in ticks (60 Hz), all space in pixels.

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
/** clamp a render frame's dt so a stall can't spiral the accumulator */
export const MAX_FRAME = 0.25;

// Stage / world. STAGE_WIDTH is the WORLD playfield (sim: spatial MAX_X, world CENTER);
// VIEW_WIDTH is the CAMERA/canvas width (render only). World > view = room for the camera to scroll.
// Numbers locked by concepts/backgrounds/README.md § Recommended Phase 08 config (1697px layers).
export const STAGE_WIDTH = 1696;
export const VIEW_WIDTH = 1280;
export const STAGE_HEIGHT = 720;
export const GROUND_Y = 620; // feet line (screen y-down)
// Fighter CENTRE cannot pass this from either edge. Set from the art, not by feel: the widest
// outward extent of any frame in the roster is 116px (jiujitsu `ko`, frames 3-5; `knockdown` is
// 106px), so a margin below that clips the body against the camera's world bound at the wall. It
// sat at 90 for phases and cropped 26px off a cornered KO — invisible until Phase 12's zoom
// magnified it. Re-measure with scripts/check-attack-sync.py's forward_reach if the art changes.
export const STAGE_MARGIN = 116;
// Max horizontal gap between the two fighters. Without it a pair can reach 1516px apart (the two
// wall clamps) while the camera view is only VIEW_WIDTH=1280, so the midpoint follow-camera pushes
// both off-screen. Cap it so BOTH full sprites stay framed at 1:1 zoom — the classic 2D-fighter
// screen rule (you can't walk past the edge). The 240 = 2×120 leaves 120px of slack each side of a
// fighter's CENTER, which covers the widest measured outward sprite extent (~116px, jiujitsu KO/
// knockdown), so no pose clips at the edge even at max separation. See spatial.ts.
export const MAX_SEPARATION = VIEW_WIDTH - 240; // 1040

export const START_GAP = 260; // initial horizontal distance between the two fighters

// Match
export const ROUND_TIME = 60; // seconds
export const ROUNDS_TO_WIN = 2; // best of 3
export const INTRO_TICKS = 90; // "Round X ... Fight!" freeze before control
export const ROUND_END_TICKS = 120; // pause after a KO/timeout before next round
