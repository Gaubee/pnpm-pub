<script lang="ts">
	/**
	 * Inline two-step confirmation — a low-key trigger button that, on click,
	 * expands into a small destructive-styled confirmation card (warning text +
	 * confirm/cancel). Used for irreversible actions like unpublish, where a
	 * direct one-click would be dangerous.
	 *
	 * The trigger is deliberately muted (outline) so it sits unobtrusively inside
	 * an EventCard ButtonGroup; the confirm step brings the visual weight.
	 *
	 * `open` is bindable so the parent can place the confirm card outside the
	 * ButtonGroup (it's a full-width block, not a group member). Typical usage:
	 *
	 *   {#if confirmOpen}
	 *     <ConfirmAction open={confirmOpen} ... />   <!-- renders only the card -->
	 *   {:else}
	 *     <ButtonGroup>... <ConfirmAction bind:open ... /> ...</ButtonGroup>
	 *   {/if}
	 *
	 * Props:
	 *   - `warning`: the destructive warning shown in the confirm card.
	 *   - `confirmLabel` / `cancelLabel`: button text.
	 *   - `triggerLabel` / `triggerIcon`: the trigger button's text + icon snippet.
	 *   - `flex`: when true the trigger stretches (flex-1) inside its ButtonGroup.
	 *   - `onConfirm`: fired when the user confirms (the parent owns the action).
	 */
	import { Button } from '$lib/components/ui/button/index.js';
	import { ButtonGroup } from '$lib/components/ui/button-group/index.js';
	import type { Snippet } from 'svelte';
	import { _ } from 'svelte-i18n';

	let {
		open = $bindable(false),
		warn,
		confirmLabel = $_('eventCard.unpublish'),
		cancelLabel = $_('common.cancel'),
		triggerLabel,
		triggerIcon,
		flex = false,
		onConfirm,
	}: {
		open?: boolean;
		warn: string;
		confirmLabel?: string;
		cancelLabel?: string;
		triggerLabel?: Snippet;
		triggerIcon?: Snippet;
		flex?: boolean;
		onConfirm?: () => void;
	} = $props();

	function confirm(): void {
		open = false;
		onConfirm?.();
	}
</script>

{#if open}
	<div class="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
		<p class="text-[11px] text-destructive">{warn}</p>
		<ButtonGroup>
			<Button variant="destructive" size="sm" class="flex-1" onclick={confirm}>
				{confirmLabel}
			</Button>
			<Button variant="outline" size="sm" onclick={() => (open = false)}>
				{cancelLabel}
			</Button>
		</ButtonGroup>
	</div>
{:else}
	<Button variant="outline" size="sm" class={flex ? 'flex-1' : ''} onclick={() => (open = true)}>
		{@render triggerIcon?.()}
		{@render triggerLabel?.()}
	</Button>
{/if}
