<script lang="ts">
	/**
	 * Workspaces List — scan input + tracked roots.
	 * Clicking a tracked root navigates to the Detail page (/workspaces/<base64(path)>).
	 * Pinned roots are sorted to the top.
	 */
	import { daemon, actions } from '$lib/store.js';
	import { fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { flipParams, enterParams, leaveParams } from '$lib/transitions.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import IconScan from '@lucide/svelte/icons/scan-search';
	import IconPin from '@lucide/svelte/icons/pin';
	import IconPinOff from '@lucide/svelte/icons/pin-off';
	import IconChevronRight from '@lucide/svelte/icons/chevron-right';
	import IconTrash from '@lucide/svelte/icons/trash-2';
	import { goto } from '$app/navigation';
	import { _ } from 'svelte-i18n';

	let scanPath = $state('');

	/** Pinned-first sort of tracked roots. */
	const sortedWorkspaces = $derived(
		[...$daemon.workspaces].sort((a, b) => {
			if (a.pinned === b.pinned) return a.addedAt - b.addedAt;
			return a.pinned ? -1 : 1;
		}),
	);

	function doScan(): void {
		const trimmed = scanPath.trim();
		if (!trimmed) return;
		actions.scanWorkspace(trimmed);
		goto(`/workspaces/${btoa(trimmed)}`);
	}

	/** Navigate to the detail page for a tracked root. */
	function openDetail(path: string): void {
		goto(`/workspaces/${btoa(path)}`);
	}

	/** Toggle the pinned flag for a tracked workspace. */
	async function pin(ws: { path: string; pinned: boolean }): Promise<void> {
		const next = !ws.pinned;
		try {
			await fetch('/api/workspace/pin', {
				method: 'POST',
				headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionStorage.getItem('pnpm-pub-webtoken') ?? ''}` },
				body: JSON.stringify({ path: ws.path, pinned: next }),
			});
		} catch {
			/* best-effort */
		}
	}

	/** Remove a tracked workspace root. */
	async function removeWorkspace(ws: { path: string }): Promise<void> {
		try {
			await fetch('/api/workspace/remove', {
				method: 'POST',
				headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionStorage.getItem('pnpm-pub-webtoken') ?? ''}` },
				body: JSON.stringify({ path: ws.path }),
			});
		} catch {
			/* best-effort */
		}
	}
</script>

<svelte:head><title>{$_('workspaces.title')}</title></svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-5 p-6">
	<header>
		<h1 class="text-lg font-semibold tracking-tight">{$_('workspaces.heading')}</h1>
		<p class="text-xs text-muted-foreground">{$_('workspaces.intro')}</p>
	</header>

	<!-- Scan input -->
	<div class="space-y-2">
		<Label for="scan">{$_('workspaces.projectRoot')}</Label>
		<div class="flex gap-2">
			<Input
				id="scan"
				bind:value={scanPath}
				placeholder="/path/to/project"
				onkeydown={(e) => e.key === 'Enter' && doScan()}
			/>
			<Button variant="brand" onclick={doScan}>
				<IconScan class="h-4 w-4" /> {$_('workspaces.scan')}
			</Button>
		</div>
		<p class="text-xs text-muted-foreground">{$_('workspaces.scanHint')}</p>
	</div>

	<!-- Tracked roots -->
	{#if sortedWorkspaces.length > 0}
		<section class="space-y-2">
			<h2 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{$_('workspaces.trackedRoots')}</h2>
			{#each sortedWorkspaces as ws, i (ws.path)}
					<div animate:flip={flipParams} in:fade={enterParams(i)} out:fade={leaveParams} class="group flex items-center justify-between rounded-md border border-border bg-card px-3 py-2.5 text-sm transition-colors hover:bg-accent/40">
					<button
						class="flex min-w-0 flex-1 items-center gap-2 text-left"
						onclick={() => openDetail(ws.path)}
					>
						<span class="truncate font-mono text-xs">{ws.path}</span>
						<IconChevronRight class="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
					</button>
					<div class="flex shrink-0 items-center gap-0.5">
						<Button
							variant="ghost"
							size="icon"
							class="h-7 w-7"
							onclick={() => pin(ws)}
							aria-label={$_('workspaces.togglePin')}
						>
							{#if ws.pinned}<IconPin class="h-3.5 w-3.5 text-brand" />{:else}<IconPinOff class="h-3.5 w-3.5" />{/if}
						</Button>
						<Button
							variant="ghost"
							size="icon"
							class="h-7 w-7 text-muted-foreground hover:text-destructive"
							onclick={() => removeWorkspace(ws)}
							aria-label={$_('workspaces.removeRoot')}
							title={$_('workspaces.removeRoot')}
						>
							<IconTrash class="h-3.5 w-3.5" />
						</Button>
					</div>
				</div>
			{/each}
		</section>
	{:else}
		<div class="rounded-xl border border-dashed border-border p-10 text-center">
			<p class="text-sm text-muted-foreground">{$_('workspaces.intro')}</p>
		</div>
	{/if}
</div>
