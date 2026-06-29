/**
 * Per-route default OS-window geometry.
 *
 * The opentray host creates the window at a fixed size (see daemon/index.ts
 * `WINDOW_WIDTH`/`WINDOW_HEIGHT`), but each surface has its own ideal aspect:
 *   - home        : 16:9 (landscape — timeline + action bar)
 *   - add-profile : 3:5  (portrait — a single narrow form)
 *
 * `resizeWindow()` calls the native bridge (`navigator.opentrayWindow.resizeTo`)
 * when present and is a silent no-op in a plain browser / while the host is
 * still attaching. Values are in logical CSS pixels and kept in lockstep with
 * the daemon's tray-panel sizes.
 */

/** Home / Events hub — 16:9 landscape. Fits the `max-w-2xl` content rail. */
export const HOME_WINDOW_SIZE = { width: 680, height: 383 } as const;
/** First-profile onboarding — near-square form surface. */
export const ADD_PROFILE_WINDOW_SIZE = { width: 450, height: 464 } as const;

const bridge = (): Navigator['opentrayWindow'] =>
	navigator.opentrayWindow ?? navigator.opentray?.window ?? undefined;

/**
 * Resize the OS window. Safe to call on every page mount: it no-ops when the
 * bridge is absent, and only re-issues when the size actually changes (so
 * revisiting a route of the same size doesn't flicker).
 */
export async function resizeWindow(size: { width: number; height: number }): Promise<void> {
	const ot = bridge();
	if (!ot?.resizeTo) return;
	// Avoid redundant resizes: the host preserves the last-set size, so only
	// call when the target differs from what we last requested this session.
	if (
		lastRequested?.width === size.width &&
		lastRequested?.height === size.height
	) {
		return;
	}
	try {
		await ot.resizeTo(size.width, size.height);
		lastRequested = { ...size };
	} catch {
		// Resize is a UX nicety, never fatal — ignore host refusals.
	}
}

let lastRequested: { width: number; height: number } | null = null;
