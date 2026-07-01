<script lang="ts">
	/**
	 * Active Events — the default home surface.
	 *
	 * Shows pending events (full, expanded EventCards) plus the proactive
	 * "New Action" menu. When nothing is pending, a preview of recent history
	 * (latest few events) is shown with a link to the full /event-history page.
	 *
	 * Unlike the old layout, this page NEVER locks navigation — pending tasks
	 * are surfaced via the sidebar badge, and the user is free to navigate away.
	 */
	import { pendingEvents, groupedHistoryEvents, daemon } from '$lib/store.js';
	import EventCard from '$lib/components/event-card.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import OidcDialog from '$lib/components/oidc-dialog.svelte';
	import { actions } from '$lib/store.js';
	import IconPlus from '@lucide/svelte/icons/plus';
	import IconPackage from '@lucide/svelte/icons/package';
	import IconShield from '@lucide/svelte/icons/shield-check';
	import IconRefresh from '@lucide/svelte/icons/refresh-cw';
	import IconHistory from '@lucide/svelte/icons/history';
	import IconArrowRight from '@lucide/svelte/icons/arrow-right';
	import { _ } from 'svelte-i18n';

	let actionsOpen = $state(false);
	let placeholderName = $state('');
	// OIDC 配置走专属对话框（输入包名后打开），不再在菜单里堆裸表单字段。
	let oidcName = $state('');
	let oidcDialogOpen = $state(false);

	// Preview-history: the latest few groups (collapsed view, full logs).
	const PREVIEW_COUNT = 5;
	const previewGroups = $derived($groupedHistoryEvents.slice(0, PREVIEW_COUNT));

	function createPlaceholder(): void {
		const name = placeholderName.trim();
		if (!name) return;
		actions.createEvent('create-placeholder', { name });
		actionsOpen = false;
		placeholderName = '';
	}

	function openOidcDialog(): void {
		if (!oidcName.trim()) return;
		actionsOpen = false;
		oidcDialogOpen = true;
	}

	function forceRefreshToken(): void {
		if ($daemon.defaultProfile) {
			actions.createEvent('refresh-token', { username: $daemon.defaultProfile });
		}
		actionsOpen = false;
	}
</script>

<svelte:head><title>{$_('events.title')}</title></svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-5 p-6">
	<header class="flex items-center justify-between">
		<div>
			<h1 class="text-lg font-semibold tracking-tight">{$_('events.heading')}</h1>
			<p class="text-xs text-muted-foreground">{$_('events.intro')}</p>
		</div>
		<DropdownMenu.Root bind:open={actionsOpen}>
			<DropdownMenu.Trigger>
				<Button variant="outline" size="sm">
					<IconPlus class="h-3.5 w-3.5" /> {$_('events.newAction')}
				</Button>
			</DropdownMenu.Trigger>
			<DropdownMenu.Content class="w-72 p-3" align="end" sideOffset={4}>
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
							onclick={forceRefreshToken}
						>
							<IconRefresh class="h-3.5 w-3.5" /> {$_('events.forceRefreshToken')}
						</Button>
					</div>
				</div>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</header>

	<!-- Pending (active) events — full, expanded -->
	{#if $pendingEvents.length > 0}
		<section class="space-y-2.5">
			<h2 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{$_('events.pending')}</h2>
			{#each $pendingEvents as event (event.id)}
				<EventCard {event} />
			{/each}
		</section>
	{/if}

	<!-- Preview history: recent activity when nothing (or even while something) is pending -->
	<section class="space-y-2.5">
		<div class="flex items-center justify-between">
			<h2 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{$_('events.previewHistory')}</h2>
			<a href="/event-history" class="inline-flex items-center gap-1 text-[11px] text-brand transition-colors hover:opacity-80">
				{$_('events.viewAllHistory')} <IconArrowRight class="h-3 w-3" />
			</a>
		</div>
		{#if previewGroups.length === 0}
			<div class="rounded-xl border border-dashed border-border p-10 text-center">
				<p class="text-sm text-muted-foreground">{$_('events.noEvents')}</p>
				<p class="mt-1 text-xs text-muted-foreground/70">
					{$_('events.runPublishHint', { values: { command: 'pnpm-pub publish' } })}
				</p>
			</div>
		{:else}
			{#each previewGroups as group (group.id)}
				<EventCard event={group.latest} />
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
