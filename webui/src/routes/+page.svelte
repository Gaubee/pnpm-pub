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
	import OidcDialog from '$lib/components/oidc-dialog.svelte';
	import { actions } from '$lib/store.js';
	import IconPlus from '@lucide/svelte/icons/plus';
	import IconPackage from '@lucide/svelte/icons/package';
	import IconShield from '@lucide/svelte/icons/shield-check';
	import IconRefresh from '@lucide/svelte/icons/refresh-cw';
	import { _ } from 'svelte-i18n';

	let showActions = $state(false);
	let placeholderName = $state('');
	// OIDC 配置走专属对话框（输入包名后打开），不再在菜单里堆裸表单字段。
	let oidcName = $state('');
	let oidcDialogOpen = $state(false);

	function createPlaceholder(): void {
		const name = placeholderName.trim();
		if (!name) return;
		actions.createEvent('create-placeholder', { name });
		showActions = false;
		placeholderName = '';
	}

	function openOidcDialog(): void {
		if (!oidcName.trim()) return;
		showActions = false;
		oidcDialogOpen = true;
	}
</script>

<svelte:head><title>{$_('events.title')}</title></svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-5 p-6">
	<header class="flex items-center justify-between">
		<div>
			<h1 class="text-lg font-semibold tracking-tight">{$_('events.heading')}</h1>
			<p class="text-xs text-muted-foreground">{$_('events.intro')}</p>
		</div>
		<div class="relative">
			<Button variant="outline" size="sm" onclick={() => (showActions = !showActions)}>
				<IconPlus class="h-3.5 w-3.5" /> {$_('events.newAction')}
			</Button>
			{#if showActions}
				<div
					role="menu"
					class="absolute right-0 top-10 z-20 w-72 overflow-hidden rounded-md border border-border bg-popover p-3 text-sm shadow-lg"
				>
					<div class="space-y-3">
						<div class="space-y-1.5">
							<div class="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><IconPackage class="h-3.5 w-3.5" /> {$_('events.placeholder')}</div>
							<Input bind:value={placeholderName} placeholder={$_('events.placeholderName')} onkeydown={(e) => e.key === 'Enter' && createPlaceholder()} />
							<Button variant="outline" size="sm" class="w-full" onclick={createPlaceholder}>{$_('events.createPlaceholder')}</Button>
						</div>
						<div class="space-y-1.5 border-t border-border pt-3">
							<div class="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><IconShield class="h-3.5 w-3.5" /> {$_('events.trustedPublish')}</div>
							<Label class="sr-only" for="oidc-name">{$_('events.packageName')}</Label>
							<Input id="oidc-name" bind:value={oidcName} placeholder={$_('events.packageScopePlaceholder')} onkeydown={(e) => e.key === 'Enter' && openOidcDialog()} />
							<Button variant="brand" size="sm" class="w-full" disabled={!oidcName.trim()} onclick={openOidcDialog}>{$_('events.configureTrustedPublish')}</Button>
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
								<IconRefresh class="h-3.5 w-3.5" /> {$_('events.forceRefreshToken')}
							</Button>
							<Button variant="ghost" size="sm" class="w-full justify-start px-0 text-muted-foreground hover:bg-transparent" onclick={() => (showActions = false)}>
								{$_('common.close')}
							</Button>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</header>

	{#if $pendingEvents.length > 0}
		<section class="space-y-2.5">
			<h2 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{$_('events.pending')}</h2>
			{#each $pendingEvents as event (event.id)}
				<EventCard {event} />
			{/each}
		</section>
	{/if}

	<section class="space-y-2.5">
		<h2 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{$_('events.history')}</h2>
		{#if $historyEvents.length === 0 && $pendingEvents.length === 0}
			<div class="rounded-xl border border-dashed border-border p-10 text-center">
				<p class="text-sm text-muted-foreground">{$_('events.noEvents')}</p>
				<p class="mt-1 text-xs text-muted-foreground/70">
					{$_('events.runPublishHint', { values: { command: 'pnpm-pub publish' } })}
				</p>
			</div>
		{:else}
			{#each $historyEvents as event (event.id)}
				<EventCard {event} />
			{/each}
		{/if}
	</section>
</div>

<!-- OIDC Trusted Publishing 配置对话框（从 New Action 菜单触发）。 -->
<OidcDialog
	bind:open={oidcDialogOpen}
	packageName={oidcName.trim()}
	config={null}
	onChanged={() => {}}
/>
