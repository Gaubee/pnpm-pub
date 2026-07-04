import { WINDOW_ENTER_SEED_OPACITY } from "$shared/window-opacity.js";

export { WINDOW_ENTER_SEED_OPACITY };

export const ENTER_DURATION_MS = 1000;
export const EXIT_DURATION_MS = 6000;
export const IOS_ENTER_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Sine-like ease-in-out makes each first-4s trough/peak slow down like breath.
 * The final 0.7 -> 0 leg keeps the exit settle curve instead of pulsing again.
 */
export const BREATH_EASING = "cubic-bezier(0.37, 0, 0.63, 1)";
export const EXIT_SETTLE_EASING = "cubic-bezier(0.34, 1, 0.64, 1)";

export interface OpacityKeyframe extends Keyframe {
  opacity: string;
  offset: number;
  easing?: string;
}

const EXIT_OPACITY_ANCHORS = [
  { timeMs: 0, opacity: null, easing: BREATH_EASING },
  { timeMs: 1000, opacity: 0.8, easing: BREATH_EASING },
  { timeMs: 2000, opacity: 0.9, easing: BREATH_EASING },
  { timeMs: 3000, opacity: 0.5, easing: BREATH_EASING },
  { timeMs: 4000, opacity: 0.7, easing: EXIT_SETTLE_EASING },
  { timeMs: EXIT_DURATION_MS, opacity: 0 },
] as const;

export function exitOpacityKeyframes(fromOpacity: number): OpacityKeyframe[] {
  return EXIT_OPACITY_ANCHORS.map((anchor) => ({
    opacity: String(anchor.opacity ?? fromOpacity),
    offset: anchor.timeMs / EXIT_DURATION_MS,
    ...("easing" in anchor ? { easing: anchor.easing } : {}),
  }));
}

export function countdownFromExitTime(currentTime: number): number {
  const remainingMs = Math.max(0, EXIT_DURATION_MS - currentTime);
  return Math.max(0, Math.ceil(remainingMs / 1000) - 1);
}
