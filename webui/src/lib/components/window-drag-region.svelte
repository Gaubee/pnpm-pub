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
	import { userPrefersMode, setMode } from 'mode-watcher';
	import IconSun from '@lucide/svelte/icons/sun';
	import IconMoon from '@lucide/svelte/icons/moon';
	import IconMonitor from '@lucide/svelte/icons/monitor';
	import IconLanguages from '@lucide/svelte/icons/languages';
	import { _, locale } from 'svelte-i18n';
	import { localeNames, locales, setAppLocale, type AppLocale } from '$lib/i18n.js';
	import type { OpentrayRect, OpentrayWindowOverlay } from '../../opentray.d.ts';

	/**
	 * The three theme states the titlebar toggle cycles through. Mirrors
	 * mode-watcher's `Mode` ('dark' | 'light' | 'system') — duplicated locally
	 * because mode-watcher doesn't export the type through its public surface.
	 */
	type ThemeMode = 'dark' | 'light' | 'system';

	// Reserved right inset for the OS window-control cluster, in CSS px.
	// Updated from the overlay geometry; falls back to a macOS-like 70px.
	let controlInset = $state(70);

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

	onMount(() => {
		const overlay: OpentrayWindowOverlay | undefined = ot()?.overlay;
		if (!overlay) return;

		const apply = async () => {
			try {
				const rect: OpentrayRect = await overlay.getTitlebarAreaRect();
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
		if (overlay.listen) {
			void overlay
				.listen('geometrychange', (e) => {
					controlInset = Math.max(0, Math.round(globalThis.innerWidth - e.titlebarAreaRect.x - e.titlebarAreaRect.width));
				})
				.then((unsub) => (off = () => void unsub?.()));
		} else if (overlay.addEventListener) {
			const handler = (e: { titlebarAreaRect: OpentrayRect }) => {
				controlInset = Math.max(0, Math.round(globalThis.innerWidth - e.titlebarAreaRect.x - e.titlebarAreaRect.width));
			};
			overlay.addEventListener('geometrychange', handler);
			off = () => overlay.removeEventListener?.('geometrychange', handler);
		}
		return () => off?.();
	});
</script>

<!--
	Titlebar strip: transparent so the native blur shows through, with a right
	inset reserving space for the OS controls. The strip hosts the native drag
	gesture; a theme toggle sits at the inline-end, just left of the OS control
	cluster (offset by `controlInset`). The toggle stops pointerdown so grabbing
	it never starts a window drag.
-->
<div
	data-window-titlebar
	class="drag-strip no-drag shrink-0"
	style="padding-right: {controlInset}px"
	role="toolbar"
	tabindex="-1"
	aria-label={$_('titlebar.windowTitlebar')}
	onpointerdown={onPointerDown}
>
	<div
		class="locale-picker no-drag"
		style="right: {controlInset + 36}px"
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
		style="right: {controlInset + 6}px"
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
		transition: background-color 0.12s ease, color 0.12s ease;
	}
	.theme-toggle:hover {
		background: color-mix(in oklab, var(--accent) 60%, transparent);
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
