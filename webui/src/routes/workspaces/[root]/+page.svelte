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
	import { daemon, actions, getRpcClient } from '$lib/store.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import TrustedPublishingDialog from '$lib/components/trusted-publishing-dialog.svelte';
	import IconArrowLeft from '@lucide/svelte/icons/arrow-left';
	import IconScan from '@lucide/svelte/icons/scan-search';
	import IconShield from '@lucide/svelte/icons/shield-check';
	import IconCheckSquare from '@lucide/svelte/icons/check-square';
	import IconSquare from '@lucide/svelte/icons/square';
	import IconLayers from '@lucide/svelte/icons/layers';
	import IconPublish from '@lucide/svelte/icons/upload';
	import IconFileCode from '@lucide/svelte/icons/file-code-2';
	import { _ } from 'svelte-i18n';
	import type { PublishTarget, TrustedPublisherConfig, TrustedPublishingTarget } from '$lib/types.js';

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
		// /pattern/ → RegExp
		if (f.startsWith('/') && f.endsWith('/') && f.length > 2) {
			try {
				const re = new RegExp(f.slice(1, -1));
				return scanned.filter((p) => re.test(p.name));
			} catch {
				return scanned;
			}
		}
		return scanned.filter((p) => p.name.includes(f));
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
	const TRUSTED_PUBLISHING_TTL = 30_000;
	let trustedPublishingState = $state<Record<string, { configs: TrustedPublisherConfig[]; fetchedAt: number }>>({});
	let trustedPublishingInFlight = $state<Set<string>>(new Set());

	function isTrustedPublishingConfigured(name: string): boolean {
		return !!trustedPublishingState[name] && trustedPublishingState[name]!.configs.length > 0;
	}
	function trustedPublishingLoading(name: string): boolean {
		return trustedPublishingInFlight.has(name) && !trustedPublishingState[name];
	}
	function trustedPublishingConfigs(name: string): TrustedPublisherConfig[] {
		return trustedPublishingState[name]?.configs ?? [];
	}
	function trustedPublishingSummary(cfg: TrustedPublisherConfig): string {
		const repo = cfg.type === 'gitlab' ? cfg.claims.project_path : cfg.type === 'circleci' ? cfg.claims['oidc.circleci.com/vcs-origin'] : cfg.claims.repository;
		const env = 'environment' in cfg.claims ? cfg.claims.environment : undefined;
		return [cfg.type, repo, env].filter(Boolean).join(' · ');
	}
	function trustedPublishingStatusText(name: string): string {
		if (trustedPublishingLoading(name)) return $_('trustedPublishing.loading');
		if (isTrustedPublishingConfigured(name)) return trustedPublishingSummary(trustedPublishingConfigs(name)[0]!);
		return $_('trustedPublishing.notConfigured');
	}

	function maybeFetchTrustedPublishing(name: string): void {
		if (trustedPublishingInFlight.has(name)) return;
		const cached = trustedPublishingState[name];
		if (cached && Date.now() - cached.fetchedAt < TRUSTED_PUBLISHING_TTL) return;
		trustedPublishingInFlight = new Set(trustedPublishingInFlight).add(name);
		const client = getRpcClient();
		if (!client) {
			trustedPublishingState = { ...trustedPublishingState, [name]: { configs: [], fetchedAt: Date.now() } };
			const next = new Set(trustedPublishingInFlight);
			next.delete(name);
			trustedPublishingInFlight = next;
			return;
		}
		client.trustedPublishing
			.listTrust({ package: name })
			.then((json) => {
				if (json?.ok && json.configs) {
					trustedPublishingState = { ...trustedPublishingState, [name]: { configs: json.configs, fetchedAt: Date.now() } };
				} else {
					// Error (403/404 etc) — also cache as empty for 30s to avoid retries.
					trustedPublishingState = { ...trustedPublishingState, [name]: { configs: [], fetchedAt: Date.now() } };
				}
			})
			.catch(() => {
				trustedPublishingState = { ...trustedPublishingState, [name]: { configs: [], fetchedAt: Date.now() } };
			})
			.finally(() => {
				const next = new Set(trustedPublishingInFlight);
				next.delete(name);
				trustedPublishingInFlight = next;
			});
	}

	// Auto-prefetch Trusted Publishing when package list changes
	$effect(() => {
		void scanned;
		for (const pkg of scanned) maybeFetchTrustedPublishing(pkg.name);
	});

	// --- Trusted Publishing dialog (single-package mode) ---
	let trustedPublishingDialogOpen = $state(false);
	let trustedPublishingDialogPkg = $state('');
	let trustedPublishingDialogPath = $state('');
	let trustedPublishingDialogRepoHint = $state('');
	let trustedPublishingDialogInitialTab = $state<'current' | 'workflow'>('current');
	// Reactive: reads from trustedPublishingState so a config that arrives AFTER the dialog
	// opens (opened while still loading) flows into the dialog and syncs its form.
	let trustedPublishingDialogConfig = $derived(trustedPublishingConfigs(trustedPublishingDialogPkg)[0] ?? null);

	function openTrustedPublishingDialog(pkg: PublishTarget, initialTab: 'current' | 'workflow' = 'current'): void {
		trustedPublishingDialogPkg = pkg.name;
		trustedPublishingDialogPath = pkg.path;
		trustedPublishingDialogRepoHint = pkg.repository ?? '';
		trustedPublishingDialogInitialTab = initialTab;
		trustedPublishingDialogOpen = true;
	}
	function onTrustedPublishingChanged(): void {
		if (trustedPublishingDialogPkg) {
			const next = { ...trustedPublishingState };
			delete next[trustedPublishingDialogPkg];
			trustedPublishingState = next;
		}
	}

	// --- Batch mode ---
	let batchMode = $state(false);
	let selected = $state<Set<string>>(new Set());

	function toggleBatch(): void {
		batchMode = !batchMode;
		if (!batchMode) selected = new Set();
	}
	function toggleSelect(name: string): void {
		const next = new Set(selected);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		selected = next;
	}

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
		batchTrustedPublishingTargets = selectedPkgs.map((pkg) => ({
			name: pkg.name,
			path: pkg.path,
			...(pkg.repository ? { repository: pkg.repository } : {}),
			...(trustedPublishingConfigs(pkg.name)[0] ? { currentConfig: trustedPublishingConfigs(pkg.name)[0] } : {}),
		}));
		batchTrustedPublishingOpen = true;
	}

	// --- Publish ---
	function canPublish(pkg: PublishTarget): boolean {
		return pkg.publishable !== false;
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
	function cycleAccess(name: string): void {
		pkgAccess = { ...pkgAccess, [name]: accessFor(name) === 'public' ? 'restricted' : 'public' };
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
		<div class="flex shrink-0 gap-2">
			{#if $daemon.isPnpmWorkspace}
				<Button
					variant="outline"
					size="sm"
					onclick={doRecursivePublish}
					title={$_('workspaces.recursivePublishTitle')}
				>
					<IconLayers class="h-3.5 w-3.5" /> {$_('workspaces.recursivePublish')}
				</Button>
			{/if}
			<Button
				variant={batchMode ? 'brand' : 'outline'}
				size="sm"
				onclick={toggleBatch}
				title={$_('workspaces.batchMode')}
			>
				<IconLayers class="h-3.5 w-3.5" /> {$_('workspaces.batch')}
			</Button>
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
			<div class="flex items-center justify-between">
				<span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
					{$_('workspaces.packageCount', { values: { count: filteredPackages.length } })}
				</span>
				{#if batchMode && selected.size > 0}
					<Button variant="brand" size="sm" onclick={openBatchTrustedPublishing}>
						<IconShield class="h-3.5 w-3.5" /> {$_('workspaces.batchTrustedPublishing')} ({selected.size})
					</Button>
				{/if}
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
								<IconShield class="h-3 w-3 shrink-0 {isTrustedPublishingConfigured(pkg.name) ? 'text-success' : 'text-muted-foreground/50'}" />
								{#if isTrustedPublishingConfigured(pkg.name)}
									<span class="truncate text-[11px] text-success/90">{trustedPublishingStatusText(pkg.name)}</span>
								{:else if trustedPublishingLoading(pkg.name)}
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
							<div class="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
								{#if isScoped(pkg.name)}
									<button
										type="button"
										title={$_('workspaces.accessTitle')}
										class="rounded-md border border-border px-1.5 py-1 text-[10px] font-medium transition-colors hover:bg-accent {accessFor(pkg.name) === 'restricted' ? 'text-warning' : 'text-muted-foreground'}"
										onclick={() => cycleAccess(pkg.name)}
									>
										{accessFor(pkg.name)}
									</button>
								{/if}
								<Button
									variant="brand"
									size="sm"
									disabled={!canPublish(pkg)}
									onclick={() => doPublish(pkg)}
								>
									<IconPublish class="h-3.5 w-3.5" /> {$_('workspaces.publish')}
								</Button>
								<Button
									variant={isTrustedPublishingConfigured(pkg.name) ? 'brand' : 'outline'}
									size="sm"
									onpointerenter={() => maybeFetchTrustedPublishing(pkg.name)}
									onclick={() => openTrustedPublishingDialog(pkg)}
								>
									<IconShield class="h-3.5 w-3.5" /> {$_('workspaces.trustedPublishing')}
								</Button>
								{#if isTrustedPublishingConfigured(pkg.name)}
									<Button
										variant="outline"
										size="sm"
										onclick={() => openTrustedPublishingDialog(pkg, 'workflow')}
									>
										<IconFileCode class="h-3.5 w-3.5" /> OIDC
									</Button>
								{/if}
							</div>
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
	config={trustedPublishingDialogConfig}
	repositoryHint={trustedPublishingDialogRepoHint}
	initialTab={trustedPublishingDialogInitialTab}
	onChanged={onTrustedPublishingChanged}
/>

<!-- Batch Trusted Publishing dialog — submits the same config to every selected package -->
<TrustedPublishingDialog
	bind:open={batchTrustedPublishingOpen}
	packageNames={[...selected]}
	packageTargets={batchTrustedPublishingTargets}
	config={null}
	repositoryHint={batchRepoHint}
	onChanged={() => {
		// Invalidate all selected packages' cache.
		const next = { ...trustedPublishingState };
		for (const name of selected) delete next[name];
		trustedPublishingState = next;
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
