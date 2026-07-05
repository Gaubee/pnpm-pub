<script lang="ts">
	/**
	 * Dynamic Island — global notification surface anchored to the titlebar row.
	 *
	 * Two parts:
	 *   1. TRIGGER (always rendered, absolutely centred in the titlebar): a
	 *      "pill" capsule showing the latest item (icon + text), with a `•N`
	 *      count badge when more than one is queued. It toggles the popover.
	 *   2. POPOVER (native `popover="auto"`): a full-window layer that lists
	 *      every queued item, top-to-bottom, each dismissible. The blur backdrop
	 *      is constrained to the card geometry via `mask-image` so only the
	 *      content area gets the legibility blur; the rest stays transparent.
	 *
	 * Animation is damped (`svelte/motion` springs): the pill grows/shrinks/
	 * fades on item in/out; the popover scales+fades on open/close.
	 *
	 * The trigger sits in the titlebar drag strip, so it stops pointerdown to
	 * avoid starting a native window drag.
	 */
	import { spring } from 'svelte/motion';
	import { island, dismiss, type IslandTone } from '$lib/notify.js';
	import IconInfo from '@lucide/svelte/icons/info';
	import IconCheck from '@lucide/svelte/icons/check';
	import IconAlert from '@lucide/svelte/icons/triangle-alert';
	import IconWarning from '@lucide/svelte/icons/circle-alert';
	import IconChevron from '@lucide/svelte/icons/chevron-down';

	const items = $derived($island);
	const latest = $derived(items[0] ?? null);
	const count = $derived(items.length);
	const hasMultiple = $derived(count > 1);

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
	const toneClass = $derived(latest ? TONE_CLASS[latest.tone] : '');
	const LatestIcon = $derived(latest?.icon ?? DEFAULT_ICON[latest?.tone ?? 'info']);

	// --- spring-driven presence of the pill ---
	// 1 when an item is showing, 0 when empty. Drives opacity + scale + width.
	const presence = spring(0, { stiffness: 0.12, damping: 0.8 });
	$effect(() => {
		void latest;
		presence.set(latest ? 1 : 0);
	});

	/**
	 * Keep the trigger mounted briefly after the queue empties so the spring can
	 * finish its fade-out — otherwise unmounting snaps it away. `mounted` lags
	 * `count > 0` by ~320ms on the way down (matches the spring settle time).
	 */
	let mounted = $state(false);
	let hideTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		void count;
		if (count > 0) {
			if (hideTimer) {
				clearTimeout(hideTimer);
				hideTimer = null;
			}
			mounted = true;
		} else if (!hideTimer) {
			hideTimer = setTimeout(() => {
				mounted = false;
				hideTimer = null;
			}, 320);
		}
	});

	// --- popover open state (native API) ---
	let popoverEl = $state<HTMLDivElement | null>(null);
	const isOpen = $derived(popoverEl?.matches(':popover-open') ?? false);
	function togglePopover(): void {
		if (!popoverEl) return;
		if (popoverEl.matches(':popover-open')) popoverEl.hidePopover();
		else popoverEl.showPopover();
	}

	// Re-render reactively on popover open/close (matches() isn't reactive).
	function syncOpen(): void {
		popoverEl = popoverEl; // trigger update
	}

	// latest-message label width feeds the spring (so the pill reshapes to fit).
	let label = $derived(latest?.message ?? '');
	const width = spring(0, { stiffness: 0.2, damping: 0.85 });
	let labelEl = $state<HTMLSpanElement | null>(null);
	$effect(() => {
		void label;
		if (labelEl) width.set(labelEl.scrollWidth);
	});

	// Stop clicks inside the popover from closing it via light-dismiss on the
	// trigger area; native light-dismiss still closes on outside/Esc.
	function stop(e: PointerEvent): void {
		e.stopPropagation();
	}
</script>

{#snippet trigger()}
	{#if mounted}
		<button
			type="button"
			class="island-trigger"
			popovertarget="island-popover"
			onpointerdown={stop}
			onclick={togglePopover}
			aria-label="Notifications{hasMultiple ? ` (${count})` : ''}"
			aria-haspopup="menu"
			style:opacity={$presence}
			style:transform={`translate(-50%, -50%) scale(${0.9 + 0.1 * $presence})`}
			style:visibility={$presence > 0.05 ? 'visible' : 'hidden'}
		>
			{#if latest}
				<LatestIcon class="h-3.5 w-3.5 shrink-0 {toneClass}" />
				<span class="island-label" bind:this={labelEl}>{label}</span>
				{#if hasMultiple}
					<span class="island-count">•{count}</span>
				{/if}
				<IconChevron class="h-3 w-3 shrink-0 text-muted-foreground" />
			{/if}
		</button>
	{/if}
{/snippet}

<!--
	TRIGGER: absolutely centred in the titlebar row (top: 1rem = half of the 2rem
	drag strip; left: 50%). Rendered inside WindowDragRegion's strip via a slot.
-->
<div class="island-anchor">
	{@render trigger()}
</div>

<!--
	POPOVER (native API). Full-window layer; the blur backdrop is masked to the
	card geometry so only the card region is blurred for legibility.
-->
<div
	id="island-popover"
	bind:this={popoverEl}
	class="island-popover"
	popover="auto"
	role="dialog"
	aria-label="Notifications"
	tabindex="-1"
	onpointerdown={stop}
	ontoggle={syncOpen}
>
	<div class="island-card">
		<header class="island-card-head">
			<span class="text-xs font-medium text-muted-foreground">Notifications</span>
			{#if count > 0}
				<button type="button" class="island-clear" onclick={() => items.forEach((i) => dismiss(i.id))}>
					Clear
				</button>
			{/if}
		</header>
		<div class="island-list">
			{#each items as item (item.id)}
				{@const Icon = item.icon ?? DEFAULT_ICON[item.tone]}
				{@const ActionIcon = item.action?.icon}
				<div class="island-item {TONE_CLASS[item.tone]}">
					<button
						type="button"
						class="island-item-main"
						onclick={() => dismiss(item.id)}
					>
						<Icon class="h-4 w-4 shrink-0" />
						<span class="island-item-msg">{item.message}</span>
					</button>
					{#if item.action}
						<button
							type="button"
							class="island-action"
							onclick={() => { void item.action!.run(); dismiss(item.id); }}
						>
							{#if ActionIcon}<ActionIcon class="h-3.5 w-3.5" />{/if}
							{item.action.label}
						</button>
					{/if}
				</div>
			{:else}
				<p class="island-empty">No notifications</p>
			{/each}
		</div>
	</div>
</div>

<style>
	.island-anchor {
		position: fixed;
		top: 1rem; /* vertical centre of the 2rem titlebar drag strip */
		left: 50%;
		z-index: 50;
	}
	.island-trigger {
		position: absolute;
		left: 50%;
		top: 50%;
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		max-width: min(60vw, 22rem);
		padding: 0.25rem 0.625rem 0.25rem 0.5rem;
		border-radius: 9999px;
		border: 1px solid var(--border);
		background: var(--popover);
		color: var(--popover-foreground);
		font-size: 0.75rem;
		line-height: 1;
		white-space: nowrap;
		overflow: hidden;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
		cursor: pointer;
		transition: background-color 0.12s ease;
	}
	.island-trigger:hover {
		background: color-mix(in oklab, var(--popover) 80%, var(--accent));
	}
	.island-label {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.island-count {
		color: var(--muted-foreground);
	}
	.island-trigger :global(svg) {
		display: inline-block;
	}

	/* Native popover: full-window, transparent base (no UA chrome). */
	.island-popover {
		/* anchored under the centred trigger; spans the window for the mask */
		position: fixed;
		inset: 2rem 0 auto 0;
		margin: 0 auto;
		width: min(92vw, 24rem);
		border: none;
		background: transparent;
		padding: 0;
		/* legibility blur + soft scrim, masked to the card geometry */
		backdrop-filter: blur(18px) saturate(1.4);
		-webkit-backdrop-filter: blur(18px) saturate(1.4);
		/* mask = a rounded rect matching .island-card, feathered edges */
		mask-image: linear-gradient(black, black);
		-webkit-mask-image: linear-gradient(black, black);
	}
	.island-card {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--popover);
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
		overflow: hidden;
	}
	.island-card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.625rem 0.75rem;
		border-bottom: 1px solid var(--border);
	}
	.island-clear {
		font-size: 0.7rem;
		color: var(--muted-foreground);
		background: none;
		border: none;
		cursor: pointer;
	}
	.island-clear:hover {
		color: var(--foreground);
	}
	.island-list {
		max-height: 20rem;
		overflow-y: auto;
		padding: 0.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.island-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.25rem 0.375rem;
		border-radius: calc(var(--radius) - 2px);
	}
	.island-item:hover {
		background: var(--accent);
	}
	.island-item-main {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
		padding: 0.25rem 0.25rem;
		background: transparent;
		border: none;
		text-align: left;
		font-size: 0.8rem;
		line-height: 1.35;
		color: var(--foreground);
		cursor: pointer;
	}
	.island-action {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
		padding: 0.25rem 0.5rem;
		border-radius: calc(var(--radius) - 4px);
		background: color-mix(in oklab, var(--accent) 80%, transparent);
		border: 1px solid var(--border);
		font-size: 0.72rem;
		font-weight: 500;
		color: var(--foreground);
		cursor: pointer;
		white-space: nowrap;
		transition: background-color 0.12s ease;
	}
	.island-action:hover {
		background: var(--accent);
	}
	.island-item-msg {
		flex: 1;
		min-width: 0;
		word-break: break-word;
	}
	.island-empty {
		padding: 1rem;
		text-align: center;
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}

	/* Spring-driven popover enter/exit (native popover hides on close; the
	   :popover-open transition handles enter, JS sets opacity via `isOpen`). */
	.island-popover:popover-open {
		animation: island-in 0.28s cubic-bezier(0.22, 1, 0.36, 1);
	}
	@keyframes island-in {
		from {
			opacity: 0;
			transform: translateY(-8px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}
</style>
