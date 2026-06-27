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
	import IconScan from '@lucide/svelte/icons/scan-search';
	import IconPin from '@lucide/svelte/icons/pin';
	import IconPinOff from '@lucide/svelte/icons/pin-off';
	import IconPublish from '@lucide/svelte/icons/upload';
	import IconShield from '@lucide/svelte/icons/shield-check';
	import { goto } from '$app/navigation';
	import type { PublishTarget } from '$lib/types.js';

	let scanPath = $state('');

	const scanned = $derived($daemon.packages);
	const scannedRoot = $derived($daemon.scannedRoot);

	function doScan(): void {
		const trimmed = scanPath.trim();
		if (trimmed) actions.scanWorkspace(trimmed);
	}

	function publishPayload(pkg: PublishTarget): { source: { kind: 'directory'; path: string }; args: string[]; target: PublishTarget } {
		return { source: { kind: 'directory', path: pkg.path }, args: [], target: pkg };
	}

	function oidcPayload(pkg: PublishTarget): { name: string; repo: string; path: string } | null {
		if (!pkg.repository) return null;
		return { name: pkg.name, repo: pkg.repository, path: pkg.path };
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

<svelte:head><title>Workspaces · pnpm-pub</title></svelte:head>

<div class="mx-auto flex max-w-3xl flex-col gap-5 p-6">
	<header>
		<h1 class="text-lg font-semibold tracking-tight">Workspaces</h1>
		<p class="text-xs text-muted-foreground">Scan a project root to list its publishable packages.</p>
	</header>

	<section class="rounded-xl border border-border bg-card p-4">
		<Label for="scan" class="mb-1.5 block">Project root path</Label>
		<div class="flex gap-2">
			<Input id="scan" bind:value={scanPath} placeholder="/path/to/project" onkeydown={(e) => e.key === 'Enter' && doScan()} />
			<Button variant="brand" onclick={doScan}><IconScan class="h-4 w-4" /> Scan</Button>
		</div>
		<p class="mt-1.5 text-[11px] text-muted-foreground">
			A pnpm-workspace.yaml takes priority; otherwise we walk excluding node_modules/.git.
		</p>
	</section>

	{#if $daemon.riskyConfirmationToken}
		<section class="rounded-xl border border-warning/50 bg-warning/10 p-4">
			<h2 class="text-sm font-semibold text-foreground">Confirm risky directory</h2>
			<p class="mt-1 text-xs text-muted-foreground">
				<code class="rounded bg-warning/20 px-1 py-0.5 font-mono text-[11px]">{$daemon.scannedRoot ?? $daemon.riskyConfirmationToken}</code>
				has no Git or NPM project markers. Adding it may cause the OS to stall. Are you sure?
			</p>
			<div class="mt-3 flex gap-2">
				<Button
					variant="destructive"
					size="sm"
					onclick={() => { if ($daemon.riskyConfirmationToken) actions.confirmRiskyWorkspace($daemon.riskyConfirmationToken); }}
				>
					Add it anyway
				</Button>
				<Button
					variant="outline"
					size="sm"
					onclick={() => { if ($daemon.riskyConfirmationToken) actions.cancelRiskyWorkspace($daemon.riskyConfirmationToken); }}
				>
					Cancel
				</Button>
			</div>
		</section>
	{/if}

	{#if $daemon.workspaces.length > 0}
		<section class="space-y-2">
			<h2 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tracked roots</h2>
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
						aria-label="Toggle pin"
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
					Packages in <span class="font-mono">{scannedRoot.split('/').pop()}</span>
				</h2>
				<Badge variant="secondary">{scanned.length} package{scanned.length === 1 ? '' : 's'}</Badge>
			</div>

			{#if scanned.length === 0}
				<div class="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
					No publishable packages for the active profile.
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
							{#if pkg.description}
								<p class="mt-0.5 truncate text-xs text-muted-foreground">{pkg.description}</p>
							{/if}
								<p class="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">{pkg.path}</p>
							</div>
							<div class="flex shrink-0 gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
								<Button
									variant="brand"
									size="sm"
									onclick={() => {
										actions.createEvent('publish', publishPayload(pkg));
										goto('/');
									}}
								>
									<IconPublish class="h-3.5 w-3.5" /> Publish
								</Button>
								<Button
									variant="outline"
									size="sm"
									disabled={!pkg.repository}
									title={pkg.repository ? 'Configure Trusted Publish' : 'Package repository metadata is required'}
									onclick={() => {
										const payload = oidcPayload(pkg);
										if (payload) {
											actions.createEvent('setup-oidc', payload);
											goto('/');
										}
									}}
								>
									<IconShield class="h-3.5 w-3.5" /> OIDC
								</Button>
							</div>
						</div>
					</div>
				{/each}
			{/if}
		</section>
	{/if}
</div>
