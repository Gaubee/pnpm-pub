<script lang="ts">
	/**
	 * Event card — the unit of the Events Hub (Chapter 6.2).
	 * Renders a Pending (with Diff + Confirm/Reject), Success, Failed, or
	 * Expired event. Honors context-override (Chapter 5.4.5 / 6.2.2).
	 */
	import type { EventStatus, PubEvent, PublishTarget, TarballSummary } from '$lib/types.js';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar/index.js';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader } from '$lib/components/ui/card/index.js';
	import { actions, daemon } from '$lib/store.js';
	import { apiFetch } from '$lib/api-fetch.js';
	import { parseOkResponse } from '$lib/rest-response.js';
	import { errorToMessage } from '$lib/error-projection.js';
	import TarballTree from '$lib/components/tarball-tree.svelte';
	import IconPublish from '@lucide/svelte/icons/upload';
	import IconOidc from '@lucide/svelte/icons/shield-check';
	import IconPlaceholder from '@lucide/svelte/icons/package';
	import IconRefresh from '@lucide/svelte/icons/refresh-cw';
	import IconArrowRight from '@lucide/svelte/icons/arrow-right';
	import IconClock from '@lucide/svelte/icons/clock';
	import IconCheck from '@lucide/svelte/icons/check';
	import IconX from '@lucide/svelte/icons/x';
	import IconRotateCw from '@lucide/svelte/icons/rotate-cw';
	import IconTrash from '@lucide/svelte/icons/trash-2';
	import IconChevronRight from '@lucide/svelte/icons/chevron-right';
	import IconFolder from '@lucide/svelte/icons/folder';
	import IconFile from '@lucide/svelte/icons/file';
	import IconLoader from '@lucide/svelte/icons/loader-circle';
	import { _ } from 'svelte-i18n';

	let {
		event,
		/** Log display mode: 'full' (wrapped, scrollable both axes) or 'compact'
		 *  (single-line truncated; click toggles a horizontally-scrollable block). */
		variant = 'full',
	}: { event: PubEvent; variant?: 'full' | 'compact' } = $props();

	const STATUS_VARIANTS = {
		pending: 'brand',
		success: 'success',
		failed: 'destructive',
		expired: 'warning',
		'action-required': 'warning',
		rejected: 'secondary',
	} satisfies Record<EventStatus, NonNullable<BadgeVariant>>;

	const iconFor = (kind: PubEvent['kind']) =>
		({
			publish: IconPublish,
			'setup-oidc': IconOidc,
			'create-placeholder': IconPlaceholder,
			'refresh-token': IconRefresh,
			import: IconRefresh,
			export: IconRefresh,
		})[kind] ?? IconPublish;

	const IconCmp = $derived(iconFor(event.kind));

	const statusVariant = $derived(STATUS_VARIANTS[event.status]);
	const statusLabel = $derived(
		event.status === 'action-required'
			? $_('eventCard.status.actionRequired')
			: $_(`eventCard.status.${event.status}`),
	);

	const isPending = $derived(event.status === 'pending');
	const isExpired = $derived(event.status === 'expired');
	const needsAction = $derived(event.status === 'action-required');

	// Context-override: the event may be tied to a different profile than the
	// sidebar's current selection (Chapter 5.4.5 / 6.2.2).
	const overrideActive = $derived(!!event.profileOverride && event.profileOverride !== $daemon.defaultProfile);
	const effectiveProfile = $derived(event.profileOverride ?? event.profile);
	const effectiveProfileRecord = $derived($daemon.profiles.find((p) => p.username === effectiveProfile) ?? null);

	const initials = (n: string): string =>
		n.split(/[\s_-]+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

	// Publish carries a target; placeholder projects its generated v0.0.0 target for display.
	function makePlaceholderTarget(name: string): PublishTarget {
		return {
			name,
			version: '0.0.0',
			previousVersion: undefined,
			description: $_('eventCard.generatedPlaceholder'),
			path: $_('eventCard.generated'),
		};
	}

	const publishTarget = $derived(
		event.payload?.kind === 'publish'
			? event.payload.data
			: event.payload?.kind === 'create-placeholder'
				? ({ target: makePlaceholderTarget(event.payload.data.name) })
				: null,
	);
	const oidcCtx = $derived(event.payload?.kind === 'setup-oidc' ? event.payload.data : null);

	const timeLabel = $derived(new Date(event.createdAt).toLocaleTimeString());

	// Tarball file-tree preview — collapsed by default.
	let showFiles = $state(false);
	// Compact-log expansion: toggles the single-line → scrollable block.
	let logExpanded = $state(false);

	// Publish actions (retry / unpublish) — only for publish events.
	const isPublish = $derived(event.payload?.kind === 'publish');
	const publishData = $derived(
		event.payload?.kind === 'publish' ? event.payload.data : null,
	);
	const tarballSummary = $derived(event.tarballSummary ?? null);
	const isRetryable = $derived(isPublish && (event.status === 'failed' || event.status === 'expired'));
	const isUnpublishable = $derived(isPublish && event.status === 'success');
	let actionBusy = $state(false);
	let actionError = $state<string | null>(null);
	let confirmUnpublish = $state(false);

	function retry(): void {
		if (!publishData) return;
		// Re-create the publish event with the SAME payload + SAME groupId so it
		// folds into the same group in the Events Hub.
		actions.createEvent('publish', publishData, event.groupId);
	}

	async function doUnpublish(): Promise<void> {
		if (!publishData || actionBusy) return;
		actionBusy = true;
		actionError = null;
		const name = publishData.target.name;
		const version = publishData.target.version;
		try {
			const res = await apiFetch('/api/unpublish', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ package: name, version }),
			});
			const json = parseOkResponse(await res.json());
			if (!json) { actionError = $_('eventCard.unpublishFailed'); return; }
			if (!json.ok) { actionError = json.error ?? $_('eventCard.unpublishFailed'); return; }
			confirmUnpublish = false;
		} catch (err) {
			actionError = errorToMessage(err);
		} finally {
			actionBusy = false;
		}
	}

	/** Human-readable byte size. */
	function humanSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
	}
</script>

<Card class="transition-shadow {isPending ? 'ring-2 ring-brand/40 shadow-md' : ''}">
	<CardHeader class="flex-row items-center justify-between gap-3 pb-3">
		<div class="flex min-w-0 items-center gap-2.5">
			<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground">
				<IconCmp class="h-4 w-4" />
			</div>
			<div class="min-w-0">
				<div class="flex items-center gap-2">
					<span class="truncate text-sm font-semibold">
						{#if publishTarget}{publishTarget.target.name}{:else if oidcCtx}{oidcCtx.name}{:else}{event.kind}{/if}
					</span>
					<Badge variant={statusVariant} class="h-5 capitalize">
						{#if isPending}<IconClock class="mr-1 h-3 w-3" />{/if}
						{statusLabel}
					</Badge>
				</div>
				<div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
					<IconClock class="h-3 w-3" /> {timeLabel}
					{#if event.clockDriftRecovered}
						<span class="ml-1 text-warning">· {$_('eventCard.driftRecovered')}</span>
					{/if}
				</div>
			</div>
		</div>

		<!-- Effective identity pill (Chapter 6.2.2 context override). -->
		<div class="flex items-center gap-1.5 rounded-full border px-2 py-1 {overrideActive ? 'border-warning bg-warning/10' : 'border-border'}">
			<Avatar class="h-5 w-5">
				{#if effectiveProfileRecord?.avatarUrl}
					<AvatarImage src={effectiveProfileRecord.avatarUrl} alt={effectiveProfileRecord.username} />
				{/if}
				<AvatarFallback class="text-[9px]">{initials(effectiveProfile)}</AvatarFallback>
			</Avatar>
			<span class="max-w-[8rem] truncate text-[11px] font-medium">{effectiveProfile}</span>
		</div>
	</CardHeader>

	<CardContent class="space-y-3">
		{#if overrideActive}
			<div class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
				{$_('eventCard.override', { values: { profile: event.profileOverride } })}
			</div>
		{/if}

			{#if publishTarget}
				<div class="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs">
					<span class="font-semibold">{publishTarget.target.name}</span>
					{#if publishTarget.target.previousVersion}
						<span class="text-muted-foreground">{publishTarget.target.previousVersion}</span>
						<IconArrowRight class="h-3 w-3 text-muted-foreground" />
					{/if}
					<span class="text-brand">{publishTarget.target.version}</span>
				</div>
				{#if publishTarget.target.repository}
					<p class="text-[11px] text-muted-foreground">{$_('eventCard.repo')} <span class="font-mono">{publishTarget.target.repository}</span></p>
				{/if}
				{#if publishTarget.target.description}
					<p class="text-xs text-muted-foreground">{publishTarget.target.description}</p>
				{/if}
		{:else if oidcCtx}
			<div class="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
				{$_('eventCard.configureOidc', { values: { name: oidcCtx.name } })} <span class="font-mono">{oidcCtx.name}</span>
				{#if oidcCtx.repo}· repo <span class="font-mono">{oidcCtx.repo}</span>{/if}
			</div>
		{/if}

		{#if !isPending && event.result}
			{#if variant === 'compact'}
				<!-- Compact: single-line truncated; click toggles a horizontally-scrollable block (no wrap). -->
				<button
					type="button"
					class="w-full cursor-pointer rounded-md bg-muted/40 px-3 py-2 text-left font-mono text-[11px] {isExpired || event.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}"
					onclick={() => (logExpanded = !logExpanded)}
					title={logExpanded ? $_('eventCard.collapse') : $_('events.expand')}
				>
					{#if logExpanded}
						<div class="max-h-40 overflow-x-auto overflow-y-auto whitespace-pre">
							{event.result}
						</div>
					{:else}
						<div class="truncate">{event.result}</div>
					{/if}
				</button>
			{:else}
				<!-- Full: wrapped, scrollable both axes. -->
				<div class="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 px-3 py-2 font-mono text-[11px] {isExpired || event.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}">
					{event.result}
				</div>
			{/if}
		{/if}

		{#if tarballSummary}
			<div class="rounded-md border border-border">
				<button
					type="button"
					class="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
					onclick={() => (showFiles = !showFiles)}
				>
					<IconChevronRight class="h-3 w-3 transition-transform {showFiles ? 'rotate-90' : ''}" />
					<IconFolder class="h-3 w-3" />
					<span>{$_('eventCard.tarballContents')}</span>
					<span class="ml-auto font-mono text-muted-foreground/70">
						{$_('eventCard.tarballSummary', { values: { n: tarballSummary.files.length, size: humanSize(tarballSummary.unpackedSize) } })}
					</span>
				</button>
				{#if showFiles}
					<div class="max-h-56 overflow-auto border-t border-border px-2 py-1.5">
						<TarballTree files={tarballSummary.files} />
					</div>
				{/if}
			</div>
		{/if}

		{#if actionError}
			<div class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive" role="alert">
				{actionError}
			</div>
		{/if}

		{#if isPending}
			<div class="flex items-center gap-2 pt-1">
				<Button variant="brand" size="sm" class="flex-1" onclick={() => actions.confirm(event.id)}>
					<IconCheck class="h-3.5 w-3.5" />
					{#if event.kind === 'setup-oidc'}{$_('eventCard.confirmSetupOidc')}{:else if event.kind === 'refresh-token'}{$_('eventCard.confirmTokenRefresh')}{:else}{$_('eventCard.confirmPublish')}{/if}
				</Button>
				<Button variant="outline" size="sm" onclick={() => actions.reject(event.id)}>
					<IconX class="h-3.5 w-3.5" /> {$_('eventCard.reject')}
				</Button>
			</div>
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
		{/if}

		{#if !isPending && (isRetryable || isUnpublishable)}
			{#if confirmUnpublish}
				<div class="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
					<p class="text-[11px] text-destructive">
						{$_('eventCard.unpublishConfirm', { values: { name: publishData?.target.name ?? '', version: publishData?.target.version ?? '' } })}
					</p>
					<div class="flex items-center gap-2">
						<Button variant="destructive" size="sm" class="flex-1" disabled={actionBusy} onclick={doUnpublish}>
							{#if actionBusy}<IconLoader class="h-3.5 w-3.5 animate-spin" />{/if}
							{$_('eventCard.unpublish')}
						</Button>
						<Button variant="outline" size="sm" disabled={actionBusy} onclick={() => (confirmUnpublish = false)}>
							{$_('common.cancel')}
						</Button>
					</div>
				</div>
			{:else}
				<div class="flex items-center gap-2 pt-1">
					{#if isRetryable}
						<Button variant="brand" size="sm" class="flex-1" onclick={retry}>
							<IconRotateCw class="h-3.5 w-3.5" /> {$_('eventCard.retry')}
						</Button>
					{/if}
					{#if isUnpublishable}
						<Button variant="outline" size="sm" class={isRetryable ? '' : 'flex-1'} onclick={() => (confirmUnpublish = true)}>
							<IconTrash class="h-3.5 w-3.5" /> {$_('eventCard.unpublish')}
						</Button>
					{/if}
				</div>
			{/if}
		{/if}
	</CardContent>
</Card>
