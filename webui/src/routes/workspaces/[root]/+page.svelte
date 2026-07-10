<script lang="ts">
	/**
	 * Workspace Detail — package list for a scanned root.
	 *
	 * Route: /workspaces/<base64(absolute-path)>
	 * On mount: decode the root path, trigger a re-scan, read $daemon.packages.
	 *
	 * Features:
	 *   - Filter: plain text = includes(); /pattern/ = RegExp
	 *   - Trusted Publishing status: always-visible line per package (loading shimmer / configured / not configured)
	 *   - Batch mode: toggle on → cards become selectable → batch Trusted Publishing dialog
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { flipParams, enterParams, leaveParams } from '$lib/transitions.js';
	import { daemon, actions } from '$lib/store.js';
	import { createTrustedPublishingStatus } from '$lib/hooks/use-trusted-publishing.svelte.js';
	import { trustedPublisherSummary } from '$lib/trusted-publishing.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ButtonGroup } from '$lib/components/ui/button-group/index.js';
	import { Toggle } from '$lib/components/ui/toggle/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import TrustedPublishingDialog from '$lib/components/trusted-publishing-dialog.svelte';
	import IconArrowLeft from '@lucide/svelte/icons/arrow-left';
	import IconScan from '@lucide/svelte/icons/scan-search';
	import IconShield from '@lucide/svelte/icons/shield-check';
	import IconShieldCog from '@lucide/svelte/icons/shield-cog-corner';
	import IconCheckSquare from '@lucide/svelte/icons/check-square';
	import IconSquare from '@lucide/svelte/icons/square';
	import IconLayers from '@lucide/svelte/icons/layers';
	import IconPublish from '@lucide/svelte/icons/upload';
	import IconChevronDown from '@lucide/svelte/icons/chevron-down';
	import IconListChecks from '@lucide/svelte/icons/list-checks';
	import IconInvert from '@lucide/svelte/icons/flip-horizontal';
	import IconLayoutList from '@lucide/svelte/icons/layout-list';
	import { _ } from 'svelte-i18n';
	import type { PublishTarget, TrustedPublishingTarget } from '$lib/types.js';

	// Decode the root path from the URL
	const rootParam = $derived(page.params.root ?? '');
	const decodedRoot = $derived.by(() => { try { return atob(rootParam); } catch { return ''; } });

	// Scan on mount / when root changes
	$effect(() => {
		const root = decodedRoot;
		if (root) actions.scanWorkspace(root);
	});

	const scanned = $derived($daemon.packages);
	const scannedRoot = $derived($daemon.scannedRoot);

	// --- Filter ---
	let filterText = $state('');
	const filteredPackages = $derived.by(() => {
		const f = filterText.trim();
		if (!f) return scanned;
		// Case-insensitive by default. /pattern/ → RegExp (also case-insensitive
		// unless the user writes (?-i) inside the pattern).
		if (f.startsWith('/') && f.endsWith('/') && f.length > 2) {
			try {
				const re = new RegExp(f.slice(1, -1), 'i');
				return scanned.filter((p) => re.test(p.name));
			} catch {
				return scanned;
			}
		}
		const lower = f.toLowerCase();
		return scanned.filter((p) => p.name.toLowerCase().includes(lower));
	});

	// --- Relative path display ---
	function relPath(pkgPath: string): string {
		if (scannedRoot && pkgPath.startsWith(scannedRoot)) {
			const rel = pkgPath.slice(scannedRoot.length).replace(/^[\\/]/, '');
			return rel || '.';
		}
		return pkgPath;
	}

	// --- Trusted Publishing status ---
	// Shared 30s-TTL + in-flight dedup cache (same discipline as the Packages
	// pages). The workspaces page only adds display helpers on top.
	const trustedPublishing = createTrustedPublishingStatus();

	function trustedPublishingStatusText(name: string): string {
		if (trustedPublishing.isLoading(name)) return $_('trustedPublishing.loading');
		const cfg = trustedPublishing.configs(name)[0];
		if (cfg) return trustedPublisherSummary(cfg);
		return $_('trustedPublishing.notConfigured');
	}

	// Auto-prefetch Trusted Publishing when package list changes
	$effect(() => {
		void scanned;
		for (const pkg of scanned) trustedPublishing.fetch(pkg.name);
	});

	// --- Trusted Publishing dialog (single-package mode) ---
	let trustedPublishingDialogOpen = $state(false);
	let trustedPublishingDialogPkg = $state('');
	let trustedPublishingDialogPath = $state('');
	let trustedPublishingDialogRepoHint = $state('');
	let trustedPublishingDialogInitialTab = $state<'current' | 'workflow'>('current');

	function openTrustedPublishingDialog(pkg: PublishTarget, initialTab: 'current' | 'workflow' = 'current'): void {
		trustedPublishingDialogPkg = pkg.name;
		trustedPublishingDialogPath = pkg.path;
		trustedPublishingDialogRepoHint = pkg.repository ?? '';
		trustedPublishingDialogInitialTab = initialTab;
		trustedPublishingDialogOpen = true;
	}
	function onTrustedPublishingChanged(): void {
		trustedPublishing.invalidate(trustedPublishingDialogPkg);
	}

	// --- Batch mode ---
	let batchMode = $state(false);
	let selected = $state<Set<string>>(new Set());

	function toggleBatchMode(): void {
		batchMode = !batchMode;
		if (!batchMode) selected = new Set();
	}
	function toggleSelect(name: string): void {
		const next = new Set(selected);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		selected = next;
	}
	function selectAll(): void {
		// Selection operates on the FULL scanned set, independent of the current
		// filter (filter is display-only; selection must be orthogonal to it).
		selected = new Set(scanned.map((p) => p.name));
	}
	function invertSelection(): void {
		const next = new Set<string>();
		for (const pkg of scanned) if (!selected.has(pkg.name)) next.add(pkg.name);
		selected = next;
	}
	function clearSelection(): void {
		selected = new Set();
	}
	/** Whether every scanned package is currently selected. Drives the
	 *  select-all Toggle's pressed (active) state. Independent of the filter —
	 *  selection and filtering are orthogonal. */
	const allSelected = $derived(
		scanned.length > 0 && scanned.every((p) => selected.has(p.name)),
	);
	/** Toggle between all-selected and none-selected (the select-all Toggle's
	 *  write side). Operates on the full scanned set, not the filtered view. */
	function toggleSelectAll(next: boolean): void {
		selected = next ? new Set(scanned.map((p) => p.name)) : new Set();
	}
	// The select-all Toggle's `pressed` is `$bindable`; keep a writable local
	// state synced with the derived `allSelected` (so the Toggle reflects the
	// active state when every package is selected, even if selection changed via
	// per-card clicks or invert/clear).
	let allSelectedPressed = $state(false);
	$effect(() => {
		allSelectedPressed = allSelected;
	});

	/** Whether every selected package is publishable (gates Batch Publish). */
	const batchPublishable = $derived.by(() => {
		if (selected.size === 0) return false;
		return scanned.filter((p) => selected.has(p.name)).every((p) => canPublish(p));
	});

	// --- Batch Trusted Publishing dialog ---
	let batchTrustedPublishingOpen = $state(false);
	let batchRepoHint = $state('');
	let batchTrustedPublishingTargets = $state<TrustedPublishingTarget[]>([]);

	/** If all selected packages share the same repository, use it as the hint. */
	function openBatchTrustedPublishing(): void {
		if (selected.size === 0) return;
		const selectedPkgs = scanned.filter((p) => selected.has(p.name));
		const repos = new Set(selectedPkgs.map((p) => p.repository ?? ''));
		batchRepoHint = repos.size === 1 ? [...repos][0]! : '';
		batchTrustedPublishingTargets = selectedPkgs.map((pkg) => {
			const currentConfig = trustedPublishing.configs(pkg.name)[0];
			return {
				name: pkg.name,
				path: pkg.path,
				...(pkg.repository ? { repository: pkg.repository } : {}),
				...(currentConfig ? { currentConfig } : {}),
			};
		});
		batchTrustedPublishingOpen = true;
	}

	// --- Publish ---
	function canPublish(pkg: PublishTarget): boolean {
		return pkg.publishable !== false;
	}
	/** The i18n tooltip explaining why Publish is disabled, or null if it's enabled. */
	function publishDisabledReason(pkg: PublishTarget): string | null {
		if (canPublish(pkg)) return null;
		if (pkg.unpublishableReason === 'private') return $_('workspaces.unpublishablePrivate');
		return $_('workspaces.publish');
	}
	function publishPayload(pkg: PublishTarget) {
		const access = pkgAccess[pkg.name] ?? 'public';
		// --no-git-checks defaults ON: publishing from a feature branch is the
		// common case, and the daemon's git-check preflight would otherwise block it.
		return { source: { kind: 'directory' as const, path: pkg.path }, args: ['--access', access, '--no-git-checks'], target: pkg };
	}
	/** Whether the package name is scoped (`@scope/name`) — only scoped packages
	 *  honor `--access` (non-scoped are always public). */
	function isScoped(name: string): boolean {
		return name.startsWith('@');
	}
	// Per-package publish access preference (public / restricted), default public.
	let pkgAccess = $state<Record<string, 'public' | 'restricted'>>({});
	function accessFor(name: string): 'public' | 'restricted' {
		return pkgAccess[name] ?? 'public';
	}
	function doPublish(pkg: PublishTarget): void {
		if (!canPublish(pkg)) return;
		actions.createEvent('publish', publishPayload(pkg));
		goto('/active-events');
	}
	function doRecursivePublish(): void {
		if (!decodedRoot) return;
		// The daemon enumerates the targets via `pnpm list -r` after creation, so
		// the payload carries an empty targets array that gets filled server-side.
		actions.createEvent('recursive-publish', {
			source: { kind: 'directory' as const, path: decodedRoot },
			args: ['--no-git-checks'],
			targets: [],
		});
		goto('/active-events');
	}
	/** Publish every selected package as a publish event, sharing one groupId
	 *  so they fold into a single batch in the Events Hub. */
	function doBatchPublish(): void {
		if (selected.size === 0) return;
		const groupId = crypto.randomUUID();
		for (const pkg of scanned) {
			if (!selected.has(pkg.name)) continue;
			if (!canPublish(pkg)) continue;
			actions.createEvent('publish', publishPayload(pkg), groupId);
		}
		selected = new Set();
		batchMode = false;
		goto('/active-events');
	}
	/** Configure OIDC for every package in the workspace: virtually select all
	 *  then open the same batch confirmation dialog the toolbar uses. */
	function doRecursiveOidc(): void {
		if (scanned.length === 0) return;
		selected = new Set(scanned.map((p) => p.name));
		openBatchTrustedPublishing();
	}
</script>

<svelte:head><title>{$_('workspaces.heading')} · {decodedRoot}</title></svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-4 p-6">
	<!-- Back + title -->
	<div class="flex items-center gap-3">
		<a href="/workspaces" class="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
			<IconArrowLeft class="h-3.5 w-3.5" /> {$_('workspaces.trackedRoots')}
		</a>
	</div>
		<div class="flex items-center justify-between gap-3">
			<div class="min-w-0">
			<h1 class="truncate text-lg font-semibold tracking-tight">{decodedRoot.split('/').pop() ?? decodedRoot}</h1>
			<p class="truncate font-mono text-[10px] text-muted-foreground/70">{decodedRoot}</p>
			</div>
			<!-- Batch-actions dropdown: Recursive Publish / Recursive OIDC / Select.
			     Replaces the former [Recursive Publish][Batch] pair. -->
			<div class="shrink-0">
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant={batchMode ? 'brand' : 'outline'} size="sm" title={$_('workspaces.batchMenu')}>
								<IconLayers class="h-3.5 w-3.5" />
								{$_('workspaces.batch')}
								<IconChevronDown class="h-3 w-3 opacity-70" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" sideOffset={4} class="w-56">
						{#if $daemon.isPnpmWorkspace}
							<DropdownMenu.Item onclick={doRecursivePublish} title={$_('workspaces.recursivePublishTitle')}>
								<IconPublish class="h-3.5 w-3.5" />
								{$_('workspaces.recursivePublish')}
							</DropdownMenu.Item>
						{/if}
						<DropdownMenu.Item onclick={doRecursiveOidc} disabled={scanned.length === 0} title={$_('workspaces.recursiveOidcTitle')}>
							<IconShieldCog class="h-3.5 w-3.5" />
							{$_('workspaces.recursiveOidc')}
						</DropdownMenu.Item>
						<DropdownMenu.Separator />
						<DropdownMenu.Item onclick={toggleBatchMode} title={$_('workspaces.selectModeTitle')}>
							{#if batchMode}
								<IconSquare class="h-3.5 w-3.5" />
							{:else}
								<IconCheckSquare class="h-3.5 w-3.5" />
							{/if}
							{$_('workspaces.selectMode')}
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		</div>

	<!-- Filter -->
	{#if scanned.length > 0}
		<Input bind:value={filterText} placeholder={$_('workspaces.filterPlaceholder')} />
	{/if}

	<!-- Package list -->
	{#if scanned.length === 0}
		<div class="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
			{$_('workspaces.noPackages')}
		</div>
	{:else if filteredPackages.length === 0}
		<div class="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
			{$_('workspaces.noFilterMatch')}
		</div>
	{:else}
		<div class="space-y-2">
			<div class="flex items-center justify-between gap-2">
				<div class="flex items-center gap-2">
					<span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
						{#if batchMode}
							{$_('workspaces.selectionCount', { values: { selected: selected.size, total: scanned.length } })}
						{:else if filterText.trim()}
							{$_('workspaces.packageCountFiltered', { values: { shown: filteredPackages.length, total: scanned.length } })}
						{:else}
							{$_('workspaces.packageCount', { values: { count: filteredPackages.length } })}
						{/if}
					</span>
					{#if batchMode}
						<Button variant="ghost" size="sm" class="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground" onclick={toggleBatchMode} title={$_('workspaces.cancelSelectModeTitle')}>
							{$_('workspaces.cancelSelectMode')}
						</Button>
					{/if}
				</div>
					<div class="flex items-center gap-1.5">
						{#if batchMode}
							<!-- Selection helpers: select-all (Toggle, active when all selected) / invert / clear -->
							<ButtonGroup>
								<Toggle
									variant="outline"
									size="sm"
									class="size-7 p-0"
									aria-label={$_('workspaces.selectAll')}
									title={$_('workspaces.selectAll')}
									bind:pressed={allSelectedPressed}
									onPressedChange={toggleSelectAll}
								>
									<IconListChecks class="h-3.5 w-3.5" />
								</Toggle>
								<Button variant="outline" size="icon-sm" onclick={invertSelection} title={$_('workspaces.invertSelection')} aria-label={$_('workspaces.invertSelection')}>
									<IconInvert class="h-3.5 w-3.5" />
								</Button>
								<Button variant="outline" size="icon-sm" onclick={clearSelection} disabled={selected.size === 0} title={$_('workspaces.clearSelection')} aria-label={$_('workspaces.clearSelection')}>
									<IconLayoutList class="h-3.5 w-3.5" />
								</Button>
							</ButtonGroup>
							<!-- Batch actions: only shown in multi-select mode. -->
							<ButtonGroup>
								<Button
									variant="brand"
									size="sm"
									disabled={!batchPublishable}
									onclick={doBatchPublish}
									title={$_('workspaces.batchPublish')}
								>
									<IconPublish class="h-3.5 w-3.5" /> {$_('workspaces.batchPublish')}
								</Button>
								<Button
									variant="outline"
									size="sm"
									disabled={selected.size === 0}
									onclick={openBatchTrustedPublishing}
									title={$_('workspaces.batchOidc')}
								>
									<IconShieldCog class="h-3.5 w-3.5" /> {$_('workspaces.batchOidc')}
								</Button>
							</ButtonGroup>
						{/if}
					</div>
			</div>

			{#each filteredPackages as pkg, i (pkg.path)}
				<div
					animate:flip={flipParams}
					in:fade|global={enterParams(i)}
					out:fade={leaveParams}
					class="group rounded-lg border bg-card p-3.5 transition-colors {batchMode && selected.has(pkg.name) ? 'border-brand ring-2 ring-brand/30' : 'border-border'}"
					role={batchMode ? 'button' : undefined}
					onclick={batchMode ? () => toggleSelect(pkg.name) : undefined}
				>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								{#if batchMode}
									{#if selected.has(pkg.name)}
										<IconCheckSquare class="h-4 w-4 shrink-0 text-brand" />
									{:else}
										<IconSquare class="h-4 w-4 shrink-0 text-muted-foreground" />
									{/if}
								{/if}
								<span class="truncate text-sm font-semibold">{pkg.name}</span>
								<Badge variant="outline" class="font-mono text-[10px]">{pkg.version}</Badge>
							</div>
							{#if pkg.repository}
								<p class="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/80">{pkg.repository}</p>
							{/if}
							<!-- Trusted Publishing status line — always visible -->
							<div class="mt-1 flex items-center gap-1.5">
								<IconShield class="h-3 w-3 shrink-0 {trustedPublishing.isConfigured(pkg.name) ? 'text-success' : 'text-muted-foreground/50'}" />
								{#if trustedPublishing.isConfigured(pkg.name)}
									<span class="truncate text-[11px] text-success/90">{trustedPublishingStatusText(pkg.name)}</span>
								{:else if trustedPublishing.isLoading(pkg.name)}
									<span class="truncate text-[11px] shiny-text">{trustedPublishingStatusText(pkg.name)}</span>
								{:else}
									<span class="truncate text-[11px] text-muted-foreground/50">{trustedPublishingStatusText(pkg.name)}</span>
								{/if}
							</div>
							{#if pkg.description}
								<p class="mt-0.5 truncate text-xs text-muted-foreground">{pkg.description}</p>
							{/if}
							<p class="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">{relPath(pkg.path)}</p>
						</div>
						<!-- Action buttons (hidden in batch mode) -->
						{#if !batchMode}
							<ButtonGroup class="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
								{#if !canPublish(pkg) && publishDisabledReason(pkg)}
									<!--
										The button is NOT `disabled` (that would set pointer-events:none
										and the tooltip could never trigger). Instead it stays hoverable,
										looks disabled via opacity, and its onclick is a no-op so the
										tooltip can still show the reason.
									-->
									<Tooltip.Root>
										<Tooltip.Trigger>
											{#snippet child({ props })}
												<Button
													{...props}
													variant="brand"
													size="sm"
													aria-disabled="true"
													tabindex={-1}
													class="pointer-events-auto opacity-50"
													onclick={(e) => e.preventDefault()}
												>
													<IconPublish class="h-3.5 w-3.5" /> {$_('workspaces.publish')}
												</Button>
											{/snippet}
										</Tooltip.Trigger>
										<Tooltip.Content side="bottom">{publishDisabledReason(pkg)}</Tooltip.Content>
									</Tooltip.Root>
								{:else}
									<Button
										variant="brand"
										size="sm"
										onclick={() => doPublish(pkg)}
									>
										<IconPublish class="h-3.5 w-3.5" /> {$_('workspaces.publish')}
									</Button>
								{/if}
								<Button
									variant={trustedPublishing.isConfigured(pkg.name) ? 'brand' : 'outline'}
									size="sm"
									onpointerenter={() => trustedPublishing.fetch(pkg.name)}
									onclick={() => openTrustedPublishingDialog(pkg)}
								>
									<IconShieldCog class="h-3.5 w-3.5" /> OIDC
								</Button>
							</ButtonGroup>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Single-package Trusted Publishing dialog -->
<TrustedPublishingDialog
	bind:open={trustedPublishingDialogOpen}
	packageName={trustedPublishingDialogPkg}
	packagePath={trustedPublishingDialogPath}
	configs={trustedPublishing.configs(trustedPublishingDialogPkg)}
	configLoading={trustedPublishing.isLoading(trustedPublishingDialogPkg)}
	repositoryHint={trustedPublishingDialogRepoHint}
	initialTab={trustedPublishingDialogInitialTab}
	onChanged={onTrustedPublishingChanged}
/>

<!-- Batch Trusted Publishing dialog — submits the same config to every selected package -->
<TrustedPublishingDialog
	bind:open={batchTrustedPublishingOpen}
	packageNames={[...selected]}
	packageTargets={batchTrustedPublishingTargets}
	packagePath={decodedRoot}
	config={null}
	repositoryHint={batchRepoHint}
	onChanged={() => {
		// Invalidate all selected packages' cache so re-scan reflects the new
		// trust state, then exit batch mode.
		for (const name of selected) trustedPublishing.invalidate(name);
		batchMode = false;
		selected = new Set();
	}}
/>

<style>
	.shiny-text {
		background: linear-gradient(90deg, var(--muted-foreground) 0%, var(--muted-foreground) 40%, var(--foreground) 50%, var(--muted-foreground) 60%, var(--muted-foreground) 100%);
		background-size: 200% 100%;
		background-clip: text;
		-webkit-background-clip: text;
		color: transparent;
		animation: shiny-sweep 1.8s linear infinite;
	}
	@keyframes shiny-sweep {
		0% { background-position: 100% 0; }
		100% { background-position: -100% 0; }
	}
	@media (prefers-reduced-motion: reduce) {
		.shiny-text { animation: none; color: var(--muted-foreground); background: none; }
	}
</style>
