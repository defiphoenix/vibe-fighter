import { describe, expect, it } from "vitest";
import {
  TOUCH_BUTTONS, TouchPadState, hitButton, isTouchDevice, shouldBlockForOrientation, touchLayout,
} from "./touch";
import { VIEW_WIDTH, STAGE_HEIGHT } from "../sim/constants";

const LIGHT = touchLayout().find((b) => b.id === "light")!;
const LEFT = touchLayout().find((b) => b.id === "left")!;

describe("isTouchDevice", () => {
  it("is a phone: touch points, no fine pointer", () => {
    expect(isTouchDevice({ maxTouchPoints: 5, anyPointerFine: false })).toBe(true);
  });

  it("is NOT a plain desktop", () => {
    expect(isTouchDevice({ maxTouchPoints: 0, anyPointerFine: true })).toBe(false);
  });

  /** The case capability-alone gets wrong. A touchscreen laptop has a trackpad, and local two-player
   *  is exactly what a laptop is good at — taking it away is a regression, not mobile support. */
  it("is NOT a touchscreen laptop (touch AND a mouse)", () => {
    expect(isTouchDevice({ maxTouchPoints: 10, anyPointerFine: true })).toBe(false);
  });

  it("is not a mouseless kiosk with no touch either", () => {
    expect(isTouchDevice({ maxTouchPoints: 0, anyPointerFine: false })).toBe(false);
  });
});

describe("shouldBlockForOrientation", () => {
  it("blocks a touch device in portrait", () => {
    expect(shouldBlockForOrientation({ touch: true, width: 390, height: 844 })).toBe(true);
  });

  it("clears the instant it is landscape", () => {
    expect(shouldBlockForOrientation({ touch: true, width: 844, height: 390 })).toBe(false);
  });

  it("never blocks a desktop, however narrow the window", () => {
    expect(shouldBlockForOrientation({ touch: false, width: 390, height: 844 })).toBe(false);
  });

  it("treats square as landscape — rotating would fix nothing", () => {
    expect(shouldBlockForOrientation({ touch: true, width: 500, height: 500 })).toBe(false);
  });
});

describe("touchLayout", () => {
  it("gives every action its own button", () => {
    const ids = touchLayout().map((b) => b.id);
    expect([...ids].sort()).toEqual([...TOUCH_BUTTONS].sort());
  });

  it("keeps every button fully inside the viewport", () => {
    for (const b of touchLayout()) {
      expect(b.x - b.r, `${b.id} left edge`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.r, `${b.id} right edge`).toBeLessThanOrEqual(VIEW_WIDTH);
      expect(b.y - b.r, `${b.id} top edge`).toBeGreaterThanOrEqual(0);
      expect(b.y + b.r, `${b.id} bottom edge`).toBeLessThanOrEqual(STAGE_HEIGHT);
    }
  });

  /** Overlapping circles mean one tap lands on whichever is first in the array — i.e. a button you
   *  cannot reliably press. Measured as a geometric invariant, not eyeballed off the constants. */
  it("never overlaps two buttons", () => {
    const l = touchLayout();
    for (let i = 0; i < l.length; i++) {
      for (let j = i + 1; j < l.length; j++) {
        const d = Math.hypot(l[i].x - l[j].x, l[i].y - l[j].y);
        expect(d, `${l[i].id} vs ${l[j].id}`).toBeGreaterThan(l[i].r + l[j].r);
      }
    }
  });

  it("labels the attacks by name, so a first-timer can read what punches", () => {
    const byId = Object.fromEntries(touchLayout().map((b) => [b.id, b.label]));
    expect(byId.light).toBe("LIGHT");
    expect(byId.heavy).toBe("HEAVY");
    expect(byId.block).toBe("BLOCK");
    expect(byId.special).toBe("SUPER");
    expect(byId.up).toBe("JUMP");
    expect(byId.down).toBe("CROUCH");
  });

  it("hit-tests inside, and misses the gap between clusters", () => {
    expect(hitButton(touchLayout(), LIGHT.x, LIGHT.y)).toBe("light");
    expect(hitButton(touchLayout(), LIGHT.x, LIGHT.y - LIGHT.r + 1)).toBe("light");
    expect(hitButton(touchLayout(), VIEW_WIDTH / 2, STAGE_HEIGHT / 2)).toBeNull();
    expect(hitButton(touchLayout(), LIGHT.x, LIGHT.y - LIGHT.r - 2)).toBeNull();
  });
});

describe("TouchPadState", () => {
  const tapLight = (s: TouchPadState, id = 1): void => {
    s.down(id, LIGHT.x, LIGHT.y);
    s.up(id);
  };

  it("a held button reads true on every consume, and only ever fires one press", () => {
    const s = new TouchPadState();
    s.down(1, LIGHT.x, LIGHT.y);
    expect(s.consume().light).toBe(true);
    expect(s.consume().light).toBe(true);
    expect(s.consume().light).toBe(true);
    s.up(1);
    expect(s.consume().light).toBe(false);
  });

  /**
   * The whole reason this is a press QUEUE. Phaser dispatches touch synchronously from the DOM
   * listener, so a quick tap — and every `page.touchscreen.tap` under the e2e's pumped clock — has
   * both its down and its up land between two frames. A "is a finger on it" read would see nothing
   * at all and the attack would silently never come out.
   */
  it("a tap that starts AND ends between two consumes still reads held for exactly one frame", () => {
    const s = new TouchPadState();
    tapLight(s);
    expect(s.consume().light).toBe(true);
    expect(s.consume().light).toBe(false);
  });

  /**
   * And the reason it is not merely sticky. InputReader turns held into an edge by comparing against
   * the PREVIOUS frame, so a second `true` straight after a `true` is not an edge at all — the second
   * tap of a mash would vanish. The queue forces one false frame in between.
   */
  it("a fast re-tap after a reported press is not swallowed", () => {
    const s = new TouchPadState();
    tapLight(s);
    expect(s.consume().light).toBe(true); // first tap
    tapLight(s, 2); // whole second tap lands before the next frame
    expect(s.consume().light).toBe(false); // forced gap, so the next true is a rising edge
    expect(s.consume().light).toBe(true); // second tap, one frame late but not lost
    expect(s.consume().light).toBe(false);
  });

  it("holds two buttons on two pointers at once", () => {
    const s = new TouchPadState();
    s.down(1, LEFT.x, LEFT.y);
    s.down(2, LIGHT.x, LIGHT.y);
    const held = s.consume();
    expect(held.left).toBe(true);
    expect(held.light).toBe(true);
    s.up(2);
    const after = s.consume();
    expect(after.left).toBe(true);
    expect(after.light).toBe(false);
  });

  it("two pointers on the SAME button: lifting one does not release it", () => {
    const s = new TouchPadState();
    s.down(1, LEFT.x, LEFT.y);
    s.down(2, LEFT.x + 4, LEFT.y);
    s.consume();
    s.consume();
    s.consume(); // drain the two queued presses and their gap
    expect(s.consume().left).toBe(true);
    s.up(1);
    expect(s.consume().left).toBe(true); // pointer 2 is still on it
    s.up(2);
    expect(s.consume().left).toBe(false);
  });

  it("sliding a thumb off a button releases it, and onto another takes that one", () => {
    const s = new TouchPadState();
    s.down(1, LEFT.x, LEFT.y);
    s.consume();
    s.move(1, VIEW_WIDTH / 2, STAGE_HEIGHT / 2);
    expect(s.consume().left).toBe(false);
    s.move(1, LIGHT.x, LIGHT.y);
    const held = s.consume();
    expect(held.light).toBe(true);
    expect(held.left).toBe(false);
  });

  /** A slide is not a press: queueing it would fire an attack the player never tapped. */
  it("sliding ONTO a button does not queue a press, so a release ends it immediately", () => {
    const s = new TouchPadState();
    s.down(1, LEFT.x, LEFT.y);
    s.consume();
    s.move(1, LIGHT.x, LIGHT.y);
    expect(s.consume().light).toBe(true);
    s.up(1);
    expect(s.consume().light).toBe(false);
  });

  it("a pointer that started off the pad cannot grab a button mid-drag", () => {
    const s = new TouchPadState();
    s.down(1, VIEW_WIDTH / 2, 100);
    s.move(1, LIGHT.x, LIGHT.y);
    expect(s.consume().light).toBe(false);
  });

  /** The `pointerupoutside` / `pointercancel` net. A touch that ends off the canvas — the letterbox
   *  bars on a phone are outside the canvas ELEMENT — must not leave the button held forever. */
  it("reconcile releases a pointer Phaser no longer considers live", () => {
    const s = new TouchPadState();
    s.down(1, LEFT.x, LEFT.y);
    s.down(2, LIGHT.x, LIGHT.y);
    s.consume();
    s.consume();
    expect(s.consume().left).toBe(true);
    s.reconcile([2]); // pointer 1 vanished without an up
    expect(s.consume().left).toBe(false);
    expect(s.consume().light).toBe(true);
  });

  it("an inactive pad collects nothing, and going inactive drops what it held", () => {
    const s = new TouchPadState();
    s.down(1, LEFT.x, LEFT.y);
    s.setActive(false);
    expect(s.consume().left).toBe(false);
    s.down(2, LIGHT.x, LIGHT.y);
    expect(s.consume().light).toBe(false);
    s.setActive(true);
    s.down(3, LIGHT.x, LIGHT.y);
    expect(s.consume().light).toBe(true);
  });

  it("cancel() clears held, queued and the gap state together", () => {
    const s = new TouchPadState();
    s.down(1, LIGHT.x, LIGHT.y);
    s.cancel();
    expect(s.consume().light).toBe(false);
    tapLight(s, 2);
    expect(s.consume().light).toBe(true); // and the next press still works from a clean slate
  });
});
