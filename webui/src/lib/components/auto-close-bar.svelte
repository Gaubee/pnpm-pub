<script lang="ts">
	/**
	 * Auto-close bar — a small self-contained countdown shown at the inline-end
	 * of a freshly-resolved EventCard on the Active Events page.
	 *
	 * Lifecycle:
	 *   counting  → renders `[Auto-close (Ns) | Cancel]` as a ButtonGroup.
	 *               The left segment closes immediately on click; the right
	 *               segment stops the timer and flips to `cancelled`. When the
	 *               timer reaches 0 it auto-closes.
	 *   cancelled → renders a single `[Close]` button (manual close).
	 *
	 * The parent owns the "remove me" side-effect via `onclose`; this component
	 * only drives the countdown UI + transitions.
	 */
	import { untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ButtonGroup } from '$lib/components/ui/button-group/index.js';
	import { _ } from 'svelte-i18n';

	let {
		seconds = 5,
		onclose,
	}: { seconds?: number; onclose?: () => void } = $props();

	type Phase = 'counting' | 'cancelled';
	let phase = $state<Phase>('counting');
	// Seed the countdown from the initial `seconds` value only (it is a fixed
	// starting point, not something that should reset on prop change).
	let remaining = $state(untrack(() => seconds));

	$effect(() => {
		if (phase !== 'counting') return;
		const handle = setInterval(() => {
			remaining -= 1;
			if (remaining <= 0) {
				clearInterval(handle);
				onclose?.();
			}
		}, 1000);
		return () => clearInterval(handle);
	});

	function closeNow(): void {
		onclose?.();
	}

	function cancelCountdown(): void {
		phase = 'cancelled';
	}
</script>

<div class="ms-auto flex pt-1">
	{#if phase === 'counting'}
		<ButtonGroup>
			<Button variant="outline" size="sm" onclick={closeNow}>
				{$_('eventCard.autoClose')} ({remaining}s)
			</Button>
			<Button variant="ghost" size="sm" onclick={cancelCountdown}>
				{$_('common.cancel')}
			</Button>
		</ButtonGroup>
	{:else}
		<Button variant="outline" size="sm" onclick={closeNow}>
			{$_('common.close')}
		</Button>
	{/if}
</div>
