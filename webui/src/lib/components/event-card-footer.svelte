<script lang="ts">
	/**
	 * EventCardFooter — the bottom action region of an EventCard. Renders one
	 * of four mutually-exclusive paths driven by the event status:
	 *
	 *   1. pending            → confirm / reject ButtonGroup
	 *   2. expired / action   → renew-now outline button
	 *   3. resolved + actions → retry / unpublish (with ConfirmAction) + autoClose
	 *   4. resolved + no act. → bare autoClose bar
	 *
	 * Pure presentational. `confirmUnpublish` (the local two-step confirmation
	 * state for unpublish / retry-of-unpublish) lives here because it is purely
	 * a footer-internal UI concern.
	 */
	import type { ConfigureTrustContext, EventKind, EventStatus, PublishContext, UnpublishContext } from '$lib/types.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ButtonGroup, ButtonGroupSeparator } from '$lib/components/ui/button-group/index.js';
	import ConfirmAction from '$lib/components/confirm-action.svelte';
	import AutoCloseBar from '$lib/components/auto-close-bar.svelte';
	import IconCheck from '@lucide/svelte/icons/check';
	import IconX from '@lucide/svelte/icons/x';
	import IconLoader from '@lucide/svelte/icons/loader-circle';
	import IconRotateCw from '@lucide/svelte/icons/rotate-cw';
	import IconTrash from '@lucide/svelte/icons/trash-2';
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
		onConfirm: () => void;
		onReject: () => void;
		onRetry: () => void;
		onUnpublish: () => void;
		onAutoClose?: () => void;
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
		onConfirm,
		onReject,
		onRetry,
		onUnpublish,
		onAutoClose,
	}: Props = $props();

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
{:else if isExpired || needsAction}
	<!-- Chapter 6.2.4: expired/manual refresh events surface the renew flow. -->
	<Button
		variant="outline"
		size="sm"
		class="w-full"
		onclick={() => (window.location.href = `/renew?reason=${isExpired ? 'expired' : 'action-required'}`)}
	>
		{isExpired ? $_('eventCard.tokenExpired') : $_('eventCard.credentialRequired')} — {$_('eventCard.renewNow')}
	</Button>
{:else if isRetryable || isUnpublishable}
	{#if confirmUnpublish}
		<!-- Two-step confirmation expanded inline (unpublish / retry-of-unpublish). -->
		<ConfirmAction
			bind:open={confirmUnpublish}
			warn={unpublishWarn}
			confirmLabel={$_('eventCard.unpublish')}
			onConfirm={eventKind === 'unpublish' ? onRetry : onUnpublish}
		/>
	{:else}
		<!-- Action + auto-close share one ButtonGroup. Retry-for-publish is a
		     direct brand button; unpublish (from publish-success) and
		     retry-for-unpublish use ConfirmAction (two-step confirmation). -->
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
	{/if}
{:else if autoClose && variant === 'full'}
	<!-- Resolved with no action buttons but still auto-closable. -->
	<ButtonGroup>
		<AutoCloseBar seconds={10} onclose={onAutoClose} />
	</ButtonGroup>
{/if}
