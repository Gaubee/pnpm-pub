<!--
	Titlebar drag region for the overlay-chrome window (Chapter 6.1.3 / skill
	"Overlay Native Controls").

	The opentray window is created with `windowControlsOverlay: true`, so the OS
	min/max/close cluster stays and the page occupies the titlebar area. Per the
	skill (ext-webview.md), drag is bound through the NATIVE
	`navigator.opentrayWindow.startAppRegionDrag()` API — never injected CSS
	app-region. On pointerdown over this strip we hand control to the native
	window manager, which performs the drag (and keeps the OS controls clickable
	because they live outside the page's titlebar area).

	Geometry: we read `navigator.opentrayWindow.overlay.getTitlebarAreaRect()` so
	the strip's right padding always reserves exactly the OS control width, and
	we react to `geometrychange` if the platform reshuffles controls. When
	opentrayWindow is absent (a plain browser, or the window lacks overlay
	support), the strip renders inert — it just keeps the visual titlebar gap.
-->
<script lang="ts">
	import { onMount } from 'svelte';

	type Rect = { x: number; y: number; width: number; height: number };

	interface OverlayGeometry {
		getTitlebarAreaRect(): Promise<Rect>;
		addEventListener?(event: string, handler: (e: { titlebarAreaRect: Rect }) => void): void;
		removeEventListener?(event: string, handler: (e: { titlebarAreaRect: Rect }) => void): void;
		listen?(event: string, handler: (e: { titlebarAreaRect: Rect }) => void): Promise<() => Promise<void>>;
	}

	// Reserved right inset for the OS window-control cluster, in CSS px.
	// Updated from the overlay geometry; falls back to a macOS-like 70px.
	let controlInset = $state(70);

	const ot = (): { overlay?: OverlayGeometry; startAppRegionDrag?(opts?: { x?: number; y?: number; pointerId?: number }): Promise<unknown> } | undefined =>
		(navigator as unknown as { opentrayWindow?: { overlay?: OverlayGeometry } }).opentrayWindow ??
		(navigator as unknown as { opentray?: { window?: { overlay?: OverlayGeometry } } }).opentray?.window ??
		undefined;

	/** Begin a native window drag when the user grabs the titlebar strip. */
	function onPointerDown(e: PointerEvent) {
		const win = ot();
		try {
			win?.startAppRegionDrag?.({ x: e.clientX, y: e.clientY, pointerId: e.pointerId })?.catch(() => {});
		} catch {
			/* drag is a nicety — never throw */
		}
	}

	onMount(() => {
		const overlay = ot()?.overlay;
		if (!overlay || typeof overlay.getTitlebarAreaRect !== 'function') return;

		const apply = async () => {
			try {
				const rect = await overlay.getTitlebarAreaRect!();
				// The OS controls sit to the right of the titlebar area; the inset
				// is how much of the window width the controls occupy.
				controlInset = Math.max(0, Math.round(globalThis.innerWidth - rect.x - rect.width));
			} catch {
				/* geometry read is best-effort */
			}
		};
		void apply();

		// Prefer listen() (opentray native), fall back to addEventListener.
		let off: (() => void) | undefined;
		if (typeof overlay.listen === 'function') {
			void overlay
				.listen('geometrychange', (e) => {
					controlInset = Math.max(0, Math.round(globalThis.innerWidth - e.titlebarAreaRect.x - e.titlebarAreaRect.width));
				})
				.then((unsub) => (off = () => void unsub?.()));
		} else if (typeof overlay.addEventListener === 'function') {
			const handler = (e: { titlebarAreaRect: Rect }) => {
				controlInset = Math.max(0, Math.round(globalThis.innerWidth - e.titlebarAreaRect.x - e.titlebarAreaRect.width));
			};
			overlay.addEventListener('geometrychange', handler);
			off = () => overlay.removeEventListener?.('geometrychange', handler);
		}
		return () => off?.();
	});
</script>

<!--
	Inert (no buttons) titlebar strip: transparent so the native blur shows
	through, with a right inset reserving space for the OS controls. This element
	only exists to host the native drag gesture — it has no app chrome of its own.
-->
<div
	class="drag-strip shrink-0"
	style="padding-right: {controlInset}px"
	role="toolbar"
	tabindex="-1"
	aria-label="Window titlebar"
	onpointerdown={onPointerDown}
></div>

<style>
	.drag-strip {
		height: 2rem;
		width: 100%;
		background: transparent;
		cursor: default;
	}
</style>
