<script lang="ts">
	/**
	 * One-line Trusted Publishing (OIDC) status indicator: a shield icon + a
	 * status label (configured summary / loading shimmer / not-configured), with
	 * an optional "Configure" button. Lifts the per-card OIDC row the Workspaces
	 * detail page renders inline into a reusable component, and ships the
	 * `.shiny-text` loading animation (previously scoped to that page).
	 */
	import IconShield from '@lucide/svelte/icons/shield-check';
	import { Button } from './ui/button/index.js';

	type Status = 'configured' | 'loading' | 'none';

	let {
		status,
		text,
		buttonLabel = '',
		disabled = false,
		onconfigure = undefined,
	}: {
		status: Status;
		text: string;
		buttonLabel?: string;
		/** Disable the configure button (e.g. no repository metadata available). */
		disabled?: boolean;
		/** Receives the triggering event so callers can stopPropagation. */
		onconfigure?: (event: MouseEvent) => void;
	} = $props();

	const shieldClass = $derived(status === 'configured' ? 'text-success' : 'text-muted-foreground/50');
	const labelClass = $derived(
		status === 'configured'
			? 'truncate text-[11px] text-success/90'
			: status === 'loading'
				? 'truncate text-[11px] shiny-text'
				: 'truncate text-[11px] text-muted-foreground/50',
	);
</script>

<div class="flex items-center gap-1.5">
	<div class="flex min-w-0 flex-1 items-center gap-1.5">
		<IconShield class="h-3 w-3 shrink-0 {shieldClass}" />
		<span class={labelClass}>{text}</span>
	</div>
	{#if buttonLabel && onconfigure}
		<Button variant={status === 'configured' ? 'brand' : 'outline'} size="sm" {disabled} onclick={(e) => onconfigure?.(e)}>
			<IconShield class="h-3.5 w-3.5" />
			{buttonLabel}
		</Button>
	{/if}
</div>

<style>
	.shiny-text {
		background: linear-gradient(
			90deg,
			var(--muted-foreground) 0%,
			var(--muted-foreground) 40%,
			var(--foreground) 50%,
			var(--muted-foreground) 60%,
			var(--muted-foreground) 100%
		);
		background-size: 200% 100%;
		background-clip: text;
		-webkit-background-clip: text;
		color: transparent;
		animation: shiny-sweep 1.8s linear infinite;
	}
	@keyframes shiny-sweep {
		0% {
			background-position: 100% 0;
		}
		100% {
			background-position: -100% 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.shiny-text {
			animation: none;
			color: var(--muted-foreground);
			background: none;
		}
	}
</style>
