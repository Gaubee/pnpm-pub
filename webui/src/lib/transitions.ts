/**
 * Shared list-transition presets.
 *
 * Every keyed `{#each}` list in the app reuses these so the enter/leave/reorder
 * rhythm is uniform, and `prefers-reduced-motion` is honored centrally (Svelte
 * transitions do NOT auto-respect it, unlike the CSS keyframes in layout.css).
 *
 * Usage on the each's direct child element:
 *   import { fade } from 'svelte/transition';
 *   import { flipParams, enterParams, leaveParams } from '$lib/transitions.js';
 *   animate:flip={flipParams}
 *   in:fade={enterParams(i)}
 *   out:fade={leaveParams}
 */
const REDUCED = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** flip duration for list reordering. 0 under reduced-motion (instant reorder). */
export const flipParams = { duration: REDUCED ? 0 : 200 };

/** Enter fade params. Pass the each index for an optional stagger delay. */
export function enterParams(index = 0): { duration: number; delay: number } {
	return { duration: REDUCED ? 0 : 150, delay: REDUCED ? 0 : Math.min(index, 8) * 30 };
}

/** Leave fade params. */
export const leaveParams = { duration: REDUCED ? 0 : 150 };
