<script lang="ts">
	/**
	 * EventCardFooter — the bottom action region of an EventCard. Renders one
	 * of four mutually-exclusive paths driven by the event status:
	 *
	 *   1. pending            → confirm / reject ButtonGroup (+ open actions)
	 *   2. expired / action   → renew-now outline button (+ open actions)
	 *   3. resolved + actions → retry / unpublish (with ConfirmAction) + autoClose (+ open actions)
	 *   4. resolved + no act. → bare autoClose bar (OR just the open actions)
	 *
	 * The "click to open" actions (repo browse link, open-folder, npm link)
	 * gather here at the inline-end of every branch, as an INDEPENDENT
	 * ButtonGroup held apart from the status-driven buttons by
	 * `justify-between` — so the primary actions (left) and the open links
	 * (right) form two isolated, opposing clusters with whitespace between,
	 * never merged into one group.
	 *
	 * Pure presentational. `confirmUnpublish` (the local two-step confirmation
	 * state for unpublish / retry-of-unpublish) lives here because it is purely
	 * a footer-internal UI concern.
	 */
	import type { ConfigureTrustContext, EventKind, EventStatus, PublishContext, TrustedPublisherCreateConfig, UnpublishContext } from '$lib/types.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ButtonGroup, ButtonGroupSeparator } from '$lib/components/ui/button-group/index.js';
	import ConfirmAction from '$lib/components/confirm-action.svelte';
	import AutoCloseBar from '$lib/components/auto-close-bar.svelte';
	import EventCardOpenActions from '$lib/components/event-card-open-actions.svelte';
	import type { RepoInfo } from '$lib/components/repo-info-types.js';
	import IconCheck from '@lucide/svelte/icons/check';
	import IconX from '@lucide/svelte/icons/x';
	import IconLoader from '@lucide/svelte/icons/loader-circle';
	import IconRotateCw from '@lucide/svelte/icons/rotate-cw';
	import IconTrash from '@lucide/svelte/icons/trash-2';
	import type { Snippet } from 'svelte';
	import { _ } from 'svelte-i18n';

	type Props = {
		eventKind: EventKind;
		status: EventStatus;
		isPending: boolean;
		isExpired: boolean;
		needsAction: boolean;
		isRetryableStatus: boolean;
		isRetryable: boolean;
		hasRetryButton: boolean;
		isUnpublishable: boolean;
		isPublish: boolean;
		configureTrustCtx: ConfigureTrustContext | null;
		unpublishCtx: UnpublishContext | null;
		publishData: PublishContext | null;
		canConfirm: boolean;
		confirming: boolean;
		rejecting: boolean;
		autoClose: boolean;
		/** 'full' renders the inline autoClose bar; 'compact' suppresses it. */
		variant: 'full' | 'compact';
		/** Inline-end "click to open" actions (repo / folder / npm). Passed
		 *  through verbatim to EventCardOpenActions and appended after every
		 *  status-driven branch. Null when the host has no open links at all. */
		repoInfo: RepoInfo | null;
		sourcePath: string;
		npmUrl: string;
		onOpenUrl: (url: string) => void;
		onOpenPath: (path: string) => void;
		onConfirm: () => void;
		onReject: () => void;
		onRetry: () => void;
		onUnpublish: () => void;
		onAutoClose?: () => void;
		/** Trust form dirty state + reset, forwarded into the `leftCluster`
		 *  snippet so the host's override can drive a discard button. Only
		 *  meaningful when `leftCluster` is supplied. */
		draftDirty?: boolean;
		resetDraft?: () => void;
		/** Local-staged trust config (deferSubmit mode), forwarded into
		 *  `leftCluster` so Save can submit it. */
		stagedConfig?: TrustedPublisherCreateConfig | null;
		/** Whether the `leftCluster` override should actually take effect. When
		 *  false (or unset) the default confirm/reject renders even if
		 *  `leftCluster` is supplied — lets the host pass the snippet once and
		 *  gate it per-event without a forward-reference in the template. */
		useLeftCluster?: boolean;
		/** Overrides the pending branch's LEFT cluster (default: confirm/reject).
		 *  When supplied, the host's snippet replaces the confirm/reject
		 *  ButtonGroup in-place; the RIGHT open-actions cluster is untouched.
		 *  Used by EventDetailDialog to render a discard/close row for trust
		 *  members whose single confirm is gated to the group's batch action.
		 *  Receives `{ draftDirty, resetDraft }` so the override can read the
		 *  trust form's dirty state and trigger a reset. */
		leftCluster?: Snippet<[{ draftDirty: boolean; resetDraft: () => void; stagedConfig: TrustedPublisherCreateConfig | null }]>;
	};

	let {
		eventKind,
		status,
		isPending,
		isExpired,
		needsAction,
		isRetryableStatus,
		isRetryable,
		hasRetryButton,
		isUnpublishable,
		isPublish,
		configureTrustCtx,
		unpublishCtx,
		publishData,
		canConfirm,
		confirming,
		rejecting,
		autoClose,
		variant,
		repoInfo,
		sourcePath,
		npmUrl,
		onOpenUrl,
		onOpenPath,
		onConfirm,
		onReject,
		onRetry,
		onUnpublish,
		onAutoClose,
		draftDirty,
		resetDraft,
		stagedConfig,
		useLeftCluster,
		leftCluster,
	}: Props = $props();

	/** Whether ANY inline-end open action renders. Drives the trailing
	 *  sub-group (separator + actions) so an event with no repo/folder/npm
	 *  context shows no stray divider. */
	const hasOpenActions = $derived(!!repoInfo || !!sourcePath || !!npmUrl);

	// Local two-step confirmation state — footer-internal only.
	let confirmUnpublish = $state(false);

	// Re-derive the unpublish warn message whenever the underlying context
	// changes (the dialog case re-mounts this footer per opened event, so this
	// stays fresh without explicit reset logic).
	const unpublishWarn = $derived(
		$_('eventCard.unpublishConfirm', {
			values: {
				name: unpublishCtx?.name ?? publishData?.target.name ?? '',
				version: unpublishCtx?.version ?? publishData?.target.version ?? '',
			},
		}),
	);
</script>

{#if isPending}
	<!-- LEFT cluster: confirm / reject (OR a host-supplied `leftCluster` when
	     present, e.g. the dialog's discard/close row). RIGHT cluster: open links.
	     The two are deliberately isolated as independent ButtonGroups (not one
	     group with a separator) so the primary actions and the "click to open"
	     links read as opposing ends, with whitespace between. -->
	<div class="flex flex-wrap items-center justify-between gap-2">
		{#if leftCluster && useLeftCluster}
			{@render leftCluster({ draftDirty: !!draftDirty, resetDraft: resetDraft ?? (() => {}), stagedConfig: stagedConfig ?? null })}
		{:else}
			<ButtonGroup>
				<Button variant={eventKind === 'unpublish' || configureTrustCtx?.action === 'remove' ? 'destructive' : 'brand'} size="sm" class="flex-1" disabled={!canConfirm || confirming} onclick={onConfirm}>
					{#if confirming}<IconLoader class="h-3.5 w-3.5 animate-spin" />{:else}<IconCheck class="h-3.5 w-3.5" />{/if}
					{#if confirming}
						{$_('eventCard.confirming')}
					{:else if eventKind === 'configure-trust'}
						{configureTrustCtx?.action === 'remove' ? $_('eventCard.confirmRemoveTrustedPublishing') : $_('eventCard.confirmTrustedPublishing')}
					{:else if eventKind === 'recursive-publish'}
						{$_('eventCard.confirmRecursivePublish')}
					{:else if eventKind === 'refresh-token'}
						{$_('eventCard.confirmTokenRefresh')}
					{:else if eventKind === 'unpublish'}
						{$_('eventCard.confirmUnpublish')}
					{:else}
						{$_('eventCard.confirmPublish')}
					{/if}
				</Button>
				<Button variant="outline" size="sm" disabled={rejecting} onclick={onReject}>
					{#if rejecting}<IconLoader class="h-3.5 w-3.5 animate-spin" />{:else}<IconX class="h-3.5 w-3.5" />{/if}
					{$_('eventCard.reject')}
				</Button>
			</ButtonGroup>
		{/if}
		{#if hasOpenActions}
			<ButtonGroup>
				<EventCardOpenActions {repoInfo} {sourcePath} {npmUrl} {onOpenUrl} {onOpenPath} />
			</ButtonGroup>
		{/if}
	</div>
{:else if isExpired || needsAction}
	<!-- Chapter 6.2.4: expired/manual refresh events surface the renew flow.
	     The renew button keeps full width; open links render below, isolated to
	     the inline-end, so the primary call-to-action stays uncluttered. -->
	<Button
		variant="outline"
		size="sm"
		class="w-full"
		onclick={() => (window.location.href = `/renew?reason=${isExpired ? 'expired' : 'action-required'}`)}
	>
		{isExpired ? $_('eventCard.tokenExpired') : $_('eventCard.credentialRequired')} — {$_('eventCard.renewNow')}
	</Button>
	{#if hasOpenActions}
		<div class="mt-2 flex justify-end">
			<ButtonGroup>
				<EventCardOpenActions {repoInfo} {sourcePath} {npmUrl} {onOpenUrl} {onOpenPath} />
			</ButtonGroup>
		</div>
	{/if}
{:else if isRetryable || isUnpublishable}
	{#if confirmUnpublish}
		<!-- Two-step confirmation expanded inline (unpublish / retry-of-unpublish).
		     The confirm card is a full-width block; the open links sit below it,
		     isolated to the inline-end, so they stay reachable mid-confirm. -->
		<ConfirmAction
			bind:open={confirmUnpublish}
			warn={unpublishWarn}
			confirmLabel={$_('eventCard.unpublish')}
			onConfirm={eventKind === 'unpublish' ? onRetry : onUnpublish}
		/>
		{#if hasOpenActions}
			<div class="mt-2 flex justify-end">
				<ButtonGroup>
					<EventCardOpenActions {repoInfo} {sourcePath} {npmUrl} {onOpenUrl} {onOpenPath} />
				</ButtonGroup>
			</div>
		{/if}
	{:else}
		<!-- LEFT cluster: retry / unpublish (+ auto-close). RIGHT cluster: open
		     links. Two independent ButtonGroups held apart by justify-between so
		     the action buttons and the open links form opposing ends. -->
		<div class="flex flex-wrap items-center justify-between gap-2">
			<ButtonGroup>
				{#if hasRetryButton}
					<Button variant="outline" size="sm" class="flex-1" onclick={onRetry}>
						<IconRotateCw class="h-3.5 w-3.5" /> {$_('eventCard.retry')}
					</Button>
				{/if}
				{#if isUnpublishable}
					<ConfirmAction bind:open={confirmUnpublish} warn={$_('eventCard.unpublishConfirm', { values: { name: publishData?.target.name ?? '', version: publishData?.target.version ?? '' } })} confirmLabel={$_('eventCard.unpublish')} flex={!isRetryableStatus} onConfirm={onUnpublish}>
						{#snippet triggerIcon()}<IconTrash class="h-3.5 w-3.5" />{/snippet}
						{#snippet triggerLabel()}{$_('eventCard.unpublish')}{/snippet}
					</ConfirmAction>
				{/if}
				{#if eventKind === 'unpublish' && isRetryableStatus}
					<ConfirmAction bind:open={confirmUnpublish} warn={$_('eventCard.unpublishConfirm', { values: { name: unpublishCtx?.name ?? '', version: unpublishCtx?.version ?? '' } })} confirmLabel={$_('eventCard.retry')} flex onConfirm={onRetry}>
						{#snippet triggerIcon()}<IconRotateCw class="h-3.5 w-3.5" />{/snippet}
						{#snippet triggerLabel()}{$_('eventCard.retry')}{/snippet}
					</ConfirmAction>
				{/if}
				{#if autoClose && variant === 'full'}
					<ButtonGroupSeparator />
					<AutoCloseBar seconds={10} onclose={onAutoClose} />
				{/if}
			</ButtonGroup>
			{#if hasOpenActions}
				<ButtonGroup>
					<EventCardOpenActions {repoInfo} {sourcePath} {npmUrl} {onOpenUrl} {onOpenPath} />
				</ButtonGroup>
			{/if}
		</div>
	{/if}
{:else if hasOpenActions}
	<!-- Resolved with no status-driven action buttons but still carrying open
	     links (e.g. a successful publish → npm link). LEFT: auto-close bar (when
	     active); RIGHT: open links. The two stay isolated at opposite ends. -->
	<div class="flex flex-wrap items-center justify-between gap-2">
		{#if autoClose && variant === 'full'}
			<ButtonGroup>
				<AutoCloseBar seconds={10} onclose={onAutoClose} />
			</ButtonGroup>
		{/if}
		<ButtonGroup class={autoClose && variant === 'full' ? '' : 'ml-auto'}>
			<EventCardOpenActions {repoInfo} {sourcePath} {npmUrl} {onOpenUrl} {onOpenPath} />
		</ButtonGroup>
	</div>
{:else if autoClose && variant === 'full'}
	<!-- Resolved with no action buttons and no open links but still auto-closable. -->
	<ButtonGroup>
		<AutoCloseBar seconds={10} onclose={onAutoClose} />
	</ButtonGroup>
{/if}
