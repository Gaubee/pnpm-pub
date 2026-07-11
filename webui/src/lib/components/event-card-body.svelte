<script lang="ts">
	/**
	 * EventCardBody — the scrollable middle section of an EventCard: override
	 * banner, description / trust-action context, the configure-trust branch
	 * (remove / read-only summary / editable TrustFormCard), recursive target
	 * list, expandable result log, tarball preview, and the pending advanced
	 * publish options.
	 *
	 * Pure presentational — all derived values come from the EventCard
	 * assembler. Local UI state (logExpanded / showFiles / advancedOpen) lives
	 * here because it is internal to this section and never read elsewhere.
	 *
	 * `bind:valid` is forwarded to the embedded TrustFormCard so the parent
	 * EventCard can gate its Footer confirm button on the draft's validity.
	 */
	import type {
		ConfigureTrustContext,
		EventStatus,
		PubEvent,
		RecursivePublishContext,
		RemovalDecision,
		RemovalDecisions,
		TarballSummary,
		TrustedPublisherRegistryConfig,
		TrustedPublisherCreateConfig,
		UnpublishContext,
	} from '$lib/types.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import TarballTree from '$lib/components/tarball-tree.svelte';
	import RecursiveTargetList from '$lib/components/recursive-target-list.svelte';
	import TrustFormCard from '$lib/components/trust-form-card.svelte';
	import TrustedPublishingRemovalReview from '$lib/components/trusted-publishing-removal-review.svelte';
	import TrustedPublishingReadonly from '$lib/components/trusted-publishing-readonly.svelte';
	import type { TrustedPublishingStatus } from '$lib/hooks/use-trusted-publishing.svelte.js';
	import { resolveTrustedPublishingConfig } from '$lib/trusted-publishing.js';
	import { daemon } from '$lib/store.js';
	import IconTrustedPublishing from '@lucide/svelte/icons/shield-check';
	import IconChevronRight from '@lucide/svelte/icons/chevron-right';
	import IconFolder from '@lucide/svelte/icons/folder';
	import IconGitBranch from '@lucide/svelte/icons/git-branch';
	import IconAlertTriangle from '@lucide/svelte/icons/triangle-alert';
	import IconBadgeInfo from '@lucide/svelte/icons/badge-info';
	import IconLoader from '@lucide/svelte/icons/loader-circle';
	import { _ } from 'svelte-i18n';

	type Props = {
		event: PubEvent;
		status: EventStatus;
		isPending: boolean;
		/** Trust-form binding lives in the parent (Footer confirm gating). */
		valid: boolean;
		/** Whether the trust form has been edited away from its seed. Bound up
		 *  to EventCard so a dialog footer can toggle "Close" ↔ "Discard". */
		dirty: boolean;
		/** Local-staged config (deferSubmit mode) + the defer flag. Bound up to
		 *  EventCard so a dialog can stage edits and submit only on Save. */
		stagedConfig: TrustedPublisherCreateConfig | null;
		deferSubmit: boolean;
		readOnly: boolean;
		trustGroupId: string | undefined;
		/** Context objects extracted from the event payload. */
		overrideActive: boolean;
		description: string | null;
		configureTrustCtx: ConfigureTrustContext | null;
		removalConfigs: readonly TrustedPublisherRegistryConfig[];
		removalDecisions: RemovalDecisions;
		removalStatus: TrustedPublishingStatus;
		onRemovalDecision: (configId: string, decision: RemovalDecision) => void;
		onRemovalRetry?: () => void;
		unpublishCtx: UnpublishContext | null;
		recursiveCtx: RecursivePublishContext | null;
		tarballSummary: TarballSummary | null;
		/** Confirm-button disabled state mirrors Footer's confirming flag so
		 *  the editable form greys out while a confirm is in flight. */
		confirming: boolean;
		/** Advanced publish options — shared source of truth + mutator. */
		hasAdvancedOptions: boolean;
		accessArg: 'public' | 'restricted';
		tagArg: string;
		ignoreScriptsOn: boolean;
		noGitChecksOn: boolean;
		publishBranchOn: boolean;
		publishBranchValue: string;
		currentBranch: string;
		isScopedPkg: boolean;
		showPublicOnlyAccess: boolean;
		hasSourcePublishOptions: boolean;
		branchMismatch: boolean;
		branchNoCurrent: boolean;
		onRebuildArgs: (overrides?: {
			access?: 'public' | 'restricted';
			tag?: string;
			ignoreScripts?: boolean;
			noGitChecks?: boolean;
			publishBranchOn?: boolean;
			publishBranch?: string;
		}) => void;
	};

	let {
		event,
		status,
		isPending,
		valid = $bindable(false),
		dirty = $bindable(false),
		stagedConfig = $bindable<TrustedPublisherCreateConfig | null>(null),
		deferSubmit = false,
		readOnly,
		trustGroupId,
		overrideActive,
		description,
		configureTrustCtx,
		removalConfigs,
		removalDecisions,
		removalStatus,
		onRemovalDecision,
		onRemovalRetry,
		unpublishCtx,
		recursiveCtx,
		tarballSummary,
		confirming,
		hasAdvancedOptions,
		accessArg,
		tagArg,
		ignoreScriptsOn,
		noGitChecksOn,
		publishBranchOn,
		publishBranchValue,
		currentBranch,
		isScopedPkg,
		showPublicOnlyAccess,
		hasSourcePublishOptions,
		branchMismatch,
		branchNoCurrent,
		onRebuildArgs,
	}: Props = $props();

	const isExpired = $derived(status === 'expired');

	/** Effective trusted-publishing config for THIS event, resolving group
	 *  inheritance (inherit → group default; custom → the member's own config).
	 *  Used by the read-only detail view inside EventDetailDialog so an inherit
	 *  member shows the group's default instead of "not configured". */
	const effectiveTrustConfig = $derived(
		resolveTrustedPublishingConfig(
			event,
			$daemon.groupTrustDefaults,
			$daemon.groupInheritMembers,
		),
	);

	// Local UI state — section-internal only.
	let showFiles = $state(false);
	let logExpanded = $state(false);
	let advancedOpen = $state(false);
	// Ref to the TrustFormCard (editable branch only). Re-exposes its
	// resetToSeed so EventCard can hand a "discard edits" action to a dialog.
	let trustFormRef: { resetToSeed: () => void } | null = $state(null);

	/** Restore the trust form (fields + daemon draft) to its seed. No-op when
	 *  the form isn't mounted (read-only / non-trust / non-editable branches). */
	export function resetToSeed(): void {
		trustFormRef?.resetToSeed();
	}

	/** Whether the daemon is (or soon will be) prefetching a tarball preview for
	 *  this event — a pending directory-source publish whose summary hasn't
	 *  arrived yet. Drives the loading placeholder so the accordion shows up
	 *  immediately instead of popping in once the async pack completes. */
	const tarballLoading = $derived(
		!tarballSummary &&
			isPending &&
			event.payload?.kind === 'publish' &&
			event.payload.data.source.kind === 'directory',
	);

	/** Human-readable byte size. */
	function humanSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
	}
</script>

<div class="space-y-3">
	{#if overrideActive}
		<div class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
			{$_('eventCard.override', { values: { profile: event.profileOverride } })}
		</div>
	{/if}

	{#if description}
		<p class="text-xs text-muted-foreground">{description}</p>
	{:else if configureTrustCtx}
		<div class="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
			{$_('eventCard.trustedPublishingAction', { values: { action: configureTrustCtx.action, name: configureTrustCtx.target.name } })}
			{#if configureTrustCtx.target.repository}· repo <span class="font-mono">{configureTrustCtx.target.repository}</span>{/if}
		</div>
	{/if}

	{#if configureTrustCtx}
		{#if configureTrustCtx.action === 'remove'}
			<TrustedPublishingRemovalReview
				configs={removalConfigs}
				decisions={removalDecisions}
				status={removalStatus}
				disabled={!isPending || confirming}
				onDecision={onRemovalDecision}
				onRetry={onRemovalRetry}
			/>
		{:else if isPending && readOnly && effectiveTrustConfig}
			<!-- Read-only view: detailed Trusted Publishing config (renders inside
			     the EventDetailDialog, where the user may flip to Custom/edit next,
			     so field descriptions are shown). For an inherit member this shows
			     the group's resolved default config (the member itself carries
			     none). The parent owns the read-only/editable switch. -->
			<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
				<IconTrustedPublishing class="h-3.5 w-3.5 shrink-0 text-brand" />
				{$_('trustedPublishing.inheritValues')}
			</div>
			<TrustedPublishingReadonly config={effectiveTrustConfig} mode="detailed" />
		{:else if isPending}
			<!-- Editable (custom) view. Seed priority:
			     1. the member's own config (an already-custom member);
			     2. target.currentConfig — for a CONFLICT member the daemon
			        backfilled the registry's existing (differing) config here, so
			        the form opens with it and the user edits to match → re-confirm
			        lands as skipped (Chapter 6.2.7);
			     3. the group default (a freshly-flipped custom member starts from
			        the inherited default rather than blank).
			     `trustGroupId=undefined` (passed by the dialog in custom mode)
			     routes edits to `updateConfigureTrustDraft` (the member's own
			     config), NOT the group default. -->
			<TrustFormCard
				bind:this={trustFormRef}
				eventId={event.id}
				groupId={trustGroupId ?? event.groupId}
				config={configureTrustCtx.config
					?? configureTrustCtx.target.currentConfig
					?? (event.groupId ? $daemon.groupTrustDefaults[event.groupId] : undefined)}
				currentConfig={configureTrustCtx.target.currentConfig}
				repositoryHint={configureTrustCtx.target.repository ?? ''}
				disabled={confirming}
				bind:valid
				bind:dirty
				bind:stagedConfig
				{deferSubmit}
			/>
		{/if}
	{/if}

	{#if recursiveCtx}
		<RecursiveTargetList targets={recursiveCtx.targets} summaries={event.tarballSummaries ?? []} pending={isPending} />
	{/if}

	{#if !isPending && event.result && status !== 'rejected' && status !== 'canceled'}
		{@const isError = isExpired || status === 'failed'}
		{@const isSuccess = status === 'success'}
		{@const firstLine = (event.result.split(/\r?\n/)[0] ?? '').trim()}
		{@const accentClass = isError ? 'text-destructive' : isSuccess ? 'text-success' : 'text-muted-foreground'}
		{@const borderClass = isError ? 'border-destructive/40' : isSuccess ? 'border-success/30' : 'border-border'}
		<div class="rounded-md border {borderClass}">
			<button
				type="button"
				class="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-muted/40 {accentClass}"
				onclick={() => (logExpanded = !logExpanded)}
				aria-expanded={logExpanded}
			>
				<IconChevronRight class="h-3 w-3 shrink-0 transition-transform {logExpanded ? 'rotate-90' : ''}" />
				{#if isError}
					<IconAlertTriangle class="h-3 w-3 shrink-0 text-destructive" />
				{:else if isSuccess}
					<IconBadgeInfo class="h-3 w-3 shrink-0 text-success" />
				{:else}
					<IconAlertTriangle class="h-3 w-3 shrink-0 text-muted-foreground" />
				{/if}
				<span class="shrink-0 font-medium">{isError ? $_('eventCard.errorLog') : $_('eventCard.log')}:</span>
				{#if !logExpanded}
					<span class="truncate font-mono">{firstLine}</span>
				{/if}
			</button>
			{#if logExpanded}
				<div class="max-h-48 overflow-auto border-t {borderClass} px-3 py-2 font-mono text-[11px] whitespace-pre-wrap break-words {accentClass}">
					{event.result}
				</div>
			{/if}
		</div>
	{/if}

	{#if tarballSummary || tarballLoading}
		<div class="rounded-md border border-border">
			{#if tarballSummary}
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
			{:else}
				<!-- Loading placeholder: the daemon is prefetching the file list
				     (npm pack --dry-run). Show the accordion immediately with a
				     spinner so the section doesn't pop in later. -->
				<div class="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground">
					<IconLoader class="h-3 w-3 animate-spin" />
					<IconFolder class="h-3 w-3" />
					<span>{$_('eventCard.tarballContents')}</span>
					<span class="ml-auto text-muted-foreground/50">{$_('eventCard.tarballLoading')}</span>
				</div>
			{/if}
		</div>
	{/if}

	{#if isPending && hasAdvancedOptions}
		<!-- Advanced publish options — edit args before confirmation. -->
		<div class="rounded-md border border-border">
			<button
				type="button"
				class="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
				onclick={() => (advancedOpen = !advancedOpen)}
				aria-expanded={advancedOpen}
				title={advancedOpen ? $_('eventCard.advancedCollapse') : $_('eventCard.advancedExpand')}
			>
				<IconChevronRight class="h-3 w-3 transition-transform {advancedOpen ? 'rotate-90' : ''}" />
				{$_('eventCard.advanced')}
			</button>
			{#if advancedOpen}
				<div class="space-y-3 border-t border-border px-3 py-2.5">
					<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
						<!-- Access -->
						<div class="space-y-1">
							<Label class="text-[11px] text-muted-foreground">{$_('eventCard.access')}</Label>
							{#if isScopedPkg || showPublicOnlyAccess}
								<ToggleGroup.Root
									type="single"
									value={accessArg}
									onValueChange={(v) => v && onRebuildArgs({ access: v as 'public' | 'restricted' })}
									variant="brand"
									size="sm"
								>
									<ToggleGroup.Item value="public" class="px-2 text-[11px]">{$_('eventCard.accessPublic')}</ToggleGroup.Item>
									<ToggleGroup.Item value="restricted" disabled={showPublicOnlyAccess} class="px-2 text-[11px]">{$_('eventCard.accessRestricted')}</ToggleGroup.Item>
								</ToggleGroup.Root>
								{#if showPublicOnlyAccess}
									<p class="text-[10px] text-muted-foreground/70">{$_('eventCard.accessNonScopedHint')}</p>
								{/if}
							{:else}
								<p class="text-[11px] text-muted-foreground/70">{$_('eventCard.accessNonScopedHint')}</p>
							{/if}
						</div>
						<!-- Tag -->
						<div class="space-y-1">
							<Label for="tag-{event.id}" class="text-[11px] text-muted-foreground">{$_('eventCard.tag')}</Label>
							<Input
								id="tag-{event.id}"
								value={tagArg}
								placeholder={$_('eventCard.tagPlaceholder')}
								class="h-7 text-[11px]"
								oninput={(e) => onRebuildArgs({ tag: (e.currentTarget as HTMLInputElement).value })}
							/>
						</div>
						{#if hasSourcePublishOptions}
						<!-- ignore-scripts -->
						<div class="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5">
							<div class="min-w-0">
								<Label class="text-[11px]">{$_('eventCard.ignoreScripts')}</Label>
								<p class="text-[10px] text-muted-foreground/60">{$_('eventCard.ignoreScriptsHint')}</p>
							</div>
							<Switch checked={ignoreScriptsOn} onCheckedChange={(v: boolean) => onRebuildArgs({ ignoreScripts: v })} />
						</div>
						<!-- no-git-checks -->
						<div class="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5">
							<div class="min-w-0">
								<Label class="text-[11px]">{$_('eventCard.noGitChecks')}</Label>
								<p class="text-[10px] text-muted-foreground/60">{$_('eventCard.noGitChecksHint')}</p>
							</div>
							<Switch checked={noGitChecksOn} disabled={publishBranchOn} onCheckedChange={(v: boolean) => onRebuildArgs({ noGitChecks: v })} />
						</div>
						{/if}
					</div>
					{#if hasSourcePublishOptions}
					<!-- publish-branch (full width) -->
					<div class="rounded-md border border-border px-2.5 py-2">
						<div class="flex items-center justify-between gap-2">
							<div class="min-w-0">
								<Label class="text-[11px]">{$_('eventCard.publishBranch')}</Label>
								<p class="text-[10px] text-muted-foreground/60">{$_('eventCard.publishBranchHint')}</p>
							</div>
							<Switch
								checked={publishBranchOn}
								onCheckedChange={(v: boolean) => onRebuildArgs({ publishBranchOn: v, publishBranch: v ? (publishBranchValue || currentBranch) : '' })}
							/>
						</div>
						{#if publishBranchOn}
							<div class="mt-2 space-y-1.5">
								<div class="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
									<IconGitBranch class="h-3 w-3" />
									{$_('eventCard.currentBranch')}:
									<Badge variant="outline" class="font-mono text-[10px]">{currentBranch || $_('eventCard.branchUnknown')}</Badge>
								</div>
								<Input
									value={publishBranchValue}
									placeholder={currentBranch || 'main'}
									class="h-7 font-mono text-[11px]"
									oninput={(e) => onRebuildArgs({ publishBranch: (e.currentTarget as HTMLInputElement).value })}
								/>
								{#if branchMismatch}
									<p class="flex items-center gap-1 text-[10px] text-destructive">
										<IconAlertTriangle class="h-3 w-3" />
										{$_('eventCard.branchMismatch', { values: { branch: currentBranch || '?' } })}
									</p>
								{:else if branchNoCurrent}
									<p class="flex items-center gap-1 text-[10px] text-muted-foreground/60">
										<IconAlertTriangle class="h-3 w-3" />
										{$_('eventCard.branchNoCurrent')}
									</p>
								{/if}
							</div>
						{/if}
					</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
