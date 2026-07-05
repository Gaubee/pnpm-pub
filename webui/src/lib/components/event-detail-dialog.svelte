<script lang="ts">
	/**
	 * EventDetailDialog — opens a single Event in a dialog pane so its full
	 * `EventCard` (complete trust form, advanced publish options, tarball
	 * preview, etc.) has room without crowding the list.
	 *
	 * The host list (e.g. GroupEventCard member rows) keeps a compact one-line
	 * summary; clicking the expand button opens this dialog.
	 *
	 * FUSION: the dialog renders EventCard with `surface="dialog"`, which emits
	 * the card's Header / Body / Footer segments BARE (no <Card> wrapper). The
	 * DialogContent lays them out as three grid rows — a pinned DialogHeader,
	 * a scrollable body, and a pinned footer — so the card chrome fuses into
	 * the dialog chrome with no double border / shadow / padding. The visible
	 * event title IS the DialogTitle (passed via EventCard's `titleLabel` slot),
	 * giving a clean a11y name without a duplicate sr-only label.
	 *
	 * Inherit/Custom switch: when the event is a `configure-trust` add inside a
	 * group, a segmented toggle lives in the dialog HEADER (injected via
	 * EventCard's `headerTrailing` slot, beside the corner actions).
	 *   - Inherit (read-only): EventCard shows the group's RESOLVED default
	 *     config (the member carries none of its own); edits are centralized in
	 *     the group's default form.
	 *   - Custom (editable): EventCard shows a full editable form seeded from
	 *     the group default, and edits write the member's OWN config
	 *     (`updateConfigureTrustDraft`, `trustGroupId = undefined`) — they do
	 *     NOT touch the group default.
	 * The toggle calls `onToggleInherit`, which the parent (GroupEventCard)
	 * forwards to `actions.setMemberInherit`. The single source of truth for the
	 * inherit flag is the daemon (`groupInheritMembers`), broadcast back via the
	 * lightweight `group-trust-draft` frame — so the badge + collapsed summary
	 * stay correct across refresh.
	 */
	import type { PubEvent } from '$lib/types.js';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
	} from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ButtonGroup } from '$lib/components/ui/button-group/index.js';
	import EventCard from '$lib/components/event-card.svelte';
	import { _ } from 'svelte-i18n';
	import { untrack } from 'svelte';

	let {
		open = $bindable(false),
		event = null,
		/** Initial inherit/custom mode for the event. `true` = inherit
		 *  (read-only), `false` = custom (editable). */
		inheritMode = true,
		onToggleInherit,
	}: {
		open?: boolean;
		event?: PubEvent | null;
		inheritMode?: boolean;
		onToggleInherit?: (eventId: string, mode: 'inherit' | 'custom') => void;
	} = $props();

	/** Whether this event is a pending configure-trust add that participates in
	 *  a group's inherit/custom scheme. Drives the header toggle visibility. */
	const isGroupTrustMember = $derived.by(() => {
		const e = event;
		if (!e || !onToggleInherit) return false;
		if (e.status !== 'pending') return false;
		const p = e.payload;
		return p?.kind === 'configure-trust' && p.data.action !== 'remove';
	});

	// Local readOnly state mirrors inheritMode. Re-seed whenever the bound
	// event changes (opening a different member's dialog).
	let readOnly = $state(untrack(() => inheritMode));
	$effect(() => {
		// Re-sync from the prop when the event identity changes.
		void event?.id;
		readOnly = inheritMode;
	});

	function setMode(next: 'inherit' | 'custom'): void {
		readOnly = next === 'inherit';
		if (event && onToggleInherit) onToggleInherit(event.id, next);
	}
</script>

<Dialog bind:open>
	<DialogContent
		class="grid h-[min(100dvh,40rem)] w-[min(100%,44rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
		aria-describedby={undefined}
	>
		{#if event}
			<EventCard {event} variant="full" surface="dialog" {readOnly} trustGroupId={readOnly ? event.groupId : undefined} headerClass="pr-9">
				{#snippet titleLabel({ child: titleNode })}
					<!-- The visible event title IS the dialog's accessible name.
					     bits-ui's DialogTitle forwards its a11y props via its
					     `child` snippet so we can spread them onto our styled span. -->
					<DialogTitle>
						{#snippet child({ props })}
							<span {...props}>{@render titleNode()}</span>
						{/snippet}
					</DialogTitle>
				{/snippet}
				{#snippet headerTrailing()}
					{#if isGroupTrustMember}
						<ButtonGroup>
							<Button
								variant={readOnly ? 'brand' : 'outline'}
								size="sm"
								class="px-2 text-[11px]"
								onclick={() => setMode('inherit')}
							>
								{$_('groupEvent.inheritDefault')}
							</Button>
							<Button
								variant={!readOnly ? 'brand' : 'outline'}
								size="sm"
								class="px-2 text-[11px]"
								onclick={() => setMode('custom')}
							>
								{$_('groupEvent.customize')}
							</Button>
						</ButtonGroup>
					{/if}
				{/snippet}
				{#snippet children({ header, body, footer, hasFooter })}
					<!-- Pinned header row: the EventCard header (title IS the
					     DialogTitle via titleLabel). -->
					<DialogHeader class="border-b px-4 py-3">
						{@render header()}
					</DialogHeader>
					<!-- Scrollable body row. -->
					<div class="min-h-0 overflow-y-auto p-4">
						{@render body()}
					</div>
					<!-- Pinned footer row — only when the card emits one, so an
					     action-less event shows no empty divider bar. -->
					{#if hasFooter}
						<div class="border-t px-4 py-3">
							{@render footer()}
						</div>
					{/if}
				{/snippet}
			</EventCard>
		{/if}
	</DialogContent>
</Dialog>
