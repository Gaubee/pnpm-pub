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
	 *     the group default; edits are staged LOCALLY (deferSubmit) and write the
	 *     member's OWN config only on Save (`updateConfigureTrustDraft`), NOT the
	 *     group default.
	 * The toggle is LOCAL (it does NOT fire the daemon RPC on every switch) —
	 * the chosen mode + any staged config commit together when the user clicks
	 * Save (`setMemberInherit` + `updateConfigureTrustDraft`). `onToggleInherit`
	 * is still passed by the parent (GroupEventCard) but only as a signal that
	 * this member participates in the group's inherit/custom scheme (it gates
	 * the toggle's visibility); it is no longer invoked from the toggle. The
	 * single source of truth for the inherit flag is the daemon
	 * (`groupInheritMembers`), broadcast back via the lightweight
	 * `group-trust-draft` frame — so the badge + collapsed summary
	 * stay correct across refresh.
	 */
	import type {
		PubEvent,
		RemovalDecision,
		RemovalDecisions,
		TrustedPublisherCreateConfig,
	} from '$lib/types.js';
	import type { RepoInfo } from '$lib/components/repo-info-types.js';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogHeader,
		DialogTitle,
	} from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ButtonGroup } from '$lib/components/ui/button-group/index.js';
	import EventCard from '$lib/components/event-card.svelte';
	import EventCardOpenActions from '$lib/components/event-card-open-actions.svelte';
	import TrustedPublishingRemovalReview from '$lib/components/trusted-publishing-removal-review.svelte';
	import { actions } from '$lib/store.js';
	import IconX from '@lucide/svelte/icons/x';
	import IconReset from '@lucide/svelte/icons/refresh-ccw';
	import IconShieldMinus from '@lucide/svelte/icons/shield-minus';
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
		if (e.status !== "pending") return false;
		const p = e.payload;
		return p?.kind === "configure-trust" && p.data.action !== "remove";
	});

	/** Whether the footer should render the three-state "discard/close" row
	 *  instead of the default Confirm/Reject. True for a pending configure-trust
	 *  event that is part of a group — single-event confirm is intentionally
	 *  routed to the group's batch Confirm All (the inherit-member confirm path
	 *  has no standalone config and would error), so this dialog only edits;
	 *  standalone trust events keep their own Confirm/Reject. */
	const useDiscardFooter = $derived(
		!!event &&
			event.status === "pending" &&
			event.payload?.kind === "configure-trust" &&
			event.payload.data.action !== "remove" &&
			!!event.groupId,
	);

	/** A grouped configure-trust/remove member: single-event confirm is rejected
	 *  by the daemon (only confirmGroup can run grouped removals), so the dialog
	 *  footer surfaces Keep/Remove DECISION controls instead of Confirm/Reject.
	 *  The decision is written to daemon truth (survives refresh) and gates the
	 *  group's Confirm All. */
	const isGroupedRemoval = $derived(
		!!event &&
			event.status === "pending" &&
			event.payload?.kind === "configure-trust" &&
			event.payload.data.action === "remove" &&
			!!event.groupId,
	);

	/** The package name for a grouped-removal member. */
	const removalPackageName = $derived.by(() => {
		const e = event;
		if (e?.payload?.kind === "configure-trust") return e.payload.data.target.name;
		return "";
	});
	const removalConfigs = $derived(event?.removalSnapshot ?? []);
	const removalStatus = $derived(event?.removalSnapshot ? 'ready' : 'error');

	// Open-actions data for the removal footer (npm link, repo, folder) —
	// mirrors EventCard's derivation but reads directly from the removal
	// member's target. The right-side links cluster matches the standard
	// EventCardFooter layout.
	const removalTarget = $derived(
		event?.payload?.kind === "configure-trust" ? event.payload.data.target : null,
	);
	const removalSourcePath = $derived(removalTarget?.path ?? "");
	const removalNpmUrl = $derived(
		removalPackageName
			? `https://www.npmjs.com/package/${removalPackageName}`
			: "",
	);
	let removalRepoInfo = $state<RepoInfo | null>(null);
	const removalRepoRaw = $derived(removalTarget?.repository ?? "");
	$effect(() => {
		if (!removalRepoRaw) {
			removalRepoInfo = null;
			return;
		}
		void actions.repoInfo(removalRepoRaw).then((info) => {
			removalRepoInfo = info;
		});
	});
	const removalHasOpenActions = $derived(
		!!removalRepoInfo || !!removalSourcePath || !!removalNpmUrl,
	);
	function removalOpenUrl(url: string): void {
		actions.openUrl(url);
	}
	function removalOpenPath(path: string): void {
		actions.openPath(path);
	}

	let removalDraft = $state<RemovalDecisions>({});
	let removalInitial = $state<RemovalDecisions>({});
	$effect(() => {
		void event?.id; // re-seed when a different member opens
		const decisions = event?.removalDecisions ?? {};
		removalDraft = { ...decisions };
		removalInitial = { ...decisions };
	});
	function removalDecisionsEqual(a: RemovalDecisions, b: RemovalDecisions): boolean {
		const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
		for (const key of keys) if (a[key] !== b[key]) return false;
		return true;
	}
	const removalDirty = $derived(!removalDecisionsEqual(removalDraft, removalInitial));
	function setRemovalDraft(configId: string, decision: RemovalDecision): void {
		removalDraft = { ...removalDraft, [configId]: decision };
	}
	/** Commit the local removal decision to the daemon, then close. */
	function saveRemovalDecision(): void {
		const e = event;
		if (!e) return;
		if (removalDirty) {
			actions.setRemovalDecisions(e.id, removalDraft);
		}
		open = false;
	}
	// Local readOnly state mirrors inheritMode AT OPEN TIME. Unlike the old
	// edit-live design, mode toggles here are LOCAL: setMode does NOT fire the
	// daemon RPC. The chosen mode (and any form edits) are committed only when
	// the user clicks Save (see saveMember). This is what makes the dirty check
	// work and prevents custom edits from polluting the inherit view.
	let readOnly = $state(untrack(() => inheritMode));
	// Snapshot of the mode at dialog-open time, captured ONCE per opened event.
	// NOTE: we deliberately do NOT re-sync this from the reactive `inheritMode`
	// prop on every change — doing so would clobber the snapshot the moment the
	// daemon broadcast echoed a toggle, breaking the dirty check. Re-seed ONLY
	// on event identity change.
	let initialMode = $state<'inherit' | 'custom'>(untrack(() => (inheritMode ? 'inherit' : 'custom')));
	$effect(() => {
		void event?.id; // track identity only
		// Re-seed readOnly + initialMode when a DIFFERENT member opens.
		readOnly = inheritMode;
		initialMode = inheritMode ? 'inherit' : 'custom';
	});

	/** Whether the user has toggled inherit/custom since opening (independent of
	 *  form-content edits — both count as "dirty" for the footer). */
	const modeChanged = $derived(readOnly !== (initialMode === 'inherit'));

	/** Local-only mode toggle (no daemon round-trip). */
	function setMode(next: 'inherit' | 'custom'): void {
		readOnly = next === 'inherit';
	}

	/** Commit the dialog's local mode + staged config to the daemon, then close.
	 *  Fires the RPCs the edit-live path used to fire on every keystroke — but
	 *  only now, with the user's final intent. */
	function saveMember(stagedConfig: TrustedPublisherCreateConfig | null): void {
		const e = event;
		if (!e) return;
		if (modeChanged) {
			actions.setMemberInherit(e.id, readOnly);
		}
		// Only ship a custom config when the final mode is custom and there is a
		// valid staged config. In inherit mode the daemon clears the member's
		// own config via setMemberInherit(true) above.
		if (!readOnly && stagedConfig) {
			actions.updateConfigureTrustDraft(e.id, stagedConfig);
		}
		open = false;
	}
</script>

<Dialog bind:open>
	<!-- max-h (not fixed h) so the dialog shrinks to its content when the body
	     is short, only scrolling once it would exceed the cap. -->
	<DialogContent
		class="grid max-h-[min(100dvh,40rem)] w-[min(100%,44rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
		aria-describedby={undefined}
	>
		{#if event && isGroupedRemoval}
			<!-- Dedicated single-package removal view projected from the immutable
			     registry snapshot captured when the Event was created. -->
			<DialogHeader class="flex-row items-center gap-2.5 border-b px-4 py-3">
				<span
					class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-warning/38 bg-warning/10 text-warning"
				>
					<IconShieldMinus class="h-4 w-4" />
				</span>
				<div class="min-w-0 flex-1">
					<DialogTitle class="truncate text-base">
						{$_('removeTrustedPublishingGroup.title')}
					</DialogTitle>
					<DialogDescription class="truncate font-mono">
						{removalPackageName}
					</DialogDescription>
				</div>
			</DialogHeader>
			<!-- Scrollable body: independent decisions for every current config. -->
			<div class="min-h-0 overflow-y-auto p-4">
				<TrustedPublishingRemovalReview
					configs={removalConfigs}
					decisions={removalDraft}
					status={removalStatus}
					onDecision={setRemovalDraft}
				/>
			</div>
			<!-- Pinned footer: LEFT cluster = Discard/Save Changes (local-staged
			     decision), RIGHT cluster = open-actions (npm/repo/folder). Same
			     justify-between two-ButtonGroup layout as the standard EventCardFooter. -->
			<div class="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
				<ButtonGroup>
					{#if removalDirty}
						<Button
							variant="outline"
							size="sm"
							onclick={() => {
								// Roll back the LOCAL decision to its open-time state.
								removalDraft = { ...removalInitial };
							}}
						>
							<IconReset class="h-3.5 w-3.5" />
							{$_('eventCard.discard')}
						</Button>
						<Button
							variant="brand"
							size="sm"
							onclick={saveRemovalDecision}
						>
							{$_('common.saveChanges')}
						</Button>
					{:else}
						<Button
							variant="outline"
							size="sm"
							onclick={() => (open = false)}
						>
							<IconX class="h-3.5 w-3.5" />
							{$_('common.close')}
						</Button>
					{/if}
				</ButtonGroup>
				{#if removalHasOpenActions}
					<ButtonGroup>
						<EventCardOpenActions
							repoInfo={removalRepoInfo}
							sourcePath={removalSourcePath}
							npmUrl={removalNpmUrl}
							onOpenUrl={removalOpenUrl}
							onOpenPath={removalOpenPath}
						/>
					</ButtonGroup>
				{/if}
			</div>
		{:else if event}
			<EventCard
				{event}
				variant="full"
				surface="dialog"
				{readOnly}
				trustGroupId={readOnly ? event.groupId : undefined}
				headerClass="pr-9"
				useFooterLeftCluster={useDiscardFooter || isGroupedRemoval}
				deferSubmit={useDiscardFooter}
			>
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
				<!-- Named-snippet child: auto-binds to the `footerLeftCluster`
				     prop (idiomatic Svelte 5 — no forward-reference). The LEFT
				     cluster of the pending footer: for a group trust member this
				     replaces the default Confirm/Reject (single confirm is gated
				     to the group's batch action); the RIGHT open-actions cluster
				     is untouched. Receives `{ draftDirty, resetDraft, stagedConfig }`
				     (deferSubmit form state) from EventCardFooter; combines with the
				     mode-toggle dirty signal so a mode switch ALSO counts as a change.
				     Two button states:
				       - clean → 「Close」
				       - dirty → 「Discard changes」(rollback local mode+form, stay open)
				                 + 「Save」(commit mode+config to daemon, close).
				     Mode + form are LOCAL until Save, so switching back to inherit
				     simply drops the local form edits — no daemon round-trip, no
				     pollution of the group default. -->
				{#snippet footerLeftCluster({ draftDirty, resetDraft, stagedConfig })}
					{@const combinedDirty = draftDirty || modeChanged}
					<ButtonGroup>
						{#if combinedDirty}
							<Button
								variant="outline"
								size="sm"
								onclick={() => {
									// Roll back the LOCAL mode + form to their open-time state.
									// No daemon calls — edits were staged locally (deferSubmit).
									if (modeChanged) setMode(initialMode);
									if (initialMode === 'custom' && draftDirty) resetDraft();
								}}
							>
								<IconReset class="h-3.5 w-3.5" />
								{$_('eventCard.discard')}
							</Button>
							<Button variant="brand" size="sm" onclick={() => saveMember(stagedConfig)}>
								{$_('common.saveChanges')}
							</Button>
						{:else}
							<Button variant="outline" size="sm" onclick={() => (open = false)}>
								<IconX class="h-3.5 w-3.5" />
								{$_('common.close')}
							</Button>
						{/if}
					</ButtonGroup>
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
					<!-- Pinned footer row: the EventCard footer (with its LEFT
					     cluster overridden for trust members, RIGHT open-actions
					     untouched). Only when the card emits a footer. -->
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
