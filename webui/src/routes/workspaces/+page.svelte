<script lang="ts">
	/**
	 * Workspaces view (Chapter 6.3).
	 * Add a workspace root, scan it, render package cards, and trigger Events
	 * from card actions (Chapter 6.3.3 — actions route back to Events).
	 */
	import { daemon, actions, readWebToken } from '$lib/store.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import OidcDialog from '$lib/components/oidc-dialog.svelte';
	import { parseTrustListResponse } from '$lib/rest-response.js';
	import IconScan from '@lucide/svelte/icons/scan-search';
	import IconPin from '@lucide/svelte/icons/pin';
	import IconPinOff from '@lucide/svelte/icons/pin-off';
	import IconPublish from '@lucide/svelte/icons/upload';
	import IconShield from '@lucide/svelte/icons/shield-check';
	import { goto } from '$app/navigation';
	import type { PublishTarget, TrustedPublisherConfig } from '$lib/types.js';
	import { _ } from 'svelte-i18n';

	let scanPath = $state('');

	const scanned = $derived($daemon.packages);
	const scannedRoot = $derived($daemon.scannedRoot);

	// ----- Trusted Publishing (OIDC) -----
	// 包列表出现后自动预取每个包的 trust 配置（结果前端缓存 30s，与后端一致）。
	// 已配置的包：OIDC 按钮变 brand 色 + 卡片直接显示配置摘要。点击开对话框。
	const OIDC_FRONTEND_TTL_MS = 30_000;
	let oidcState = $state<Record<string, { configs: TrustedPublisherConfig[]; fetchedAt: number }>>({});
	let oidcDialogOpen = $state(false);
	let oidcDialogPkg = $state('');
	let oidcDialogConfig = $state<TrustedPublisherConfig | null>(null);
	let oidcFetched = $state<Set<string>>(new Set()); // 已发起过 fetch 的包，避免重复

	function isOidcConfigured(pkgName: string): boolean {
		const s = oidcState[pkgName];
		return !!s && s.configs.length > 0;
	}

	/** Short human label for a trusted-publisher config (e.g. "github · jixoai/opentray · npm-release"). */
	function oidcSummary(cfg: TrustedPublisherConfig): string {
		const repo =
			cfg.type === 'gitlab' ? cfg.claims.project : cfg.claims.repository;
		const env = cfg.claims.environment;
		const parts = [cfg.type, repo];
		if (env) parts.push(env);
		return parts.filter(Boolean).join(' · ');
	}
	function oidcConfigs(pkgName: string): TrustedPublisherConfig[] {
		return oidcState[pkgName]?.configs ?? [];
	}

	// 包列表一出现就预取每个包的 trust 配置（hover/focus 仍可手动刷新）。
	$effect(() => {
		void scanned;
		for (const pkg of scanned) maybeFetchOidc(pkg.name);
	});

	function maybeFetchOidc(pkgName: string): void {
		if (oidcFetched.has(pkgName)) return;
		const cached = oidcState[pkgName];
		if (cached && Date.now() - cached.fetchedAt < OIDC_FRONTEND_TTL_MS) return;
		oidcFetched = new Set(oidcFetched).add(pkgName);
		fetch(`/api/oidc/trust?package=${encodeURIComponent(pkgName)}`, {
			headers: { authorization: `Bearer ${readWebToken()}` },
		})
			.then((r) => r.json())
			.then((raw) => {
				const json = parseTrustListResponse(raw);
				if (json?.ok && json.configs) {
					oidcState = { ...oidcState, [pkgName]: { configs: json.configs, fetchedAt: Date.now() } };
				}
			})
			.catch(() => {
				// OIDC 状态是辅助信息，失败静默。
			})
			.finally(() => {
				// 允许下次 hover 重新检查（在 TTL 内不会真发请求）。
				const next = new Set(oidcFetched);
				next.delete(pkgName);
				oidcFetched = next;
			});
	}

	function openOidcDialog(pkg: PublishTarget): void {
		oidcDialogPkg = pkg.name;
		// 用已缓存的配置预填（取第一条）；未缓存则为新增态。
		const existing = oidcState[pkg.name]?.configs[0] ?? null;
		oidcDialogConfig = existing;
		oidcDialogOpen = true;
	}

	function onOidcChanged(): void {
		// 提交/删除后失效该包的缓存，下次 hover 重新拉。
		if (oidcDialogPkg) {
			const next = { ...oidcState };
			delete next[oidcDialogPkg];
			oidcState = next;
		}
	}

	function doScan(): void {
		const trimmed = scanPath.trim();
		if (trimmed) actions.scanWorkspace(trimmed);
	}

	function publishPayload(pkg: PublishTarget): { source: { kind: 'directory'; path: string }; args: string[]; target: PublishTarget } {
		return { source: { kind: 'directory', path: pkg.path }, args: [], target: pkg };
	}

	function canPublish(pkg: PublishTarget): boolean {
		return pkg.publishable !== false;
	}

	/** Toggle the pinned flag for a tracked workspace (Chapter 6.1.2 sidebar). */
	async function pin(ws: { path: string; pinned: boolean }): Promise<void> {
		const next = !ws.pinned;
		try {
			await fetch('/api/workspace/pin', {
				method: 'POST',
				headers: { 'content-type': 'application/json', authorization: `Bearer ${readWebToken()}` },
				body: JSON.stringify({ path: ws.path, pinned: next }),
			});
		} catch {
			/* toast handled by store on next snapshot */
		}
	}
</script>

<svelte:head><title>{$_('workspaces.title')}</title></svelte:head>

<div class="mx-auto flex max-w-3xl flex-col gap-5 p-6">
	<header>
		<h1 class="text-lg font-semibold tracking-tight">{$_('workspaces.heading')}</h1>
		<p class="text-xs text-muted-foreground">{$_('workspaces.intro')}</p>
	</header>

	<section class="rounded-xl border border-border bg-card p-4">
		<Label for="scan" class="mb-1.5 block">{$_('workspaces.projectRoot')}</Label>
		<div class="flex gap-2">
			<Input id="scan" bind:value={scanPath} placeholder={$_('workspaces.projectRootPlaceholder')} onkeydown={(e) => e.key === 'Enter' && doScan()} />
			<Button variant="brand" onclick={doScan}><IconScan class="h-4 w-4" /> {$_('workspaces.scan')}</Button>
		</div>
		<p class="mt-1.5 text-[11px] text-muted-foreground">
			{$_('workspaces.scanHint')}
		</p>
	</section>

	{#if $daemon.riskyConfirmationToken}
		<section class="rounded-xl border border-warning/50 bg-warning/10 p-4">
			<h2 class="text-sm font-semibold text-foreground">{$_('workspaces.confirmRisky')}</h2>
			<p class="mt-1 text-xs text-muted-foreground">
				<code class="rounded bg-warning/20 px-1 py-0.5 font-mono text-[11px]">{$daemon.scannedRoot ?? $daemon.riskyConfirmationToken}</code>
				{$_('workspaces.riskyIntro', { values: { path: $daemon.scannedRoot ?? $daemon.riskyConfirmationToken ?? '' } })}
			</p>
			<div class="mt-3 flex gap-2">
				<Button
					variant="destructive"
					size="sm"
					onclick={() => { if ($daemon.riskyConfirmationToken) actions.confirmRiskyWorkspace($daemon.riskyConfirmationToken); }}
				>
					{$_('workspaces.addAnyway')}
				</Button>
				<Button
					variant="outline"
					size="sm"
					onclick={() => { if ($daemon.riskyConfirmationToken) actions.cancelRiskyWorkspace($daemon.riskyConfirmationToken); }}
				>
					{$_('common.cancel')}
				</Button>
			</div>
		</section>
	{/if}

	{#if $daemon.workspaces.length > 0}
		<section class="space-y-2">
			<h2 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{$_('workspaces.trackedRoots')}</h2>
			{#each $daemon.workspaces as ws (ws.path)}
				<div class="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
					<button class="truncate font-mono text-xs hover:underline" onclick={() => { scanPath = ws.path; doScan(); }}>
						{ws.path}
					</button>
					<Button
						variant="ghost"
						size="icon"
						class="h-7 w-7"
						onclick={() => pin(ws)}
						aria-label={$_('workspaces.togglePin')}
					>
						{#if ws.pinned}<IconPin class="h-3.5 w-3.5 text-brand" />{:else}<IconPinOff class="h-3.5 w-3.5" />{/if}
					</Button>
				</div>
			{/each}
		</section>
	{/if}

	{#if scannedRoot}
		<section class="space-y-2">
			<div class="flex items-center justify-between">
				<h2 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
					{$_('workspaces.packagesIn', { values: { name: scannedRoot.split('/').pop() ?? scannedRoot } })} <span class="font-mono">{scannedRoot.split('/').pop()}</span>
				</h2>
				<Badge variant="secondary">{$_('workspaces.packageCount', { values: { count: scanned.length } })}</Badge>
			</div>

			{#if scanned.length === 0}
				<div class="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
					{$_('workspaces.noPackages')}
				</div>
			{:else}
				{#each scanned as pkg (pkg.path)}
					<div class="group rounded-lg border border-border bg-card p-3.5">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex items-center gap-2">
								<span class="truncate text-sm font-semibold">{pkg.name}</span>
								<Badge variant="outline" class="font-mono text-[10px]">{pkg.version}</Badge>
							</div>
							{#if pkg.repository}
								<p class="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/80">{pkg.repository}</p>
							{/if}
							<!-- Trusted Publishing 配置（已配置则直接显示在卡片上） -->
							{#each oidcConfigs(pkg.name) as cfg (cfg.id ?? oidcSummary(cfg))}
								<div class="mt-1 flex items-center gap-1.5">
									<IconShield class="h-3 w-3 shrink-0 text-success" />
									<span class="truncate text-[11px] text-success/90">{oidcSummary(cfg)}</span>
								</div>
							{/each}
							{#if pkg.description}
								<p class="mt-0.5 truncate text-xs text-muted-foreground">{pkg.description}</p>
							{/if}
								<p class="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">{pkg.path}</p>
							</div>
							<div class="flex shrink-0 gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
								<Button
									variant="brand"
									size="sm"
									disabled={!canPublish(pkg)}
									title={canPublish(pkg) ? $_('workspaces.publish') : $_('workspaces.profileScopeMismatch')}
									onclick={() => {
										if (!canPublish(pkg)) return;
										actions.createEvent('publish', publishPayload(pkg));
										goto('/');
									}}
								>
								<IconPublish class="h-3.5 w-3.5" /> {$_('workspaces.publish')}
								</Button>
								<Button
									variant={isOidcConfigured(pkg.name) ? 'brand' : 'outline'}
									size="sm"
									disabled={!pkg.repository}
									title={pkg.repository ? $_('workspaces.configureTrustedPublish') : $_('workspaces.repositoryRequired')}
									onpointerenter={() => maybeFetchOidc(pkg.name)}
									onfocus={() => maybeFetchOidc(pkg.name)}
									onclick={() => openOidcDialog(pkg)}
								>
									<IconShield class="h-3.5 w-3.5" /> {$_('workspaces.oidc')}
								</Button>
							</div>
						</div>
					</div>
				{/each}
			{/if}
		</section>
	{/if}
</div>

<!-- OIDC Trusted Publishing 配置对话框（全局单实例）。 -->
<OidcDialog
	bind:open={oidcDialogOpen}
	packageName={oidcDialogPkg}
	config={oidcDialogConfig}
	onChanged={onOidcChanged}
/>
