<script lang="ts">
	/**
	 * Packages — the active profile's published packages on the npm registry.
	 *
	 * Backed by the `packages.list` oRPC event iterator. The daemon first emits
	 * a local snapshot projection, then registry truth, with server-side
	 * filter / sort / paginate applied to both frames. This page:
	 *   - shows local stale data instantly, then swaps in fresh registry data,
	 *   - animates list changes with `flip` + `fade` for smooth reordering,
	 *   - links each card to the in-app PackageDetail page,
	 *   - surfaces per-card Trusted Publishing (OIDC) status + a Configure button.
	 */
	import { activeProfile, getRpcClient } from '$lib/store.js';
	import { consumeEventIterator } from '@orpc/client';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import OidcDialog from '$lib/components/oidc-dialog.svelte';
	import OidcStatus from '$lib/components/oidc-status.svelte';
	import { createOidcStatus } from '$lib/hooks/use-oidc.svelte.js';
	import type { NpmPackage, TrustedPublisherConfig } from '$lib/types.js';
	import { goto } from '$app/navigation';
	import { flip } from 'svelte/animate';
	import { fade } from 'svelte/transition';
	import IconChevronLeft from '@lucide/svelte/icons/chevron-left';
	import IconChevronRight from '@lucide/svelte/icons/chevron-right';
	import IconLoader from '@lucide/svelte/icons/loader-circle';
	import IconPackage from '@lucide/svelte/icons/package';
	import { _ } from 'svelte-i18n';

	const PAGE_SIZE = 20;

	type Sort = 'date' | 'name';

	type PackagesData = {
		items: NpmPackage[];
		total: number;
		page: number;
		pageSize: number;
	};

	let query = $state('');
	let sort = $state<Sort>('date');
	let page = $state(0);

	let data = $state<PackagesData | null>(null);
	/** True only when fetching with no stale data to show (initial/blank load). */
	let loading = $state(false);
	let refreshing = $state(false);
	let error = $state<string | null>(null);

	let stopPackagesStream: (() => Promise<void>) | null = null;

	// Debounce the free-text query so each keystroke doesn't fire a request.
	let debouncedQuery = $state('');
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const value = query;
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debouncedQuery = value;
		}, 250);
	});

	// Re-fetch whenever the effective inputs change. Resetting page to 0 on
	// query/sort change happens before the fetch so we don't briefly read a
	// stale page index.
	let lastQuery = '';
	let lastSort: Sort = 'date';
	$effect(() => {
		void debouncedQuery;
		void sort;
		if (debouncedQuery !== lastQuery) {
			lastQuery = debouncedQuery;
			page = 0;
		}
		if (sort !== lastSort) {
			lastSort = sort;
			page = 0;
		}
		void page;
		fetchPackages();
	});

	async function fetchPackages(): Promise<void> {
		await stopPackagesStream?.();
		stopPackagesStream = null;
		const client = getRpcClient();
		if (!client) {
			loading = true;
			refreshing = false;
			return;
		}
		loading = !data;
		refreshing = true;
		error = null;
		stopPackagesStream = consumeEventIterator(
			client.packages.list({
				q: debouncedQuery.trim(),
				sort,
				page,
				pageSize: PAGE_SIZE,
			}),
			{
				onEvent(frame) {
					if (frame.ok) {
						data = {
							items: frame.items,
							total: frame.total,
							page: frame.page,
							pageSize: frame.pageSize,
						};
						error = null;
						loading = false;
						if (frame.source === 'registry') refreshing = false;
					} else if (!data) {
						error = frame.error || $_('packages.error');
						loading = false;
						refreshing = false;
					}
				},
				onError() {
					if (!data) error = $_('packages.error');
					loading = false;
					refreshing = false;
				},
				onFinish() {
					loading = false;
					refreshing = false;
				},
			}
		);
	}

	const totalPages = $derived(Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE)));
	const safePage = $derived(Math.min(page, totalPages - 1));

	function formatDate(iso?: string | null): string {
		if (!iso) return '';
		try {
			return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
		} catch {
			return iso.slice(0, 10);
		}
	}

	// ----- Per-card OIDC -----
	const oidc = createOidcStatus();

	// Rebuild the `repositoryHint` the OIDC dialog infers owner/name + provider
	// from. The list's `repository` field is already `owner/repo` for GitHub.
	function repoHint(pkg: NpmPackage): string {
		const repo = pkg.repository;
		if (!repo) return '';
		// owner/repo  →  https://github.com/owner/repo
		if (/^[\w.-]+\/[\w.-]+$/.test(repo)) return `https://github.com/${repo}`;
		return repo;
	}

	let oidcDialogOpen = $state(false);
	let oidcDialogPkg = $state('');
	let oidcDialogRepoHint = $state('');
	// Reactive: reads from the OIDC store so a config that arrives AFTER the
	// dialog opens (opened while still loading) flows in and syncs the form.
	let oidcDialogConfig = $derived(oidc.configs(oidcDialogPkg)[0] ?? null);

	function openOidcDialog(e: MouseEvent | KeyboardEvent, pkg: NpmPackage): void {
		// Stop the click/keyup from bubbling into the card's outer button (which
		// navigates to the detail route) so opening the OIDC dialog stays put.
		e.stopPropagation();
		oidcDialogPkg = pkg.name;
		oidcDialogRepoHint = repoHint(pkg);
		oidcDialogOpen = true;
	}

	function onOidcChanged(): void {
		oidc.invalidate(oidcDialogPkg);
	}

	// Prefetch OIDC status for the currently visible page so the indicator is
	// ready before the user hovers a card.
	$effect(() => {
		const items = data?.items ?? [];
		for (const pkg of items) oidc.fetch(pkg.name);
	});

	function oidcStatusFor(name: string): 'configured' | 'loading' | 'none' {
		if (oidc.isConfigured(name)) return 'configured';
		if (oidc.isLoading(name)) return 'loading';
		return 'none';
	}

	function oidcText(name: string): string {
		const status = oidcStatusFor(name);
		if (status === 'loading') return $_('oidc.loading');
		if (status === 'none') return $_('oidc.notConfigured');
		const cfg = oidc.configs(name)[0];
		if (!cfg) return $_('oidc.notConfigured');
		const repo =
			cfg.type === 'github'
				? cfg.claims.repository
				: cfg.type === 'gitlab'
					? cfg.claims.project_path
					: cfg.claims['oidc.circleci.com/vcs-origin'];
		const env = cfg.type === 'github' || cfg.type === 'gitlab' ? cfg.claims.environment : undefined;
		return [cfg.type, repo, env].filter(Boolean).join(' · ');
	}

	function gotoDetail(pkg: NpmPackage): void {
		goto(`/packages/${encodeURIComponent(pkg.name)}`);
	}
</script>

<svelte:head>
	<title>{$_('packages.title')}</title>
</svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-4 p-6">
	<header>
		<h1 class="flex items-center gap-2 text-lg font-semibold tracking-tight">
			<IconPackage class="h-4 w-4 text-muted-foreground" />
			{$_('packages.heading')}
			{#if $activeProfile}
				<Badge variant="secondary" class="align-middle">{$activeProfile.username}</Badge>
			{/if}
			{#if refreshing}
				<IconLoader class="h-3.5 w-3.5 animate-spin text-muted-foreground/60" />
			{/if}
		</h1>
		<p class="text-xs text-muted-foreground">
			{$_('packages.intro', { values: { username: $activeProfile?.username ?? '' } })}
		</p>
	</header>

	<!-- Filter + sort -->
	<div class="flex items-center gap-2">
		<Input bind:value={query} placeholder={$_('packages.searchPlaceholder')} class="flex-1" />
		<select
			bind:value={sort}
			class="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
			aria-label={$_('packages.sort')}
		>
			<option value="date">{$_('packages.sortDate')}</option>
			<option value="name">{$_('packages.sortName')}</option>
		</select>
	</div>

	<!-- States -->
	{#if loading}
		<div class="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border p-10 text-sm text-muted-foreground">
			<IconLoader class="h-4 w-4 animate-spin" /> {$_('packages.loading')}
		</div>
	{:else if error}
		<div class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
			{error}
		</div>
	{:else if !data || data.items.length === 0}
		<div class="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
			{debouncedQuery.trim() ? $_('packages.noFilterMatch') : $_('packages.empty')}
		</div>
	{:else}
		<div class="space-y-2">
			<div class="flex items-center justify-between">
				<span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
					{$_('packages.count', { values: { count: data.total } })}
				</span>
			</div>

			{#each data.items as pkg (pkg.name)}
				<div
					animate:flip={{ duration: 200 }}
					in:fade|global={{ duration: 150 }}
					out:fade={{ duration: 150 }}
					class="group rounded-lg border border-border bg-card p-3.5 transition-colors hover:bg-accent/30"
				>
					<div class="flex items-start justify-between gap-3">
						<!-- Card body: plain text (selectable) — no wrapping button. -->
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="truncate text-sm font-semibold transition-colors group-hover:text-brand">
									{pkg.name}
								</span>
								<Badge variant="outline" class="font-mono text-[10px]">{pkg.version}</Badge>
							</div>
							{#if pkg.description}
								<p class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{pkg.description}</p>
							{/if}
							<div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground/80">
								{#if pkg.date}
									<span>{formatDate(pkg.date)}</span>
								{/if}
								{#if pkg.repository}
									<span class="truncate font-mono">{pkg.repository}</span>
								{/if}
							</div>
						</div>

						<!-- inline-end detail navigation: an icon button (keeps the card
						     body selectable while still giving a clear, clickable affordance
						     into the PackageDetail route). -->
						<button
							type="button"
							class="shrink-0 self-stretch rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							aria-label={$_('packages.openDetail', { values: { name: pkg.name } })}
							title={$_('packages.openDetail', { values: { name: pkg.name } })}
							onpointerenter={() => oidc.fetch(pkg.name)}
							onclick={() => gotoDetail(pkg)}
						>
							<IconChevronRight class="h-4 w-4" />
						</button>
					</div>

				<!-- OIDC status row + Configure action. The configure click stops
				     propagation so opening the dialog never navigates to the detail
				     route. Configuration is always allowed — the repository, when
				     missing, is just entered manually inside the dialog. -->
					<div class="mt-2 border-t border-border/60 pt-2">
						<OidcStatus
							status={oidcStatusFor(pkg.name)}
							text={oidcText(pkg.name)}
							buttonLabel={$_('packages.configureOidc')}
							onconfigure={(e) => openOidcDialog(e, pkg)}
						/>
					</div>
				</div>
			{/each}
		</div>

		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="flex items-center justify-between pt-1">
				<span class="text-[11px] text-muted-foreground">
					{$_('packages.pageOf', { values: { page: safePage + 1, total: totalPages } })}
				</span>
				<div class="flex gap-1.5">
					<Button variant="outline" size="sm" disabled={safePage === 0} onclick={() => (page = safePage - 1)}>
						<IconChevronLeft class="h-3.5 w-3.5" /> {$_('packages.prev')}
					</Button>
					<Button variant="outline" size="sm" disabled={safePage >= totalPages - 1} onclick={() => (page = safePage + 1)}>
						{$_('packages.next')} <IconChevronRight class="h-3.5 w-3.5" />
					</Button>
				</div>
			</div>
		{/if}
	{/if}
</div>

<OidcDialog
	bind:open={oidcDialogOpen}
	packageName={oidcDialogPkg}
	config={oidcDialogConfig}
	repositoryHint={oidcDialogRepoHint}
	onChanged={onOidcChanged}
/>
