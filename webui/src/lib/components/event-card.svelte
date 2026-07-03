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
	import { ButtonGroup, ButtonGroupSeparator } from '$lib/components/ui/button-group/index.js';
	import { Card, CardContent, CardHeader } from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/components/ui/tooltip/index.js';
	import RepoIcon from '$lib/components/repo-icon.svelte';
	import ConfirmAction from '$lib/components/confirm-action.svelte';
	import type { RepoInfo } from '$lib/components/repo-info-types.js';
	import { actions, daemon } from '$lib/store.js';
	import TarballTree from '$lib/components/tarball-tree.svelte';
	import RecursiveTargetList from '$lib/components/recursive-target-list.svelte';
	import AutoCloseBar from '$lib/components/auto-close-bar.svelte';
	import IconPublish from '@lucide/svelte/icons/upload';
	import IconOidc from '@lucide/svelte/icons/shield-check';
	import IconLayers from '@lucide/svelte/icons/layers';
	import IconPlaceholder from '@lucide/svelte/icons/package';
	import IconRefresh from '@lucide/svelte/icons/refresh-cw';
	import IconClock from '@lucide/svelte/icons/clock';
	import IconCheck from '@lucide/svelte/icons/check';
	import IconBadgeInfo from '@lucide/svelte/icons/badge-info';
	import IconX from '@lucide/svelte/icons/x';
	import IconRotateCw from '@lucide/svelte/icons/rotate-cw';
	import IconTrash from '@lucide/svelte/icons/trash-2';
	import IconChevronRight from '@lucide/svelte/icons/chevron-right';
	import IconFolder from '@lucide/svelte/icons/folder';
	import IconFile from '@lucide/svelte/icons/file';
	import IconLoader from '@lucide/svelte/icons/loader-circle';
	import IconGitBranch from '@lucide/svelte/icons/git-branch';
	import IconAlertTriangle from '@lucide/svelte/icons/triangle-alert';
	import IconFolderOpen from '@lucide/svelte/icons/folder-open';
	import { _ } from 'svelte-i18n';

	let {
		event,
		/** Log display mode: 'full' (wrapped, scrollable both axes) or 'compact'
		 *  (single-line truncated; click toggles a horizontally-scrollable block). */
		variant = 'full',
		/**
		 * When true (only meaningful with variant='full'), a freshly-resolved card
		 * shows an AutoCloseBar countdown at the inline-end of the card footer.
		 * `onAutoClose` is invoked when the countdown elapses or the user closes.
		 */
		autoClose = false,
		onAutoClose,
	}: {
		event: PubEvent;
		variant?: 'full' | 'compact';
		autoClose?: boolean;
		onAutoClose?: () => void;
	} = $props();

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
			'recursive-publish': IconLayers,
			'create-placeholder': IconPlaceholder,
			'refresh-token': IconRefresh,
			unpublish: IconTrash,
			import: IconRefresh,
			export: IconRefresh,
		})[kind] ?? IconPublish;

	// Action-type accent color — drives ONLY the top-left icon tint, derived
	// from the event KIND. publish → brand (blue), unpublish → destructive
	// (red), everything else → neutral. The card border uses the STATUS color
	// (see below), so the two signals stay independent.
	const kindAccent = $derived.by(() => {
		switch (event.kind) {
			case 'publish':
			case 'recursive-publish': return 'brand';
			case 'unpublish': return 'destructive';
			default: return '';
		}
	});
	const kindIconClass = $derived(
		kindAccent === 'brand' ? 'bg-brand/10 text-brand'
			: kindAccent === 'destructive' ? 'bg-destructive/10 text-destructive'
				: 'bg-accent text-muted-foreground',
	);
	// Card border / ring tint — driven by the event STATUS (not the kind).
	// pending → brand, success → green, failed → red, rejected → muted,
	// expired/action-required → warning. Static class strings (Tailwind can't
	// compose dynamic fragments).
	const statusRing = $derived.by(() => {
		switch (event.status) {
			case 'pending': return 'ring-brand/40';
			case 'success': return 'ring-success/40';
			case 'failed': return 'ring-destructive/40';
			case 'expired':
			case 'action-required': return 'ring-warning/40';
			default: return 'ring-border'; // rejected
		}
	});
	const statusBorder = $derived.by(() => {
		switch (event.status) {
			case 'pending': return 'border-brand/30';
			case 'success': return 'border-success/30';
			case 'failed': return 'border-destructive/30';
			case 'expired':
			case 'action-required': return 'border-warning/30';
			default: return 'border-border'; // rejected
		}
	});

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
	const unpublishCtx = $derived(event.payload?.kind === 'unpublish' ? event.payload.data : null);
	const recursiveCtx = $derived(event.payload?.kind === 'recursive-publish' ? event.payload.data : null);

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

	// --- Right-corner actions (repo link / open folder / npm link) ---
	// Every card renders a unified ButtonGroup; which actions appear depends on
	// the event kind and the data it carries.
	let repoInfo = $state<RepoInfo | null>(null);
	// The raw repository string to resolve, drawn from whichever event kind
	// carries one (publish.target.repository, setup-oidc's repo field, or any
	// recursive-publish target's repository).
	const repoRaw = $derived(
		publishData?.target.repository
			?? oidcCtx?.repo
			?? recursiveCtx?.targets.find((t) => t.repository)?.repository
			?? '',
	);
	$effect(() => {
		if (!repoRaw) { repoInfo = null; return; }
		// Fire-and-forget; the store memoizes so re-renders are cheap.
		void actions.repoInfo(repoRaw).then((info) => { repoInfo = info; });
	});
	// The local package directory (for "open folder"). Publish → source path;
	// setup-oidc → its path; recursive-publish → workspace root. Unpublish /
	// placeholder have no local path.
	const sourcePath = $derived(publishData?.source.path ?? recursiveCtx?.source.path ?? oidcCtx?.path ?? '');
	// The npm registry page link. For publish, derived from target name/version.
	// For unpublish, from its name/version. For create-placeholder, name only.
	const packageName = $derived(
		unpublishCtx?.name
			?? publishTarget?.target.name
			?? (event.payload?.kind === 'create-placeholder' ? event.payload.data.name : ''),
	);
	const packageVersion = $derived(
		unpublishCtx?.version ?? publishTarget?.target.version ?? '',
	);
	const npmUrl = $derived.by(() => {
		if (!packageName) return '';
		// Only link to the specific published version once the publish actually
		// succeeded; while pending (or failed/expired/rejected) that version
		// isn't on the registry yet, and placeholder/unpublish events never have
		// a real published version — so link to the package landing page instead.
		if (packageVersion && isPublish && event.status === 'success') {
			return `https://www.npmjs.com/package/${packageName}/v/${packageVersion}`;
		}
		return `https://www.npmjs.com/package/${packageName}`;
	});
	// Whether the right-corner group has any action to show at all.
	const hasCornerActions = $derived(!!repoInfo || !!sourcePath || !!npmUrl || overrideActive);
	const isRetryableStatus = $derived(event.status === 'failed' || event.status === 'expired' || event.status === 'rejected');
	const isRetryable = $derived((isPublish || event.payload?.kind === 'unpublish' || event.payload?.kind === 'recursive-publish') && isRetryableStatus);
	/** Whether the inline Retry button renders (publish + recursive-publish;
	 *  unpublish retry goes through the ConfirmAction two-step instead). */
	const hasRetryButton = $derived(isRetryableStatus && (isPublish || event.payload?.kind === 'recursive-publish'));
	const isUnpublishable = $derived(isPublish && event.status === 'success');
	let confirmUnpublish = $state(false);
	// Confirm/Reject are fire-and-forget WS sends — the daemon drives the actual
	// status transition. These flags give immediate "working…" feedback and are
	// cleared the moment the event leaves `pending` (i.e. the daemon replied).
	let confirming = $state(false);
	let rejecting = $state(false);
	$effect(() => {
		// Re-run whenever status changes; clear once it's no longer pending.
		if (event.status !== 'pending') {
			confirming = false;
			rejecting = false;
		}
	});

	function doConfirm(): void {
		if (!canConfirm || confirming) return;
		confirming = true;
		actions.confirm(event.id);
	}
	function doReject(): void {
		if (rejecting) return;
		rejecting = true;
		actions.reject(event.id);
	}

	function retry(): void {
		// Re-create the event with the SAME payload + SAME groupId so it folds
		// into the same group in the Events Hub.
		if (publishData) {
			actions.createEvent('publish', publishData, event.groupId);
		} else if (recursiveCtx) {
			actions.createEvent('recursive-publish', recursiveCtx, event.groupId);
		} else if (unpublishCtx) {
			actions.createEvent('unpublish', unpublishCtx, event.groupId);
		}
	}

	/** Create a pending unpublish event for this package@version. The user then
	 *  confirms/rejects on the new EventCard, exactly like publish. */
	function doUnpublish(): void {
		if (!publishData) return;
		actions.createEvent('unpublish', {
			name: publishData.target.name,
			version: publishData.target.version,
		}, event.groupId);
		confirmUnpublish = false;
	}

	/** Human-readable byte size. */
	function humanSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
	}

	// --- Advanced publish options (only for pending publish events) ---
	// The publish `args` are the single source of truth (the daemon re-reads them
	// live at confirm time). We parse them into structured accessors for display,
	// and every control mutation rebuilds the args and ships an `update-event`.
	let advancedOpen = $state(false);

	/** The editable payload's args/branch, read from whichever publish-like
	 *  payload is active (single-package `publish` or `recursive-publish`). All
	 *  advanced-option deriveds below read from this single source so the panel
	 *  works identically for both kinds. */
	const editableArgs = $derived(publishData?.args ?? recursiveCtx?.args ?? []);
	const currentBranch = $derived(publishData?.branch ?? recursiveCtx?.branch ?? '');

	/** Find `--flag <value>` (or `--flag=value`) in args; returns undefined if absent. */
	function argValue(args: string[], flag: string): string | undefined {
		for (let i = 0; i < args.length; i++) {
			const a = args[i]!;
			if (a === flag) { const next = args[i + 1]; if (next && !next.startsWith('-')) return next; }
			if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
		}
		return undefined;
	}
	const accessArg = $derived(argValue(editableArgs, '--access') === 'restricted' ? 'restricted' : 'public');
	const tagArg = $derived(argValue(editableArgs, '--tag') ?? '');
	/** A boolean flag is "on" when present as `--flag` and "off" only when an
	 *  explicit `--no-flag` is present. Absent ⇒ default (per-option). */
	function hasFlag(args: string[], flag: string): boolean { return args.includes(flag); }

	// Whether `--access` is meaningful: single-package ⇒ scoped check; recursive
	// ⇒ any scoped target (pnpm publish -r applies one --access to the run, and
	// non-scoped targets ignore it at the registry, so "any scoped" is the
	// pragmatic gate).
	const isScopedPkg = $derived.by(() => {
		if (publishData) return publishData.target.name.startsWith('@');
		if (recursiveCtx) return recursiveCtx.targets.some((t) => t.name.startsWith('@'));
		return false;
	});
	const ignoreScriptsOn = $derived(hasFlag(editableArgs, '--ignore-scripts'));
	// No-git-checks defaults ON: if the args carry no explicit --git-checks,
	// we treat it as opted-out (the common case for feature-branch publishes).
	const noGitChecksOn = $derived(hasFlag(editableArgs, '--git-checks') ? false : true);
	const publishBranchOn = $derived(argValue(editableArgs, '--publish-branch') !== undefined);
	const publishBranchValue = $derived(argValue(editableArgs, '--publish-branch') ?? '');

	// publish-branch mismatch gate: blocks the Confirm button client-side.
	const branchMismatch = $derived(publishBranchOn && !!currentBranch && publishBranchValue !== currentBranch);
	const branchNoCurrent = $derived(publishBranchOn && !currentBranch);
	const canConfirm = $derived(isPending && !branchMismatch);

	/** Whether the advanced-options panel should render at all. */
	const hasAdvancedOptions = $derived(isPublish || !!recursiveCtx);

	/** Rebuild args from the current structured state + a partial override, then
	 *  ship an update-event. Works for both `publish` and `recursive-publish`
	 *  (both carry an editable `args` array). */
	function rebuildArgs(overrides?: {
		access?: 'public' | 'restricted';
		tag?: string;
		ignoreScripts?: boolean;
		noGitChecks?: boolean;
		publishBranchOn?: boolean;
		publishBranch?: string;
	}): void {
		if (!publishData && !recursiveCtx) return;
		const access = overrides?.access ?? accessArg;
		const tag = overrides?.tag !== undefined ? overrides.tag : tagArg;
		const ignoreScripts = overrides?.ignoreScripts ?? ignoreScriptsOn;
		const branchOn = overrides?.publishBranchOn ?? publishBranchOn;
		const branchVal = overrides?.publishBranch !== undefined ? overrides.publishBranch : publishBranchValue;
		const noGitChecks = overrides?.noGitChecks ?? (branchOn ? false : noGitChecksOn);

		const args: string[] = ['--access', access];
		if (tag && tag !== 'latest') args.push('--tag', tag);
		if (ignoreScripts) args.push('--ignore-scripts');
		// Git checks default ON at the daemon; we emit --no-git-checks to opt out.
		// Enabling publish-branch turns git checks back ON (drops --no-git-checks)
		// and narrows the allowed branch via --publish-branch.
		if (!branchOn && noGitChecks) args.push('--no-git-checks');
		if (branchOn && branchVal) args.push('--publish-branch', branchVal);
		// recursive-publish forwards the -r flag so the rebuilt args stay valid.
		if (recursiveCtx && !args.includes('-r') && !args.includes('--recursive')) args.unshift('-r');
		actions.updateEvent(event.id, args);
	}
</script>

<Card class="transition-shadow {isPending ? `ring-2 ${statusRing} shadow-md` : statusBorder}">
	<CardHeader class="flex-row items-center justify-between gap-3 pb-3">
		<div class="flex min-w-0 items-center gap-2.5">
			<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md {kindIconClass}">
				<IconCmp class="h-4 w-4" />
			</div>
			<div class="min-w-0">
				<div class="flex items-center gap-2">
					<span class="truncate text-sm font-semibold">
						{#if recursiveCtx}
							{$_('eventCard.recursivePublish')}
						{:else if publishTarget}{publishTarget.target.name}{:else if oidcCtx}{oidcCtx.name}{:else if unpublishCtx}{unpublishCtx.name}{:else}{event.kind}{/if}
					</span>
					{#if publishTarget}
						<Badge variant="outline" class="h-5 font-mono text-[10px]">@{publishTarget.target.version}</Badge>
					{:else if unpublishCtx}
						<Badge variant="outline" class="h-5 font-mono text-[10px]">@{unpublishCtx.version}</Badge>
					{/if}
					{#if event.status === 'rejected' && event.result}
						<Tooltip>
							<TooltipTrigger>
								{#snippet child({ props })}
									<Badge {...props} variant={statusVariant} class="h-5 capitalize cursor-help">
										{statusLabel}
									</Badge>
								{/snippet}
							</TooltipTrigger>
							<TooltipContent class="max-w-sm text-[11px]">{event.result}</TooltipContent>
						</Tooltip>
					{:else}
						<Badge variant={statusVariant} class="h-5 capitalize">
							{#if isPending}<IconClock class="mr-1 h-3 w-3" />{/if}
							{statusLabel}
						</Badge>
					{/if}
				</div>
				<div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
					<IconClock class="h-3 w-3" /> {timeLabel}
					{#if event.clockDriftRecovered}
						<span class="ml-1 text-warning">· {$_('eventCard.driftRecovered')}</span>
					{/if}
				</div>
			</div>
		</div>

		<!-- Right-corner actions — a unified ButtonGroup on every card. Which
		     actions appear depends on the event kind + the data it carries:
		     a repo link (publish / setup-oidc), an open-folder button (publish /
		     setup-oidc), or an npm page link (unpublish / placeholder). A
		     context-override identity chip leads the group when relevant. -->
		{#if hasCornerActions}
		<ButtonGroup>
			{#if overrideActive}
				<!-- Cross-profile event: show whose identity it runs under. -->
				<div data-slot="button" class="inline-flex h-7 items-center gap-1.5 border border-warning/60 bg-warning/10 px-2 text-[11px] font-medium text-foreground">
					<Avatar class="h-4 w-4">
						{#if effectiveProfileRecord?.avatarUrl}
							<AvatarImage src={effectiveProfileRecord.avatarUrl} alt={effectiveProfileRecord.username} />
						{/if}
						<AvatarFallback class="text-[8px]">{initials(effectiveProfile)}</AvatarFallback>
					</Avatar>
					<span class="max-w-[6rem] truncate">{effectiveProfile}</span>
				</div>
			{/if}
			{#if repoInfo}
				<Tooltip>
					<TooltipTrigger>
						{#snippet child({ props })}
							<Button {...props} variant="outline" size="sm" onclick={() => actions.openUrl(repoInfo!.browseUrl)} class="gap-1 px-2 text-[11px]">
								<RepoIcon brand={repoInfo!.brand} faviconUrl={repoInfo!.faviconUrl} class="h-3.5 w-3.5" />
								<span class="max-w-[10rem] truncate">{repoInfo!.slug}</span>
							</Button>
						{/snippet}
					</TooltipTrigger>
					<TooltipContent class="max-w-sm break-all font-mono text-[10px]">{repoInfo.browseUrl}</TooltipContent>
				</Tooltip>
			{/if}
			{#if sourcePath}
				<Tooltip>
					<TooltipTrigger>
						{#snippet child({ props })}
							<Button {...props} variant="outline" size="icon-sm" onclick={() => actions.openPath(sourcePath)} aria-label={$_('eventCard.openFolder')}>
								<IconFolderOpen class="h-3.5 w-3.5" />
							</Button>
						{/snippet}
					</TooltipTrigger>
					<TooltipContent class="max-w-xs break-all font-mono text-[10px]">{sourcePath}</TooltipContent>
				</Tooltip>
			{/if}
			{#if npmUrl}
				<Tooltip>
					<TooltipTrigger>
						{#snippet child({ props })}
							<Button {...props} variant="outline" size="icon-sm" onclick={() => actions.openUrl(npmUrl)} aria-label={$_('eventCard.openOnNpm')}>
								<IconPlaceholder class="h-3.5 w-3.5" />
							</Button>
						{/snippet}
					</TooltipTrigger>
				<TooltipContent class="max-w-sm break-all font-mono text-[10px]">{npmUrl}</TooltipContent>
			</Tooltip>
		{/if}
		</ButtonGroup>
		{/if}
	</CardHeader>

	<CardContent class="space-y-3">
		{#if overrideActive}
			<div class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
				{$_('eventCard.override', { values: { profile: event.profileOverride } })}
			</div>
		{/if}

			{#if publishTarget}
				{#if publishTarget.target.description}
					<p class="text-xs text-muted-foreground">{publishTarget.target.description}</p>
				{/if}
		{:else if oidcCtx}
			<div class="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
				{$_('eventCard.configureOidc', { values: { name: oidcCtx.name } })} <span class="font-mono">{oidcCtx.name}</span>
				{#if oidcCtx.repo}· repo <span class="font-mono">{oidcCtx.repo}</span>{/if}
			</div>
		{/if}

		{#if recursiveCtx}
			<RecursiveTargetList targets={recursiveCtx.targets} pending={isPending} />
		{/if}

		{#if !isPending && event.result && event.status !== 'rejected'}
			{@const isError = isExpired || event.status === 'failed'}
			{@const isSuccess = event.status === 'success'}
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

		{#if isPending}
			{#if hasAdvancedOptions}
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
									{#if isScopedPkg}
										<ButtonGroup>
											<Button variant={accessArg === 'public' ? 'brand' : 'outline'} size="sm" class="px-2 text-[11px]" onclick={() => rebuildArgs({ access: 'public' })}>
												{$_('eventCard.accessPublic')}
											</Button>
											<Button variant={accessArg === 'restricted' ? 'brand' : 'outline'} size="sm" class="px-2 text-[11px]" onclick={() => rebuildArgs({ access: 'restricted' })}>
												{$_('eventCard.accessRestricted')}
											</Button>
										</ButtonGroup>
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
										oninput={(e) => rebuildArgs({ tag: (e.currentTarget as HTMLInputElement).value })}
									/>
								</div>
								<!-- ignore-scripts -->
								<div class="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5">
									<div class="min-w-0">
										<Label class="text-[11px]">{$_('eventCard.ignoreScripts')}</Label>
										<p class="text-[10px] text-muted-foreground/60">{$_('eventCard.ignoreScriptsHint')}</p>
									</div>
									<Switch checked={ignoreScriptsOn} onCheckedChange={(v: boolean) => rebuildArgs({ ignoreScripts: v })} />
								</div>
								<!-- no-git-checks -->
								<div class="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5">
									<div class="min-w-0">
										<Label class="text-[11px]">{$_('eventCard.noGitChecks')}</Label>
										<p class="text-[10px] text-muted-foreground/60">{$_('eventCard.noGitChecksHint')}</p>
									</div>
									<Switch checked={noGitChecksOn} disabled={publishBranchOn} onCheckedChange={(v: boolean) => rebuildArgs({ noGitChecks: v })} />
								</div>
							</div>
							<!-- publish-branch (full width) -->
							<div class="rounded-md border border-border px-2.5 py-2">
								<div class="flex items-center justify-between gap-2">
									<div class="min-w-0">
										<Label class="text-[11px]">{$_('eventCard.publishBranch')}</Label>
										<p class="text-[10px] text-muted-foreground/60">{$_('eventCard.publishBranchHint')}</p>
									</div>
									<Switch
										checked={publishBranchOn}
										onCheckedChange={(v: boolean) => rebuildArgs({ publishBranchOn: v, publishBranch: v ? (publishBranchValue || currentBranch) : '' })}
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
											oninput={(e) => rebuildArgs({ publishBranch: (e.currentTarget as HTMLInputElement).value })}
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
						</div>
					{/if}
				</div>
			{/if}
			<div class="pt-1">
				<ButtonGroup>
					<Button variant={event.kind === 'unpublish' ? 'destructive' : 'brand'} size="sm" class="flex-1" disabled={!canConfirm || confirming} onclick={doConfirm}>
						{#if confirming}<IconLoader class="h-3.5 w-3.5 animate-spin" />{:else}<IconCheck class="h-3.5 w-3.5" />{/if}
						{#if confirming}
							{$_('eventCard.confirming')}
						{:else if event.kind === 'setup-oidc'}
							{$_('eventCard.confirmSetupOidc')}
						{:else if event.kind === 'recursive-publish'}
							{$_('eventCard.confirmRecursivePublish')}
						{:else if event.kind === 'refresh-token'}
							{$_('eventCard.confirmTokenRefresh')}
						{:else if event.kind === 'unpublish'}
							{$_('eventCard.confirmUnpublish')}
						{:else}
							{$_('eventCard.confirmPublish')}
						{/if}
					</Button>
					<Button variant="outline" size="sm" disabled={rejecting} onclick={doReject}>
						{#if rejecting}<IconLoader class="h-3.5 w-3.5 animate-spin" />{:else}<IconX class="h-3.5 w-3.5" />{/if}
						{$_('eventCard.reject')}
					</Button>
				</ButtonGroup>
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
				{@const warn = $_('eventCard.unpublishConfirm', {
					values: {
						name: unpublishCtx?.name ?? publishData?.target.name ?? '',
						version: unpublishCtx?.version ?? publishData?.target.version ?? '',
					},
				})}
				<ConfirmAction
					bind:open={confirmUnpublish}
					{warn}
					confirmLabel={$_('eventCard.unpublish')}
					onConfirm={event.payload?.kind === 'unpublish' ? retry : doUnpublish}
				/>
			{:else}
				<!-- Action + auto-close share one ButtonGroup. Retry-for-publish is a
				     direct brand button; unpublish (from publish-success) and
				     retry-for-unpublish use ConfirmAction (two-step confirmation). -->
				<div class="pt-1">
					<ButtonGroup>
						{#if hasRetryButton}
							<Button variant="outline" size="sm" class="flex-1" onclick={retry}>
								<IconRotateCw class="h-3.5 w-3.5" /> {$_('eventCard.retry')}
							</Button>
						{/if}
						{#if isUnpublishable}
							<ConfirmAction bind:open={confirmUnpublish} warn={$_('eventCard.unpublishConfirm', { values: { name: publishData?.target.name ?? '', version: publishData?.target.version ?? '' } })} confirmLabel={$_('eventCard.unpublish')} flex={!isRetryableStatus} onConfirm={doUnpublish}>
								{#snippet triggerIcon()}<IconTrash class="h-3.5 w-3.5" />{/snippet}
								{#snippet triggerLabel()}{$_('eventCard.unpublish')}{/snippet}
							</ConfirmAction>
						{/if}
						{#if event.payload?.kind === 'unpublish' && isRetryableStatus}
							<ConfirmAction bind:open={confirmUnpublish} warn={$_('eventCard.unpublishConfirm', { values: { name: unpublishCtx?.name ?? '', version: unpublishCtx?.version ?? '' } })} confirmLabel={$_('eventCard.retry')} flex onConfirm={retry}>
								{#snippet triggerIcon()}<IconRotateCw class="h-3.5 w-3.5" />{/snippet}
								{#snippet triggerLabel()}{$_('eventCard.retry')}{/snippet}
							</ConfirmAction>
						{/if}
						{#if autoClose && variant === 'full'}
							<ButtonGroupSeparator />
							<AutoCloseBar seconds={10} onclose={onAutoClose} />
						{/if}
					</ButtonGroup>
				</div>
			{/if}
		{:else if !isPending && autoClose && variant === 'full'}
			<!-- Resolved with no action buttons but still auto-closable. -->
			<div class="pt-1">
				<ButtonGroup>
					<AutoCloseBar seconds={10} onclose={onAutoClose} />
				</ButtonGroup>
			</div>
		{/if}
	</CardContent>
</Card>
