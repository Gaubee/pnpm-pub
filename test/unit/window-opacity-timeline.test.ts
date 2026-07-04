/**
 * Feature: WebUI tray opacity timeline
 *
 * Scenario: Given auto-close is authorized, When the WebUI starts the exit
 * timeline, Then opacity follows three exact 0.5Hz breathing pulses.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  BREATH_EASING,
  countdownFromExitTime,
  exitOpacityKeyframes,
  EXIT_DURATION_MS,
  EXIT_SETTLE_EASING,
  WINDOW_ENTER_SEED_OPACITY,
} from "../../webui/src/lib/window-opacity-timeline.js";

describe("Feature: WebUI tray opacity timeline", () => {
  it("Scenario: Given a full-opacity window, When exiting, Then the opacity anchors match the requested 6s breathing curve", () => {
    const frames = exitOpacityKeyframes(1);

    expect(frames.map((frame) => frame.opacity)).toEqual(["1", "0.8", "0.9", "0.5", "0.7", "0"]);
    expect(frames.map((frame) => frame.offset)).toEqual([0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 1]);
    expect(frames.slice(0, 4).every((frame) => frame.easing === BREATH_EASING)).toBe(true);
    expect(frames[4]?.easing).toBe(EXIT_SETTLE_EASING);
    expect(frames.at(-1)?.easing).toBeUndefined();
  });

  it("Scenario: Given an interrupted enter animation, When exiting is queued, Then the first exit anchor starts from the current opacity", () => {
    const frames = exitOpacityKeyframes(0.42);

    expect(frames[0]).toEqual({
      opacity: "0.42",
      offset: 0,
      easing: BREATH_EASING,
    });
  });

  it("Scenario: Given the native window is opened, When enter animation starts, Then it uses the shared nonzero opacity seed", () => {
    expect(WINDOW_ENTER_SEED_OPACITY).toBe(0.1);
  });

  it("Scenario: Given the 6s exit timeline, When deriving the visible countdown, Then it remains a projection of animation time", () => {
    expect(EXIT_DURATION_MS).toBe(6000);
    expect(countdownFromExitTime(0)).toBe(5);
    expect(countdownFromExitTime(1000)).toBe(4);
    expect(countdownFromExitTime(5000)).toBe(0);
    expect(countdownFromExitTime(6000)).toBe(0);
  });
});
