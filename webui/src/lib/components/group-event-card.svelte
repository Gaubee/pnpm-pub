<script lang="ts">
	/**
	 * GroupEventCard — renders a batch of events sharing a `groupId`.
	 *
	 * Responsibilities:
	 *   1. Show a unified header (kind icon + count + aggregated status badge).
	 *   2. For pending trusted-publishing groups, host ONE default
	 *      `TrustedPublishingDraftForm` whose edits fan out to every member via
	 *      `updateConfigureTrustGroupDraft` — this is the "default form".
	 *   3. For pending groups, offer a "Confirm all / Reject all" pair that loops
	 *      the existing per-event confirm/reject RPCs and shows live progress.
	 *   4. Render the member events as `EventCard`s, each individually
	 *      confirmable. While a member is in "inherit" mode, it shows a read-only
	 *      summary of the default form (delegated to EventCard via props).
	 *
	 * Front-end state only: the inherit/custom map is local and resets on
	 * reload (per design — no backend persistence).
	 */
	import type { EventStatus } from '$lib/types.js';
	import type { EventGroup, GroupKind } from '$lib/group-event.js';
	import { aggregateGroupStatus } from '$lib/group-event.js';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ButtonGroup } from '$lib/components/ui/button-group/index.js';
	import { Card, CardContent, CardHeader } from '$lib/components/ui/card/index.js';
	import EventCard from '$lib/components/event-card.svelte';
	import TrustedPublishingDraftForm from '$lib/components/trusted-publishing-draft-form.svelte';
	import { actions } from '$lib/store.js';
	import { trustedPublisherSummary } from '$lib/trusted-publishing.js';
	import IconShield from '@lucide/svelte/icons/shield-check';
	import IconPublish from '@lucide/svelte/icons/upload';
	import IconLayers from '@lucide/svelte/icons/layers';
	import IconCheck from '@lucide/svelte/icons/check';
	import IconX from '@lucide/svelte/icons/x';
	import IconLoader from '@lucide/svelte/icons/loader-circle';
	import { _ } from 'svelte-i18n';
	import { fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { flipParams, enterParams, leaveParams } from '$lib/transitions.js';

	let {
		group,
		/** "pending" surface (active-events) renders the default form + batch
		 *  confirm controls; "history" (resolved) renders only the overview +
		 *  member list, no actions. */
		surface = 'pending',
		/** Auto-close hook forwarded to resolved members (active-events only). */
		autoClose = false,
		onAutoClose,
	}: {
		group: EventGroup;
		surface?: 'pending' | 'history';
		autoClose?: boolean;
		onAutoClose?: (eventId: string) => void;
	} = $props();

	const STATUS_VARIANTS = {
		pending: 'brand',
		success: 'success',
		failed: 'destructive',
		expired: 'warning',
		'action-required': 'warning',
		rejected: 'secondary',
	} satisfies Record<EventStatus, NonNullable<BadgeVariant>>;

	const KIND_ICON: Record<GroupKind, typeof IconLayers> = {
		'trusted-publishing': IconShield,
		publish: IconPublish,
		mixed: IconLayers,
	};

	const members = $derived(group.events);
	const memberCount = $derived(members.length);
	const aggregatedStatus = $derived(aggregateGroupStatus(members));
	const hasPending = $derived(members.some((e) => e.status === 'pending'));
	const KindIcon = $derived(KIND_ICON[group.kind]);
	const statusVariant = $derived(STATUS_VARIANTS[aggregatedStatus]);
	const statusLabel = $derived(
		aggregatedStatus === 'action-required'
			? $_('eventCard.status.actionRequired')
			: $_(`eventCard.status.${aggregatedStatus}`),
	);

	/** Whether this group offers a unified default form. Only pending
	 *  trusted-publishing groups do (publish args vary per-target; mixed has no
	 *  single shape). */
	const hasDefaultForm = $derived(
		surface === 'pending' && hasPending && group.kind === 'trusted-publishing',
	);

	// --- Default-form state (trusted-publishing only) ---
	// The default form hosts one draft that fans out to all inherit-mode
	// members. Validity is bound so we can show the batch-confirm button.
	let groupDraftValid = $state(false);

	// The default form's current value, mirrored into a `$derived`-readable
	// snapshot so inherit-mode member cards can render a read-only summary.
	// Updated by the form's own $effect (via the bound `defaultConfig`).
	let defaultConfig = $state<
		| { type: 'github'; claims: { repository: string }; permissions: string[] }
		| null
	>(null);

	// --- Per-member inherit/custom mode. Defaults to "inherit" so the default
	//     form drives everything until the user opts a member out. Front-end
	//     state only — resets on reload. ---
	let memberModes = $state<Map<string, 'inherit' | 'custom'>>(new Map());

	function modeFor(eventId: string): 'inherit' | 'custom' {
		return memberModes.get(eventId) ?? 'inherit';
	}
	function setMode(eventId: string, mode: 'inherit' | 'custom'): void {
		const next = new Map(memberModes);
		next.set(eventId, mode);
		memberModes = next;
	}

	// --- Batch confirm/reject: loop the per-event RPC. Non-atomic by design;
	//     progress is derived live from the members' statuses. ---
	const resolvedCount = $derived(
		members.filter((e) => e.status !== 'pending').length,
	);
	let batchRunning = $state(false);
	const progressLabel = $derived(
		$_('groupEvent.progress', { values: { done: resolvedCount, total: memberCount } }),
	);

	function confirmAll(): void {
		if (batchRunning) return;
		batchRunning = true;
		try {
			for (const e of members) {
				if (e.status === 'pending') actions.confirm(e.id);
			}
		} finally {
			// The flag is cleared once every member leaves pending; until then
			// the button stays disabled and shows live progress.
			batchRunning = false;
		}
	}
	function rejectAll(): void {
		if (batchRunning) return;
		batchRunning = true;
		try {
			for (const e of members) {
				if (e.status === 'pending') actions.reject(e.id);
			}
		} finally {
			batchRunning = false;
		}
	}

	const groupTitle = $derived.by(() => {
		const count = $_('groupEvent.packageCount', { values: { count: memberCount } });
		switch (group.kind) {
			case 'trusted-publishing':
				return $_('groupEvent.kindTrustedPublishing', { values: { count } });
			case 'publish':
				return $_('groupEvent.kindPublish', { values: { count } });
			default:
				return $_('groupEvent.kindMixed', { values: { count } });
		}
	});
</script>

<Card class="ring-2 ring-brand/30 shadow-md">
	<CardHeader class="flex-row items-center justify-between gap-3 pb-3">
		<div class="flex min-w-0 items-center gap-2.5">
			<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
				<KindIcon class="h-4 w-4" />
			</div>
			<div class="min-w-0">
				<div class="flex items-center gap-2">
					<span class="truncate text-sm font-semibold">{groupTitle}</span>
					<Badge variant={statusVariant} class="h-5 capitalize">{statusLabel}</Badge>
				</div>
				<div class="mt-0.5 text-[11px] text-muted-foreground">
					{progressLabel}
				</div>
			</div>
		</div>
	</CardHeader>

	<CardContent class="space-y-3">
		<!-- Default form: drives every inherit-mode member via group fan-out. -->
		{#if hasDefaultForm}
			<div class="space-y-2">
				<div class="flex items-center justify-between gap-2">
					<span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
						{$_('groupEvent.defaultForm')}
					</span>
					<span class="text-[10px] text-muted-foreground/70">
						{$_('groupEvent.defaultFormHint')}
					</span>
				</div>
				<!-- Use the latest member's id as the form seed; groupId drives the
				     fan-out so every pending member picks the same config up. -->
				<TrustedPublishingDraftForm
					eventId={group.latest.id}
					groupId={group.id}
					repositoryHint={group.latest.payload?.kind === 'configure-trust' ? group.latest.payload.data.target.repository ?? '' : ''}
					mode="compact"
					bind:valid={groupDraftValid}
				/>
			</div>
		{:else if surface === 'pending' && hasPending && group.kind !== 'trusted-publishing'}
			<div class="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
				{$_('groupEvent.noDefaultForm')}
			</div>
		{/if}

		<!-- Batch actions (pending surface only). Loops per-event RPCs; progress
		     is reflected live in the header. -->
		{#if surface === 'pending' && hasPending}
			<div class="pt-1">
				<ButtonGroup>
					<Button
						variant="brand"
						size="sm"
						class="flex-1"
						disabled={batchRunning || (group.kind === 'trusted-publishing' && !groupDraftValid)}
						onclick={confirmAll}
					>
						<IconCheck class="h-3.5 w-3.5" />
						{$_('groupEvent.confirmAll')}
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={batchRunning}
						onclick={rejectAll}
					>
						<IconX class="h-3.5 w-3.5" />
						{$_('groupEvent.rejectAll')}
					</Button>
				</ButtonGroup>
			</div>
		{/if}

		<!-- Member list -->
		<div class="space-y-2">
			{#each members as member, i (member.id)}
				<div
					animate:flip={flipParams}
					in:fade|global={enterParams(i)}
					out:fade={leaveParams}
				>
					<EventCard
						event={member}
						variant="compact"
						{autoClose}
						onAutoClose={onAutoClose ? () => onAutoClose(member.id) : undefined}
						inheritMode={modeFor(member.id) === 'inherit'}
						onToggleInherit={(eventId, mode) => setMode(eventId, mode)}
					/>
				</div>
			{/each}
		</div>
	</CardContent>
</Card>
