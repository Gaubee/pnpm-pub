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
	import { onMount, untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { flipParams, enterParams, leaveParams } from '$lib/transitions.js';
	import { pendingEvents } from '$lib/store.js';
	import { daemon } from '$lib/store.js';
	import { apiFetch } from '$lib/api-fetch.js';
	import type { PubEvent } from '$lib/types.js';
	import EventCard from '$lib/components/event-card.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import OidcDialog from '$lib/components/oidc-dialog.svelte';
	import { actions } from '$lib/store.js';
	import IconPlus from '@lucide/svelte/icons/plus';
	import IconPackage from '@lucide/svelte/icons/package';
	import IconShield from '@lucide/svelte/icons/shield-check';
	import IconHistory from '@lucide/svelte/icons/history';
	import IconArrowRight from '@lucide/svelte/icons/arrow-right';
	import { _ } from 'svelte-i18n';

	let actionsOpen = $state(false);
	let placeholderName = $state('');
	// OIDC 配置走专属对话框（输入包名后打开），不再在菜单里堆裸表单字段。
	let oidcName = $state('');
	let oidcDialogOpen = $state(false);

	// Resolved events briefly linger at the top so the user can see the result
	// (success/failed) instead of having it vanish to history instantly.
	//
	// `seenPendingIds` / `handled` are deliberately NON-reactive: they only track
	// the pending→resolved transition and must not drive (nor re-trigger) the
	// effect. Only `held` is `$state` because it drives the rendered card list.
	const seenPendingIds = new Set<string>();
	const handled = new Set<string>();
	let held = $state<Map<string, PubEvent>>(new Map());

	function dismiss(id: string): void {
		handled.add(id);
		if (!held.has(id)) return;
		const next = new Map(held);
		next.delete(id);
		held = next;
	}

	$effect(() => {
		// Remember every id we've ever observed as pending.
		for (const e of $pendingEvents) seenPendingIds.add(e.id);

		// Snapshot any freshly-resolved id we previously saw as pending (and
		// haven't handled yet) into `held` so it lingers at the top.
		const toAdd: PubEvent[] = [];
		for (const e of $daemon.events) {
			if (e.status === 'pending') continue;
			if (handled.has(e.id)) continue;
			if (seenPendingIds.has(e.id)) {
				handled.add(e.id);
				toAdd.push(e);
			}
		}
		// Update `held` without establishing a dependency on it inside this
		// effect (read+write of the same state would loop forever).
		if (toAdd.length > 0) {
			held = untrack(() => {
				const next = new Map(held);
				for (const e of toAdd) next.set(e.id, e);
				return next;
			});
		}
	});

	// Pending events + held (recently-resolved) events, newest-first.
	const surfaceEvents = $derived.by(() => {
		const merged = [...$pendingEvents, ...held.values()];
		return merged.sort((a, b) => b.createdAt - a.createdAt);
	});

	// Smooth-scroll to the top when a new event appears at the top of the list
	// (a fresh pending publish, or a newly-held resolved event). We watch the
	// newest event's id — when it changes, a new card landed at the top.
	let prevTopId = '';
	let prevTopIdWasSet = false;
	$effect(() => {
		const top = surfaceEvents[0];
		const topId = top?.id ?? '';
		if (topId === prevTopId) return;
		// Skip the very first run (the list may already have content from a
		// reconnect — don't yank the viewport on mount).
		if (!prevTopIdWasSet) { prevTopIdWasSet = true; prevTopId = topId; return; }
		prevTopId = topId;
		window.scrollTo({ top: 0, behavior: 'smooth' });
	});

	// Preview-history: the latest few events, fetched from the daemon (REST).
	const PREVIEW_COUNT = 5;
	let previewEvents = $state<PubEvent[]>([]);
	let previewLoading = $state(true);

	async function fetchPreview(): Promise<void> {
		previewLoading = true;
		try {
			const res = await apiFetch(`/api/events?scope=history&page=0&limit=${PREVIEW_COUNT}`);
			const json = (await res.json()) as { rows: PubEvent[] };
			previewEvents = json.rows;
		} catch {
			previewEvents = [];
		} finally {
			previewLoading = false;
		}
	}

	onMount(() => {
		void fetchPreview();
	});

	// Live-refresh RECENT ACTIVITY. The daemon pushes every event change over the
	// WS (store emit → broadcast), which updates `$daemon.events` in real time.
	// We watch the latest resolvedAt timestamp as a reactive signal: whenever an
	// event resolves (pending → success/failed/…), the signal changes and we
	// re-fetch the preview so a freshly-published package shows up immediately.
	const lastResolvedAt = $derived(
		$daemon.events.reduce((max, e) => {
			const t = e.resolvedAt;
			return typeof t === 'number' && t > max ? t : max;
		}, 0),
	);
	let prevResolvedAt = 0;
	$effect(() => {
		const now = lastResolvedAt;
		// Only re-fetch when the signal actually advances (a new resolution).
		// The initial fetch is handled by onMount, so skip the first effect run.
		if (now === prevResolvedAt) return;
		prevResolvedAt = now;
		if (now === 0) return;
		void fetchPreview();
	});

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
				</div>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</header>

	<!-- Pending (active) + recently-resolved (lingering) events — full, expanded -->
	{#if surfaceEvents.length > 0}
		<section class="space-y-2.5">
			<h2 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{$_('events.pending')}</h2>
			{#each surfaceEvents as event, i (event.id)}
				<div animate:flip={flipParams} in:fade|global={enterParams(i)} out:fade|global={leaveParams}>
				<EventCard
					{event}
					autoClose={held.has(event.id)}
					onAutoClose={() => dismiss(event.id)}
				/>
				</div>
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
		{#if previewLoading}
			<div class="space-y-2.5">
				{#each Array(3) as _, i (i)}
					<div class="space-y-2 rounded-xl border border-border p-4">
						<div class="flex items-center gap-2">
							<Skeleton class="h-8 w-8 rounded-md" />
							<div class="flex-1 space-y-1.5">
								<Skeleton class="h-3.5 w-32" />
								<Skeleton class="h-2.5 w-20" />
							</div>
							<Skeleton class="h-5 w-16 rounded-full" />
						</div>
					</div>
				{/each}
			</div>
		{:else if previewEvents.length === 0}
			<div class="rounded-xl border border-dashed border-border p-10 text-center">
				<p class="text-sm text-muted-foreground">{$_('events.noEvents')}</p>
				<p class="mt-1 text-xs text-muted-foreground/70">
					{$_('events.runPublishHint', { values: { command: 'pnpm-pub publish' } })}
				</p>
			</div>
		{:else}
			{#each previewEvents as event, i (event.id)}
				<div animate:flip={flipParams} in:fade|global={enterParams(i)} out:fade|global={leaveParams}>
				<EventCard {event} />
				</div>
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
