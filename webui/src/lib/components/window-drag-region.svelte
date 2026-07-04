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

	Geometry: `getTitlebarAreaRect()` returns the titlebar SAFE AREA — the region
	NOT occupied by OS controls, on whichever side the platform puts them
	(macOS traffic lights on the LEFT → rect.x > 0, right edge flush; Windows
	caption buttons on the RIGHT → rect.x ≈ 0, right inset > 0). We therefore
	derive BOTH a left and right safe inset and position every button strictly
	within [safeLeft, safeRight] so nothing overlaps the native controls. We
	react to `geometrychange` if the platform reshuffles controls. When
	opentrayWindow is absent (a plain browser, or the window lacks overlay
	support), the strip renders with conservative symmetric insets.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { userPrefersMode, setMode } from 'mode-watcher';
	import IconSun from '@lucide/svelte/icons/sun';
	import IconMoon from '@lucide/svelte/icons/moon';
	import IconMonitor from '@lucide/svelte/icons/monitor';
	import IconLanguages from '@lucide/svelte/icons/languages';
	import IconPin from '@lucide/svelte/icons/pin';
	import IconPinOff from '@lucide/svelte/icons/pin-off';
	import { _, locale } from 'svelte-i18n';
	import { localeNames, locales, setAppLocale, type AppLocale } from '$lib/i18n.js';
	import { daemon, actions } from '$lib/store.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { OpentrayRect, OpentrayWindowOverlay } from '../../opentray.d.ts';

	/**
	 * The three theme states the titlebar toggle cycles through. Mirrors
	 * mode-watcher's `Mode` ('dark' | 'light' | 'system') — duplicated locally
	 * because mode-watcher doesn't export the type through its public surface.
	 */
	type ThemeMode = 'dark' | 'light' | 'system';

	/**
	 * Safe-area insets derived from the overlay geometry, in CSS px.
	 *   - `safeLeft`: gap before the first usable pixel (macOS traffic lights).
	 *   - `safeRight`: gap after the last usable pixel (Windows caption buttons).
	 * Buttons are positioned `left: safeLeft + N` / `right: safeRight + N` so
	 * they never collide with the native control cluster. Conservative fallbacks
	 * when the overlay is unavailable (plain browser / no overlay support).
	 */
	let safeLeft = $state(8);
	let safeRight = $state(8);

	const ot = (): Navigator['opentrayWindow'] | NonNullable<Navigator['opentray']>['window'] | undefined =>
		navigator.opentrayWindow ?? navigator.opentray?.window ?? undefined;

	/** Begin a native window drag when the user grabs the titlebar strip. */
	function onPointerDown(e: PointerEvent) {
		const win = ot();
		try {
			win?.startAppRegionDrag?.({ x: e.clientX, y: e.clientY, pointerId: e.pointerId })?.catch(() => {});
		} catch {
			/* drag is a nicety — never throw */
		}
	}

	/**
	 * Recompute the safe-area insets from a titlebar rect. The rect is the SAFE
	 * AREA (controls excluded): its left edge is after the macOS traffic lights,
	 * its right edge is before the Windows caption buttons. So the OS controls
	 * occupy [0, rect.x) on the left and [rect.x + rect.width, innerWidth) on
	 * the right. We add a small breathing margin so buttons don't sit flush
	 * against the native cluster.
	 */
	const CONTROL_MARGIN = 4;
	function applyRect(rect: OpentrayRect): void {
		const inner = globalThis.innerWidth;
		const left = Math.max(0, Math.round(rect.x));
		const right = Math.max(0, Math.round(inner - rect.x - rect.width));
		safeLeft = left + (left > 0 ? CONTROL_MARGIN : 0);
		safeRight = right + (right > 0 ? CONTROL_MARGIN : 0);
	}

	// Three-state theme cycle: system → light → dark → system.
	// `userPrefersMode.current` is the user's explicit pick ('dark'|'light'|'system').
	const ORDER: ThemeMode[] = ['system', 'light', 'dark'];
	const LABEL_KEY: Record<ThemeMode, string> = {
		system: 'titlebar.themeSystem',
		light: 'titlebar.themeLight',
		dark: 'titlebar.themeDark',
	};
	const currentMode = $derived(userPrefersMode.current);
	const currentLocale = $derived(($locale ?? 'en') as AppLocale);
	function cycleTheme(): void {
		const idx = ORDER.indexOf(currentMode);
		const next = ORDER[(idx + 1) % ORDER.length] ?? 'system';
		setMode(next);
	}

	function onLocaleChange(event: Event): void {
		const select = event.currentTarget as HTMLSelectElement;
		setAppLocale(select.value as AppLocale);
	}

	// "Keep open" pin (Chapter 6.4). The window is ALWAYS kept on top; this pin
	// only decides whether blur auto-hide is enabled. When unpinned, daemon blur
	// may authorize page-owned auto-close; the countdown is derived locally from
	// the WebAnimation opacity timeline.
	const pinned = $derived($daemon.pinned);
	const pinCountdown = $derived($daemon.pinCountdown);
	const counting = $derived(pinCountdown !== null);

	/** Tooltip varies by state: pinned / unpinned / countdown-active. */
	const pinLabel = $derived(
		counting
			? $_('titlebar.pinCountdownHint')
			: pinned
				? $_('titlebar.keepOpen')
				: $_('titlebar.keepOpenOff'),
	);

	onMount(() => {
		const overlay: OpentrayWindowOverlay | undefined = ot()?.overlay;
		if (!overlay) return;

		const apply = async () => {
			try {
				applyRect(await overlay.getTitlebarAreaRect());
			} catch {
				/* geometry read is best-effort — keep the conservative insets */
			}
		};
		void apply();

		// Prefer listen() (opentray native), fall back to addEventListener.
		let off: (() => void) | undefined;
		if (overlay.listen) {
			void overlay
				.listen('geometrychange', (e) => applyRect(e.titlebarAreaRect))
				.then((unsub) => (off = () => void unsub?.()));
		} else if (overlay.addEventListener) {
			const handler = (e: { titlebarAreaRect: OpentrayRect }) => applyRect(e.titlebarAreaRect);
			overlay.addEventListener('geometrychange', handler);
			off = () => overlay.removeEventListener?.('geometrychange', handler);
		}
		return () => off?.();
	});
</script>

<!--
	Titlebar strip: transparent so the native blur shows through. The strip
	hosts the native drag gesture. Buttons are anchored to the safe-area edges
	(`safeLeft` / `safeRight`) so they never overlap the OS control cluster:
	  - pin (keepOnTop) sits at the inline-start edge (left)
	  - locale + theme sit at the inline-end edge (right, before caption buttons)
	Each interactive control stops pointerdown so grabbing it never starts a
	window drag. The strip itself carries symmetric horizontal padding equal to
	the safe insets so the drag region also stays clear of the native controls.
-->
<div
	data-window-titlebar
	class="drag-strip no-drag shrink-0"
	style="padding-left: {safeLeft}px; padding-right: {safeRight}px"
	role="toolbar"
	tabindex="-1"
		aria-label={$_('titlebar.windowTitlebar')}
		onpointerdown={onPointerDown}
	>
	<!--
		"Keep open" pin (Chapter 6.4) — inline-start. A ghost icon Button matching
		the Workspaces page's pin affordance: the ICON turns brand-colored when
		active (Pin), muted otherwise (PinOff). The window is always kept on top;
		this pin only decides whether blur auto-hide is enabled. The live 5→0
		countdown overlays beside the icon while the page-owned exit animation runs.
		Anchored to the left safe edge so it clears the macOS traffic lights.
	-->
		<Button
			variant="ghost"
			size="sm"
			class="pin-toggle no-drag hover:bg-transparent hover:[backdrop-filter:contrast(1)] dark:hover:bg-transparent {counting ? 'counting' : ''}"
			style="left: {safeLeft + 6}px"
			onclick={() => actions.setPin(!pinned)}
			onpointerdown={(e) => e.stopPropagation()}
			aria-label={pinLabel}
			aria-pressed={pinned}
			title={pinLabel}
		>
		{#if pinned}
			<IconPin class="h-3.5 w-3.5 text-brand" />
		{:else}
			<IconPinOff class="h-3.5 w-3.5" />
		{/if}
		{#if counting}
			<span class="pin-countdown" aria-hidden="true">{pinCountdown}</span>
		{/if}
	</Button>
	<div
		class="locale-picker no-drag"
		style="right: {safeRight + 36}px"
		role="group"
		aria-label={$_('common.language')}
		onpointerdown={(e) => e.stopPropagation()}
	>
		<IconLanguages />
		<select
			value={currentLocale}
			aria-label={$_('common.language')}
			title={$_('common.language')}
			onchange={onLocaleChange}
		>
			{#each locales as lang (lang)}
				<option value={lang}>{localeNames[lang]}</option>
			{/each}
		</select>
	</div>
	<button
		type="button"
		class="theme-toggle no-drag"
		style="right: {safeRight + 6}px"
		onclick={cycleTheme}
		onpointerdown={(e) => e.stopPropagation()}
		aria-label={$_(LABEL_KEY[currentMode])}
		title={$_(LABEL_KEY[currentMode])}
	>
		{#if currentMode === 'light'}
			<IconSun />
		{:else if currentMode === 'dark'}
			<IconMoon />
		{:else}
			<IconMonitor />
		{/if}
	</button>
</div>

<style>
	.drag-strip {
		position: relative;
		height: 2rem;
		width: 100%;
		background: transparent;
		cursor: default;
	}
	/*
		pin-toggle wraps the shadcn Button (ghost, icon-sm). We only own its
		ABSOLUTE POSITIONING (anchored to the left safe edge) here — sizing,
		hover/focus come from buttonVariants; the active state is conveyed by the
		brand-colored icon, not a bg fill. The selectors are :global because the
		class is applied to the Button's (child) root element, which Svelte's
		scoped-CSS analyzer can't see.
	*/
	:global(.pin-toggle) {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
	}
	/* During a blur auto-hide countdown, draw the eye so the user notices the
		overlay number and knows clicking here cancels it (and pins the window). */
	:global(.pin-toggle.counting) {
		animation: pin-pulse 1s ease-in-out infinite;
	}
	.pin-countdown {
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		line-height: 1;
	}
	@keyframes pin-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.55;
		}
	}
	.theme-toggle {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 1.5rem;
		width: 1.5rem;
		border-radius: var(--radius-sm);
		color: var(--muted-foreground);
		background: transparent;
		border: none;
		cursor: pointer;
		transition: backdrop-filter 0.12s ease, color 0.12s ease;
	}
	.theme-toggle:hover {
		backdrop-filter: contrast(1);
		color: var(--accent-foreground);
	}
	.theme-toggle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
	.theme-toggle :global(svg) {
		width: 0.875rem;
		height: 0.875rem;
	}
	.locale-picker {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		height: 1.5rem;
		color: var(--muted-foreground);
	}
	.locale-picker :global(svg) {
		width: 0.875rem;
		height: 0.875rem;
	}
	.locale-picker select {
		height: 1.5rem;
		max-width: 6.5rem;
		border: none;
		background: transparent;
		color: inherit;
		font-size: 0.6875rem;
		outline: none;
	}
	.locale-picker:hover {
		color: var(--foreground);
	}
</style>
