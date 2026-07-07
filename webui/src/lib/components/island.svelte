<script lang="ts">
	/**
	 * Dynamic Island — a single live-activity slot anchored to the titlebar.
	 *
	 * Fixed, generic interaction (iOS Dynamic Island semantics); callers only
	 * supply data via `showActivity`:
	 *
	 *   compact  → tap centre → expand (when `detail` exists)
	 *   expanded → tap centre → fire `primaryAction` (or collapse if none)
	 *   inline-end icon button (always) → fire `primaryAction` directly
	 *
	 * ── MOTION (declarative, single source of truth) ────────────────────────
	 * There is ONE signal: `phase` ('hidden' | 'compact' | 'expanded'). The
	 * @humanspeak/svelte-motion `motion.div` receives `animate = TARGETS[phase]`
	 * — a plain object describing the END appearance for that state. When
	 * `phase` changes, the Motion engine springs each property from its CURRENT
	 * animated value to the new target (interruptible, no jump). Re-triggering
	 * just re-points the target; the spring re-converges. CSS holds ONLY static
	 * visual styling (colour, backdrop, font, layout) — no per-state calc ramps,
	 * no @property, no transitions on the morphed props. The `animate` object is
	 * the single place that defines "what does each state look like".
	 */
	import { Portal } from 'bits-ui';
	import { motion } from '@humanspeak/svelte-motion';
	import { activity, type IslandTone, type IslandDetail } from '$lib/notify.js';
	import IconInfo from '@lucide/svelte/icons/info';
	import IconCheck from '@lucide/svelte/icons/check';
	import IconAlert from '@lucide/svelte/icons/triangle-alert';
	import IconWarning from '@lucide/svelte/icons/circle-alert';

	const AUTO_COLLAPSE_MS = 4000;

	type Phase = 'hidden' | 'compact' | 'expanded';

	// Real spring for every transition — iOS Dynamic Island family: gentle
	// underdamped, soft overshoot, calm settle. The Motion engine solver runs
	// on these (not an easing approximation).
	const SPRING = { type: 'spring', stiffness: 170, damping: 22, mass: 0.9 } as const;

	const current = $derived($activity);
	const hasDetail = $derived(current?.detail !== undefined);
	const hasPrimary = $derived(!!current?.primaryAction);

	const DEFAULT_ICON: Record<IslandTone, typeof IconInfo> = {
		info: IconInfo,
		success: IconCheck,
		error: IconAlert,
		warning: IconWarning,
	};
	const TONE_CLASS: Record<IslandTone, string> = {
		info: 'text-foreground',
		success: 'text-success',
		error: 'text-destructive',
		warning: 'text-warning',
	};
	const tone = $derived(current?.tone ?? 'info');
	const LeadIcon = $derived(current?.icon ?? DEFAULT_ICON[tone]);
	const toneClass = $derived(TONE_CLASS[tone]);

	const detail = $derived.by((): IslandDetail | null => {
		const d = current?.detail;
		if (d === undefined) return null;
		return typeof d === 'string' ? { kind: 'text', text: d } : d;
	});

	// ── STATE MACHINE ────────────────────────────────────────────────────────
	//   no activity                         → hidden
	//   activity, user wants detail open    → expanded
	//   activity, resting                   → compact
	// A new EXPANDABLE activity opens expanded by default (noticed); a
	// compact-only one (download/toast) rests compact. Auto-collapse returns
	// expanded→compact (the pill stays while the activity is live).
	let userExpanded = $state(false);
	const phase = $derived<Phase>(
		current ? (userExpanded && hasDetail ? 'expanded' : 'compact') : 'hidden',
	);
	let lastSeenActivityId: number | undefined;
	$effect(() => {
		const id = current?.id;
		if (id !== lastSeenActivityId) {
			lastSeenActivityId = id;
			userExpanded = !!current && hasDetail;
		}
	});

	// Auto-collapse expanded → compact after inactivity. Hover pauses it.
	let collapseTimer: ReturnType<typeof setTimeout> | null = null;
	function clearCollapseTimer(): void {
		if (collapseTimer !== null) {
			clearTimeout(collapseTimer);
			collapseTimer = null;
		}
	}
	function armCollapse(): void {
		clearCollapseTimer();
		if (phase !== 'expanded') return;
		collapseTimer = setTimeout(() => {
			collapseTimer = null;
			userExpanded = false;
		}, AUTO_COLLAPSE_MS);
	}
	$effect(() => {
		void phase;
		armCollapse();
	});

	// ── INTERACTIONS (only mutate state; never touch animation directly) ────
	function onCentreClick(): void {
		if (phase === 'expanded') {
			if (current?.primaryAction) void current.primaryAction.run();
			else userExpanded = false;
			return;
		}
		if (hasDetail) {
			userExpanded = true;
			return;
		}
		current?.primaryAction?.run();
	}
	function onPrimaryButton(e: MouseEvent): void {
		e.stopPropagation();
		current?.primaryAction?.run();
	}
	function onEnter(): void {
		clearCollapseTimer();
	}
	function onLeave(): void {
		armCollapse();
	}
	function stop(e: PointerEvent): void {
		e.stopPropagation();
	}

	// ── THE DECLARATION: state → appearance ──────────────────────────────────
	// One object per phase. The Motion engine animates from the current value
	// to these targets whenever `phase` changes. This is the single source of
	// truth for how each state looks.
	//
	// borderRadius: do NOT use 9999 (the CSS "fully round" hack) as an animated
	// value — Motion interpolates it as a real number, so 9999→24 spends ~all
	// of the animation visually stuck fully-round then snaps. Instead we use a
	// value comfortably larger than the pill's half-height (≈16px) so the
	// browser still renders it as fully round, yet 100→24 interpolates smoothly.
	const TARGETS = {
		hidden: {
			opacity: 0,
			scale: 0.92,
			maxWidth: 320,
			borderRadius: 100,
			paddingTop: 4,
			paddingBottom: 4,
			paddingLeft: 8,
			paddingRight: 8,
			boxShadow: '0 0 0 rgba(0,0,0,0)',
			backdropFilter: 'blur(8px) contrast(0.8) brightness(1.2)',
			WebkitBackdropFilter: 'blur(8px) contrast(0.8) brightness(1.2)',
		},
		compact: {
			opacity: 1,
			scale: 1,
			maxWidth: 320,
			borderRadius: 100,
			paddingTop: 4,
			paddingBottom: 4,
			paddingLeft: 8,
			paddingRight: 8,
			boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
			backdropFilter: 'blur(8px) contrast(0.8) brightness(1.2)',
			WebkitBackdropFilter: 'blur(8px) contrast(0.8) brightness(1.2)',
		},
		expanded: {
			opacity: 1,
			scale: 1,
			maxWidth: 480,
			borderRadius: 24,
			paddingTop: 16,
			paddingBottom: 16,
			paddingLeft: 18,
			paddingRight: 18,
			boxShadow: '0 18px 50px -8px rgba(0,0,0,0.28), 0 6px 16px -4px rgba(0,0,0,0.14)',
			backdropFilter: 'blur(24px) contrast(0.8) brightness(1.2)',
			WebkitBackdropFilter: 'blur(24px) contrast(0.8) brightness(1.2)',
		},
	} as const;
	const islandAnimate = $derived(TARGETS[phase]);

	// Detail panel: open (measured height) only when expanded; closed (0) else.
	// We measure the content's natural height with a ResizeObserver so it
	// tracks content changes (e.g. a progress label updating) — not a one-shot
	// read that goes stale. scrollHeight reflects intrinsic content height even
	// while the parent's animated height is 0 (Motion sets `height`, which does
	// not clamp scrollHeight).
	let detailInnerEl = $state<HTMLDivElement | null>(null);
	let detailHeight = $state(0);
	$effect(() => {
		const el = detailInnerEl;
		if (!el) return;
		const sync = () => {
			const h = el.scrollHeight;
			if (h !== detailHeight) detailHeight = h;
		};
		sync();
		const ro = new ResizeObserver(sync);
		ro.observe(el);
		return () => ro.disconnect();
	});
	// Detail content transitions with a blurIn/blurOut: visible = sharp,
	// hidden = blurred + faded. Height grows/shrinks in parallel so the panel
	// reveals smoothly rather than popping.
	const detailAnimate = $derived(
		phase === 'expanded'
			? { height: detailHeight, opacity: 1, filter: 'blur(0px)' }
			: { height: 0, opacity: 0, filter: 'blur(10px)' },
	);
</script>

<Portal>
	<!--
		`island-anchor` is a plain DOM div, so we drive pointer-events here via
		the `style:` directive (not on the motion.div component, where the
		directive isn't allowed). It flips to NONE the instant we enter the
		hidden phase — without waiting for the fade-out animation to finish — so
		no clicks land on an element that's animating out. Setting it on the
		anchor (the positioning wrapper) disables interaction for the whole island.
	-->
	<div class="island-anchor" style:pointer-events={phase === 'hidden' ? 'none' : 'auto'}>
		<!--
			Always mounted — the hidden↔compact transition is an ANIMATION
			(opacity/scale to TARGETS.hidden), not a mount/unmount. When there is
			no activity the content is invisible (opacity 0) and pointer-events
			are disabled (see the anchor above), so it's effectively gone but
			still animates in/out. `{#if detail}` stays so the detail row mounts
			only when there's something to show.
		-->
		<motion.div
			class="island {toneClass}"
			animate={islandAnimate}
			transition={SPRING}
			initial={false}
			onpointerdown={stop}
			onmouseenter={onEnter}
			onmouseleave={onLeave}
			role="group"
			aria-hidden={phase === 'hidden'}
			aria-label="Dynamic Island"
		>
			<!-- HEADER ROW: [centre: icon + summary] [primary-action button] -->
			<div class="island-row">
				<button
					type="button"
					class="island-centre"
					onclick={onCentreClick}
					aria-expanded={hasDetail ? phase === 'expanded' : undefined}
					aria-label={current?.summary ?? 'Activity'}
				>
					<LeadIcon class="h-4 w-4 shrink-0" />
					<span class="island-summary">{current?.summary ?? ''}</span>
				</button>

				{#if hasPrimary && current?.primaryAction}
					{@const ActionIcon = current.primaryAction.icon}
					<button
						type="button"
						class="island-action"
						onclick={onPrimaryButton}
						aria-label={current.primaryAction.label ?? 'Primary action'}
						title={current.primaryAction.label ?? undefined}
					>
						<ActionIcon class="h-3.5 w-3.5" />
					</button>
				{/if}
			</div>

			<!-- DETAIL ROW: text or progress. Height/opacity animated by Motion. -->
			{#if detail}
				<motion.div
					class="island-detail"
					animate={detailAnimate}
					transition={SPRING}
					aria-hidden={phase !== 'expanded'}
				>
					<div bind:this={detailInnerEl} class="island-detail-inner">
						{#if detail.kind === 'text'}
							<p class="island-text">{detail.text}</p>
						{:else}
							{#if detail.label}
								<span class="island-progress-label">{detail.label}</span>
							{/if}
							<div
								class="island-progress"
								role="progressbar"
								aria-valuenow={Math.round(detail.progress * 100)}
								aria-valuemin={0}
								aria-valuemax={100}
							>
								<span
									class="island-progress-bar"
									style:width={`${Math.min(100, Math.max(0, detail.progress * 100))}%`}
								></span>
							</div>
						{/if}
					</div>
				</motion.div>
			{/if}
		</motion.div>
	</div>
</Portal>

<style>
	.island-anchor {
		position: fixed;
		top: 0.625rem; /* centred in the 2rem titlebar strip, nudged up */
		left: 50%;
		transform: translateX(-50%);
		z-index: 60; /* above the z-50 overlay tier (Dialog/Sheet/Popover) */
	}

	/*
	 * The island container. CSS holds ONLY static visual styling — colour,
	 * font, layout, static element shapes. The animated properties (opacity,
	 * scale, max-width, border-radius, padding, box-shadow, backdrop-filter)
	 * are owned entirely by Motion via `animate`; CSS sets no value for them
	 * and no transition, so there is never a competing source.
	 */
	.island {
		display: grid;
		grid-template-columns: 1fr auto;
		grid-template-rows: auto auto;
		gap: 0;
		border: 1px solid var(--border);
		/* Translucent fill so the backdrop blur reads through (iOS glass). */
		background: color-mix(in oklab, var(--popover) 62%, transparent);
		color: var(--popover-foreground);
		overflow: hidden;
		transform-origin: top center;
	}

	.island-row {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.island-centre {
		display: inline-flex;
		align-items: center;
		gap: 0.625rem;
		min-width: 0;
		flex: 1;
		padding: 0.375rem 0.5rem;
		border-radius: 9999px;
		background: transparent;
		border: none;
		color: inherit;
		font-size: 0.8rem;
		line-height: 1;
		cursor: pointer;
		transition: background-color 0.2s ease;
	}
	.island-centre:hover {
		background: var(--accent);
	}
	.island-summary {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}
	.island :global(svg) {
		display: inline-block;
	}

	.island-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0;
		border-radius: 9999px;
		background: color-mix(in oklab, var(--accent) 70%, transparent);
		border: 1px solid var(--border);
		color: var(--foreground);
		cursor: pointer;
		transition: background-color 0.2s ease, transform 0.2s ease;
	}
	.island-action:hover {
		background: var(--accent);
		transform: scale(1.06);
	}
	.island-action:active {
		transform: scale(0.96);
	}

	/*
	 * Detail row. Height + opacity are animated by Motion (the `animate`
	 * object is the single source). overflow:hidden clips while collapsing.
	 */
	.island-detail {
		grid-column: 1 / -1;
		min-width: 0;
		overflow: hidden;
	}
	.island-detail-inner {
		padding-top: 0.5rem;
	}
	.island-text {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--muted-foreground);
		overflow-wrap: anywhere;
	}
	.island-progress-label {
		display: block;
		margin-bottom: 0.5rem;
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}
	.island-progress {
		height: 6px;
		border-radius: 9999px;
		background: var(--muted);
		overflow: hidden;
	}
	.island-progress-bar {
		display: block;
		height: 100%;
		border-radius: 9999px;
		background: var(--brand);
		transition: width 0.3s ease;
	}
</style>
