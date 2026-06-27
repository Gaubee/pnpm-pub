<script lang="ts">
	/**
	 * Events Hub — the default home (Chapter 6.2).
	 * Timeline of Pending / Success / Failed events, plus proactive action
	 * triggers at the top (Chapter 6.2.3).
	 */
	import { pendingEvents, historyEvents, daemon } from '$lib/store.js';
	import EventCard from '$lib/components/event-card.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { actions } from '$lib/store.js';
	import IconPlus from '@lucide/svelte/icons/plus';
	import IconPackage from '@lucide/svelte/icons/package';
	import IconShield from '@lucide/svelte/icons/shield-check';
	import IconRefresh from '@lucide/svelte/icons/refresh-cw';

	let showActions = $state(false);
	let placeholderName = $state('');
	let oidcName = $state('');
	let oidcRepo = $state('');
	let oidcPath = $state('');

	function createPlaceholder(): void {
		const name = placeholderName.trim();
		if (!name) return;
		actions.createEvent('create-placeholder', { name });
		showActions = false;
		placeholderName = '';
	}

	function createOidc(): void {
		const name = oidcName.trim();
		const repo = oidcRepo.trim();
		const path = oidcPath.trim();
		if (!name || !repo || !path) return;
		actions.createEvent('setup-oidc', { name, repo, path });
		showActions = false;
		oidcName = '';
		oidcRepo = '';
		oidcPath = '';
	}
</script>

<svelte:head><title>Events · pnpm-pub</title></svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-5 p-6">
	<header class="flex items-center justify-between">
		<div>
			<h1 class="text-lg font-semibold tracking-tight">Events</h1>
			<p class="text-xs text-muted-foreground">Approve publish requests and review history.</p>
		</div>
		<div class="relative">
			<Button variant="outline" size="sm" onclick={() => (showActions = !showActions)}>
				<IconPlus class="h-3.5 w-3.5" /> New Action
			</Button>
			{#if showActions}
				<div
					role="menu"
					class="absolute right-0 top-10 z-20 w-72 overflow-hidden rounded-md border border-border bg-popover p-3 text-sm shadow-lg"
				>
					<div class="space-y-3">
						<div class="space-y-1.5">
							<div class="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><IconPackage class="h-3.5 w-3.5" /> Placeholder</div>
							<Input bind:value={placeholderName} placeholder="reserved-name" onkeydown={(e) => e.key === 'Enter' && createPlaceholder()} />
							<Button variant="outline" size="sm" class="w-full" onclick={createPlaceholder}>Create placeholder</Button>
						</div>
						<div class="space-y-1.5 border-t border-border pt-3">
							<div class="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><IconShield class="h-3.5 w-3.5" /> Trusted Publish</div>
							<Label class="sr-only" for="oidc-name">Package name</Label>
							<Input id="oidc-name" bind:value={oidcName} placeholder="@scope/pkg" onkeydown={(e) => e.key === 'Enter' && createOidc()} />
							<Input bind:value={oidcRepo} placeholder="owner/repo" onkeydown={(e) => e.key === 'Enter' && createOidc()} />
							<Input bind:value={oidcPath} placeholder="/path/to/package" onkeydown={(e) => e.key === 'Enter' && createOidc()} />
							<Button variant="brand" size="sm" class="w-full" onclick={createOidc}>Configure Trusted Publish</Button>
						</div>
						<div class="space-y-1.5 border-t border-border pt-3">
							<Button
								variant="ghost"
								size="sm"
								class="w-full justify-start px-0 text-muted-foreground hover:bg-transparent"
								onclick={() => {
									if ($daemon.defaultProfile) {
										actions.createEvent('refresh-token', { username: $daemon.defaultProfile });
									}
									showActions = false;
								}}
							>
								<IconRefresh class="h-3.5 w-3.5" /> Force-refresh token
							</Button>
							<Button variant="ghost" size="sm" class="w-full justify-start px-0 text-muted-foreground hover:bg-transparent" onclick={() => (showActions = false)}>
								Close
							</Button>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</header>

	{#if $pendingEvents.length > 0}
		<section class="space-y-2.5">
			<h2 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pending</h2>
			{#each $pendingEvents as event (event.id)}
				<EventCard {event} />
			{/each}
		</section>
	{/if}

	<section class="space-y-2.5">
		<h2 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">History</h2>
		{#if $historyEvents.length === 0 && $pendingEvents.length === 0}
			<div class="rounded-xl border border-dashed border-border p-10 text-center">
				<p class="text-sm text-muted-foreground">No events yet.</p>
				<p class="mt-1 text-xs text-muted-foreground/70">
					Run <code class="rounded bg-muted px-1 py-0.5 font-mono">pnpm-pub publish</code> in a project to trigger one.
				</p>
			</div>
		{:else}
			{#each $historyEvents as event (event.id)}
				<EventCard {event} />
			{/each}
		{/if}
	</section>
</div>
