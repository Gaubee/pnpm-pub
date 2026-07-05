<script lang="ts">
	/**
	 * PackageDetail — the npmjs.com-style detail page for a registry package.
	 *
	 * Backed by the `packages.detail` oRPC procedure (daemon merges the registry
	 * packument, collaborators, and weekly downloads). Renders the README via
	 * marked → safeSetHTML (DOM Sanitizer API), a metadata sidebar, a
	 * collaborators row, and a Trusted Publishing config card — the same
	 * affordance the Workspaces detail page offers for on-disk packages.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getRpcClient } from '$lib/store.js';
	import { safeSetHtml } from '$lib/safe-html.js';
	import { createTrustedPublishingStatus } from '$lib/hooks/use-trusted-publishing.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import TrustedPublishingDialog from '$lib/components/trusted-publishing-dialog.svelte';
	import TrustedPublishingStatus from '$lib/components/trusted-publishing-status.svelte';
	import { marked } from 'marked';
	import type { PackageDetail, TrustedPublisherConfig } from '$lib/types.js';
	import IconArrowLeft from '@lucide/svelte/icons/arrow-left';
	import IconExternalLink from '@lucide/svelte/icons/external-link';
	import IconLoader from '@lucide/svelte/icons/loader-circle';
	import IconShield from '@lucide/svelte/icons/shield-check';
	import IconFolderGit from '@lucide/svelte/icons/folder-git-2';
	import IconGlobe from '@lucide/svelte/icons/globe';
	import IconScale from '@lucide/svelte/icons/scale';
	import IconCalendar from '@lucide/svelte/icons/calendar';
	import IconDownload from '@lucide/svelte/icons/download';
	import IconUsers from '@lucide/svelte/icons/users';
	import { _ } from 'svelte-i18n';

	const name = $derived(decodeURIComponent(page.params.name ?? ''));

	// Stale-while-revalidate: cache survives navigation back to the list and a
	// return to the same package. Module-local, in-memory (SPA session).
	const cache = new Map<string, PackageDetail>();

	let detail = $state<PackageDetail | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let notFound = $state(false);
	let readmeEl = $state<HTMLDivElement | null>(null);

	// README is parsed once per detail change and re-injected safely.
	let readmeHtml = $derived(detail?.readme ? (marked.parse(detail.readme, { async: false }) as string) : '');

	$effect(() => {
		const n = name;
		if (!n) return;
		loadDetail(n);
	});

	// Re-inject the README whenever the parsed HTML changes (new detail loaded).
	$effect(() => {
		const html = readmeHtml;
		const el = readmeEl;
		if (!el) return;
		safeSetHtml(el, html);
	});

	let activeReq = 0;
	async function loadDetail(n: string): Promise<void> {
		const reqId = ++activeReq;
		const stale = cache.get(n);
		if (stale) {
			detail = stale;
			error = null;
			notFound = false;
			loading = false;
		} else {
			loading = true;
		}
		try {
			const json = await getRpcClient()?.packages.detail({ name: n });
			if (reqId !== activeReq) return;
			if (json?.ok && json.detail) {
				detail = json.detail;
				cache.set(n, json.detail);
				error = null;
				notFound = false;
			} else {
				if (!stale) detail = null;
				notFound = json?.error === 'Not Found';
				error = json?.error ?? $_('packageDetail.error');
			}
		} catch {
			if (reqId !== activeReq) return;
			if (!stale) {
				error = $_('packageDetail.error');
				detail = null;
			}
		} finally {
			if (reqId === activeReq) loading = false;
		}
	}

	function formatDate(iso?: string | null): string {
		if (!iso) return '';
		try {
			return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
		} catch {
			return iso.slice(0, 10);
		}
	}

	function formatDownloads(n: number): string {
		return n.toLocaleString();
	}

	// ----- Trusted Publishing -----
	const trustedPublishing = createTrustedPublishingStatus();
	$effect(() => {
		const n = name;
		if (n && (detail || !loading)) trustedPublishing.fetch(n);
	});

	let trustedPublishingDialogOpen = $state(false);
	// Reactive: reads from the Trusted Publishing store so a config arriving after the dialog
	// opens (opened while loading) flows in and syncs the form.
	let trustedPublishingDialogConfig = $derived(trustedPublishing.configs(name)[0] ?? null);

	function openTrustedPublishingDialog(_e?: MouseEvent): void {
		trustedPublishingDialogOpen = true;
	}
	function onTrustedPublishingChanged(): void {
		trustedPublishing.invalidate(name);
	}

	function trustedPublishingStatus(): 'configured' | 'loading' | 'none' {
		const n = name;
		if (trustedPublishing.isConfigured(n)) return 'configured';
		if (trustedPublishing.isLoading(n)) return 'loading';
		return 'none';
	}
	function trustedPublishingText(): string {
		const status = trustedPublishingStatus();
		if (status === 'loading') return $_('trustedPublishing.loading');
		if (status === 'none') return $_('trustedPublishing.notConfigured');
		const cfg = trustedPublishing.configs(name)[0];
		if (!cfg) return $_('trustedPublishing.notConfigured');
		const repo =
			cfg.type === 'github'
				? cfg.claims.repository
				: cfg.type === 'gitlab'
					? cfg.claims.project_path
					: cfg.claims['oidc.circleci.com/vcs-origin'];
		const env = cfg.type === 'github' || cfg.type === 'gitlab' ? cfg.claims.environment : undefined;
		return [cfg.type, repo, env].filter(Boolean).join(' · ');
	}

	const repoHint = $derived(detail?.repository ?? '');

	// Detect a GitHub repo so we can render the github icon on the repository row.
	function isGitHubRepo(url: string | null | undefined): boolean {
		return !!url && /github\.com/i.test(url);
	}
</script>

<svelte:head>
	<title>{name} · {$_('packageDetail.heading')}</title>
</svelte:head>

<div class="mx-auto flex max-w-5xl flex-col gap-5 p-6">
	<!-- Back link -->
	<button
		type="button"
		class="flex items-center gap-1 self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
		onclick={() => goto('/packages')}
	>
		<IconArrowLeft class="h-3.5 w-3.5" />
		{$_('packageDetail.back')}
	</button>

	{#if loading && !detail}
		<div class="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border p-12 text-sm text-muted-foreground">
			<IconLoader class="h-4 w-4 animate-spin" /> {$_('packageDetail.loading')}
		</div>
	{:else if notFound}
		<div class="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
			{$_('packageDetail.notFound', { values: { name } })}
		</div>
	{:else if error && !detail}
		<div class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
			{error}
		</div>
	{:else if detail}
		<!-- Header -->
		<header class="flex flex-col gap-2">
			<div class="flex flex-wrap items-center gap-2">
				<h1 class="text-xl font-semibold tracking-tight">{detail.name}</h1>
				<Badge variant="outline" class="font-mono text-[11px]">{detail.version}</Badge>
				<a
					href={`https://www.npmjs.com/package/${encodeURIComponent(detail.name)}`}
					target="_blank"
					rel="noreferrer"
					class="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-brand hover:underline"
				>
					<IconExternalLink class="h-3 w-3" /> npm
				</a>
			</div>
			{#if detail.description}
				<p class="text-sm text-muted-foreground">{detail.description}</p>
			{/if}
		</header>

		<div class="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
			<!-- Main column: README + Trusted Publishing -->
			<div class="flex min-w-0 flex-col gap-5">
				<!-- README -->
				<section class="rounded-lg border border-border bg-card p-4">
					<div class="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
						{$_('packageDetail.readme')}
					</div>
					{#if detail.readme}
						<!-- README HTML is parsed by marked then injected through safeSetHtml
						     (DOM Sanitizer API) — never bound via {@html}. -->
						<div bind:this={readmeEl} class="prose prose-sm max-w-none dark:prose-invert prose-headings:scroll-mt-0 prose-a:text-brand prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:before:content-none prose-code:after:content-none"></div>
					{:else}
						<p class="text-xs text-muted-foreground">{$_('packageDetail.noReadme')}</p>
					{/if}
				</section>

				<!-- Trusted Publishing card -->
				<section class="rounded-lg border border-border bg-card p-4">
					<div class="mb-3 flex items-center justify-between gap-2">
						<div class="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
							<IconShield class="h-3.5 w-3.5" />
							{$_('packageDetail.trustedPublishing')}
						</div>
					</div>
					<TrustedPublishingStatus
						status={trustedPublishingStatus()}
						text={trustedPublishingText()}
						buttonLabel={$_('packageDetail.configure')}
						onconfigure={openTrustedPublishingDialog}
					/>
					{#if !repoHint}
						<p class="mt-2 text-[11px] text-muted-foreground/70">{$_('packageDetail.repositoryHint')}</p>
					{:else}
						<p class="mt-2 text-[11px] text-muted-foreground/70">{$_('packageDetail.trustedPublishingHint')}</p>
					{/if}
				</section>
			</div>

			<!-- Sidebar: metadata -->
			<aside class="flex flex-col gap-5">
				<section class="rounded-lg border border-border bg-card p-4">
					<dl class="space-y-2.5 text-xs">
						<div class="flex items-center gap-2">
							<IconCalendar class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="w-20 shrink-0 text-muted-foreground">{$_('packageDetail.lastPublish')}</span>
							<span class="truncate font-mono">{formatDate(detail.lastPublish) || '—'}</span>
						</div>
						<div class="flex items-center gap-2">
							<IconScale class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="w-20 shrink-0 text-muted-foreground">{$_('packageDetail.license')}</span>
							<span class="truncate font-mono">{detail.license || '—'}</span>
						</div>
						<div class="flex items-center gap-2">
							<IconDownload class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="w-20 shrink-0 text-muted-foreground">{$_('packageDetail.weeklyDownloads')}</span>
							<span class="truncate font-mono">{formatDownloads(detail.weeklyDownloads)}</span>
						</div>
						{#if detail.repository}
							<div class="flex items-center gap-2">
								{#if isGitHubRepo(detail.repository)}
									<IconFolderGit class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								{:else}
									<IconGlobe class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								{/if}
								<span class="w-20 shrink-0 text-muted-foreground">{$_('packageDetail.repository')}</span>
								<a
									href={detail.repository}
									target="_blank"
									rel="noreferrer"
									class="truncate font-mono transition-colors hover:text-brand hover:underline"
								>
									{detail.repository}
								</a>
							</div>
						{/if}
						{#if detail.homepage}
							<div class="flex items-center gap-2">
								<IconGlobe class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								<span class="w-20 shrink-0 text-muted-foreground">{$_('packageDetail.homepage')}</span>
								<a
									href={detail.homepage}
									target="_blank"
									rel="noreferrer"
									class="truncate font-mono transition-colors hover:text-brand hover:underline"
								>
									{detail.homepage}
								</a>
							</div>
						{/if}
					</dl>
				</section>

				{#if detail.collaborators.length > 0}
					<section class="rounded-lg border border-border bg-card p-4">
						<div class="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
							<IconUsers class="h-3.5 w-3.5" />
							{$_('packageDetail.collaborators')}
						</div>
						<ul class="space-y-1.5 text-xs">
							{#each detail.collaborators as c (c.username)}
								<li class="flex items-center justify-between gap-2">
									<span class="truncate font-mono">{c.username}</span>
									{#if c.access}
										<Badge variant="secondary" class="text-[10px]">{c.access}</Badge>
									{/if}
								</li>
							{/each}
						</ul>
					</section>
				{/if}
			</aside>
		</div>
	{/if}
</div>

<TrustedPublishingDialog
	bind:open={trustedPublishingDialogOpen}
	packageName={name}
	config={trustedPublishingDialogConfig}
	repositoryHint={repoHint}
	onChanged={onTrustedPublishingChanged}
/>
