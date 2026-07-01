<script lang="ts">
	/**
	 * Workspace Detail — package list for a scanned root.
	 *
	 * Route: /workspaces/<base64(absolute-path)>
	 * On mount: decode the root path, trigger a re-scan, read $daemon.packages.
	 *
	 * Features:
	 *   - Filter: plain text = includes(); /pattern/ = RegExp
	 *   - OIDC status: always-visible line per package (loading shimmer / configured / not configured)
	 *   - Batch mode: toggle on → cards become selectable → batch OIDC dialog
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { daemon, actions } from '$lib/store.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { apiFetch } from '$lib/api-fetch.js';
	import { parseTrustListResponse } from '$lib/rest-response.js';
	import OidcDialog from '$lib/components/oidc-dialog.svelte';
	import IconArrowLeft from '@lucide/svelte/icons/arrow-left';
	import IconScan from '@lucide/svelte/icons/scan-search';
	import IconShield from '@lucide/svelte/icons/shield-check';
	import IconCheckSquare from '@lucide/svelte/icons/check-square';
	import IconSquare from '@lucide/svelte/icons/square';
	import IconLayers from '@lucide/svelte/icons/layers';
	import IconPublish from '@lucide/svelte/icons/upload';
	import { _ } from 'svelte-i18n';
	import type { PublishTarget, TrustedPublisherConfig } from '$lib/types.js';

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

	// --- OIDC status (mirrors the old workspaces page logic) ---
	const OIDC_TTL = 30_000;
	let oidcState = $state<Record<string, { configs: TrustedPublisherConfig[]; fetchedAt: number }>>({});
	let oidcInFlight = $state<Set<string>>(new Set());

	function isOidcConfigured(name: string): boolean {
		return !!oidcState[name] && oidcState[name]!.configs.length > 0;
	}
	function oidcLoading(name: string): boolean {
		return oidcInFlight.has(name) && !oidcState[name];
	}
	function oidcConfigs(name: string): TrustedPublisherConfig[] {
		return oidcState[name]?.configs ?? [];
	}
	function oidcSummary(cfg: TrustedPublisherConfig): string {
		const repo = cfg.type === 'gitlab' ? cfg.claims.project_path : cfg.type === 'circleci' ? cfg.claims['oidc.circleci.com/vcs-origin'] : cfg.claims.repository;
		const env = 'environment' in cfg.claims ? cfg.claims.environment : undefined;
		return [cfg.type, repo, env].filter(Boolean).join(' · ');
	}
	function oidcStatusText(name: string): string {
		if (oidcLoading(name)) return $_('oidc.loading');
		if (isOidcConfigured(name)) return oidcSummary(oidcConfigs(name)[0]!);
		return $_('oidc.notConfigured');
	}

	function maybeFetchOidc(name: string): void {
		if (oidcInFlight.has(name)) return;
		const cached = oidcState[name];
		if (cached && Date.now() - cached.fetchedAt < OIDC_TTL) return;
		oidcInFlight = new Set(oidcInFlight).add(name);
		apiFetch(`/api/oidc/trust?package=${encodeURIComponent(name)}`)
			.then((r) => r.json())
			.then((raw) => {
				const json = parseTrustListResponse(raw);
				if (json?.ok && json.configs) {
					oidcState = { ...oidcState, [name]: { configs: json.configs, fetchedAt: Date.now() } };
				} else {
					// Error (403/404 etc) — also cache as empty for 30s to avoid retries.
					oidcState = { ...oidcState, [name]: { configs: [], fetchedAt: Date.now() } };
				}
			})
			.catch(() => {
				oidcState = { ...oidcState, [name]: { configs: [], fetchedAt: Date.now() } };
			})
			.finally(() => {
				const next = new Set(oidcInFlight);
				next.delete(name);
				oidcInFlight = next;
			});
	}

	// Auto-prefetch OIDC when package list changes
	$effect(() => {
		void scanned;
		for (const pkg of scanned) maybeFetchOidc(pkg.name);
	});

	// --- OIDC dialog (single-package mode) ---
	let oidcDialogOpen = $state(false);
	let oidcDialogPkg = $state('');
	let oidcDialogConfig = $state<TrustedPublisherConfig | null>(null);
	let oidcDialogRepoHint = $state('');

	function openOidcDialog(pkg: PublishTarget): void {
		oidcDialogPkg = pkg.name;
		oidcDialogConfig = oidcConfigs(pkg.name)[0] ?? null;
		oidcDialogRepoHint = pkg.repository ?? '';
		oidcDialogOpen = true;
	}
	function onOidcChanged(): void {
		if (oidcDialogPkg) {
			const next = { ...oidcState };
			delete next[oidcDialogPkg];
			oidcState = next;
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

	// --- Batch OIDC dialog ---
	let batchOidcOpen = $state(false);
	let batchRepoHint = $state('');

	/** If all selected packages share the same repository, use it as the hint. */
	function openBatchOidc(): void {
		if (selected.size === 0) return;
		const selectedPkgs = scanned.filter((p) => selected.has(p.name));
		const repos = new Set(selectedPkgs.map((p) => p.repository ?? ''));
		batchRepoHint = repos.size === 1 ? [...repos][0]! : '';
		batchOidcOpen = true;
	}

	// --- Publish ---
	function canPublish(pkg: PublishTarget): boolean {
		return pkg.publishable !== false;
	}
	function publishPayload(pkg: PublishTarget) {
		return { source: { kind: 'directory' as const, path: pkg.path }, args: [], target: pkg };
	}
	function doPublish(pkg: PublishTarget): void {
		if (!canPublish(pkg)) return;
		actions.createEvent('publish', publishPayload(pkg));
		goto('/');
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
					<Button variant="brand" size="sm" onclick={openBatchOidc}>
						<IconShield class="h-3.5 w-3.5" /> {$_('workspaces.batchOidc')} ({selected.size})
					</Button>
				{/if}
			</div>

			{#each filteredPackages as pkg (pkg.path)}
				<div
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
							<!-- OIDC status line — always visible -->
							<div class="mt-1 flex items-center gap-1.5">
								<IconShield class="h-3 w-3 shrink-0 {isOidcConfigured(pkg.name) ? 'text-success' : 'text-muted-foreground/50'}" />
								{#if isOidcConfigured(pkg.name)}
									<span class="truncate text-[11px] text-success/90">{oidcStatusText(pkg.name)}</span>
								{:else if oidcLoading(pkg.name)}
									<span class="truncate text-[11px] shiny-text">{oidcStatusText(pkg.name)}</span>
								{:else}
									<span class="truncate text-[11px] text-muted-foreground/50">{oidcStatusText(pkg.name)}</span>
								{/if}
							</div>
							{#if pkg.description}
								<p class="mt-0.5 truncate text-xs text-muted-foreground">{pkg.description}</p>
							{/if}
							<p class="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">{relPath(pkg.path)}</p>
						</div>
						<!-- Action buttons (hidden in batch mode) -->
						{#if !batchMode}
							<div class="flex shrink-0 gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
								<Button
									variant="brand"
									size="sm"
									disabled={!canPublish(pkg)}
									onclick={() => doPublish(pkg)}
								>
									<IconPublish class="h-3.5 w-3.5" /> {$_('workspaces.publish')}
								</Button>
								<Button
									variant={isOidcConfigured(pkg.name) ? 'brand' : 'outline'}
									size="sm"
									disabled={!pkg.repository}
									onpointerenter={() => maybeFetchOidc(pkg.name)}
									onclick={() => openOidcDialog(pkg)}
								>
									<IconShield class="h-3.5 w-3.5" /> {$_('workspaces.oidc')}
								</Button>
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Single-package OIDC dialog -->
<OidcDialog
	bind:open={oidcDialogOpen}
	packageName={oidcDialogPkg}
	config={oidcDialogConfig}
	repositoryHint={oidcDialogRepoHint}
	onChanged={onOidcChanged}
/>

<!-- Batch OIDC dialog — submits the same config to every selected package -->
<OidcDialog
	bind:open={batchOidcOpen}
	packageNames={[...selected]}
	config={null}
	repositoryHint={batchRepoHint}
	onChanged={() => {
		// Invalidate all selected packages' cache.
		const next = { ...oidcState };
		for (const name of selected) delete next[name];
		oidcState = next;
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
