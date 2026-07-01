<script lang="ts">
	/**
	 * Packages — the active profile's published packages on the npm registry.
	 *
	 * Backed by `GET /api/packages` (daemon walks `/-/v1/search?text=maintainer:…`
	 * and caches the full list). The daemon performs the filter / sort / paginate
	 * server-side; this page just renders the response and re-queries on input
	 * changes (debounced for free-text search).
	 */
	import { activeProfile } from '$lib/store.js';
	import { apiFetch } from '$lib/api-fetch.js';
	import { parsePackagesResponse } from '$lib/rest-response.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { NpmPackage } from '$lib/types.js';
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
	let loading = $state(false);
	let error = $state<string | null>(null);

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
		loading = true;
		error = null;
		const params = new URLSearchParams({
			q: debouncedQuery.trim(),
			sort,
			page: String(page),
			pageSize: String(PAGE_SIZE),
		});
		try {
			const res = await apiFetch(`/api/packages?${params}`);
			const json = parsePackagesResponse(await res.json());
			if (json?.ok) {
				data = {
					items: json.items ?? [],
					total: json.total ?? 0,
					page: json.page ?? page,
					pageSize: json.pageSize ?? PAGE_SIZE,
				};
			} else {
				error = json?.error ?? $_('packages.error');
				data = null;
			}
		} catch {
			error = $_('packages.error');
			data = null;
		} finally {
			loading = false;
		}
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
				<div class="group rounded-lg border border-border bg-card p-3.5 transition-colors hover:bg-accent/30">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<a
									href={`https://www.npmjs.com/package/${encodeURIComponent(pkg.name)}`}
									target="_blank"
									rel="noreferrer"
									class="truncate text-sm font-semibold transition-colors hover:text-brand hover:underline"
								>
									{pkg.name}
								</a>
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
