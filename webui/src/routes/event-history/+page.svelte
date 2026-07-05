<script lang="ts">
	/**
	 * Event History — the full, paginated, filterable event log.
	 *
	 * Data is fetched from the daemon via `events.query` with server-side
	 * pagination + filtering, so large logs don't load entirely into memory.
	 * Live new events arrive over `state.subscribe`; while the user is browsing
	 * a page, a sticky "N new" tip appears and clicking it reloads from page 1.
	 *
	 * History cards render in compact mode (single-line log → horizontal scroll).
	 * Events sharing a groupId collapse to the latest member + a "+N more" toggle.
	 */
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { flipParams, enterParams, leaveParams } from '$lib/transitions.js';
	import { daemon, getRpcClient } from '$lib/store.js';
	import type { PubEvent } from '$lib/types.js';
	import { groupEvents, type EventGroup } from '$lib/group-event.js';
	import EventCard from '$lib/components/event-card.svelte';
	import GroupEventCard from '$lib/components/group-event-card.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import IconArrowLeft from '@lucide/svelte/icons/arrow-left';
	import IconChevronLeft from '@lucide/svelte/icons/chevron-left';
	import IconChevronRight from '@lucide/svelte/icons/chevron-right';
	import IconBellRing from '@lucide/svelte/icons/bell-ring';
	import { _ } from 'svelte-i18n';

	const PAGE_SIZE = 20;

	let filterText = $state('');
	let page = $state(0);
	let groups = $state<EventGroup[]>([]);
	let total = $state(0);
	let loading = $state(true);
	// Timestamp of the newest event the user has seen; events newer than this
	// (arriving via WS) count as unread.
	let lastSeenCreatedAt = $state(0);
	let newCount = $state(0);
	let listTopEl: HTMLDivElement | undefined = $state();

	const totalPages = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));

	async function fetchEvents(): Promise<void> {
		loading = true;
		try {
			const json = await getRpcClient()?.events.query({
				scope: 'history',
				page,
				limit: PAGE_SIZE,
				q: filterText.trim(),
			});
			if (!json) throw new Error('events unavailable');
			groups = groupEvents(json.rows);
			total = json.total;
			// Mark the newest visible event as "seen".
			if (json.rows.length > 0) {
				const newest = json.rows.reduce((m, e) => (e.createdAt > m ? e.createdAt : m), 0);
				lastSeenCreatedAt = newest;
			}
			newCount = 0;
		} catch {
			groups = [];
			total = 0;
		} finally {
			loading = false;
		}
	}

	function jumpToTop(): void {
		page = 0;
	}

	// Reset to page 0 + refetch whenever the filter changes (debounced).
	let filterTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		void filterText;
		clearTimeout(filterTimer);
		filterTimer = setTimeout(() => {
			page = 0;
			void fetchEvents();
		}, 300);
	});

	// Refetch when the page changes.
	$effect(() => {
		void page;
		// Skip the initial fetch (onMount handles it) — only react to page changes.
		if (!firstLoadDone) return;
		void fetchEvents();
	});

	// Track unread events arriving over WS (status != pending, newer than seen).
	let firstLoadDone = false;
	$effect(() => {
		const events = $daemon.events;
		if (!firstLoadDone) return;
		let count = 0;
		for (const e of events) {
			if (e.status !== 'pending' && e.createdAt > lastSeenCreatedAt) count += 1;
		}
		newCount = count;
	});

	function handleNewMessageClick(): void {
		page = 0;
		void fetchEvents().then(() => {
			listTopEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		});
	}

	onMount(() => {
		firstLoadDone = false;
		void fetchEvents().then(() => {
			firstLoadDone = true;
		});
	});
</script>

<svelte:head><title>{$_('events.history')} · pnpm-pub</title></svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-4 p-6">
	<!-- Back + title -->
	<div class="flex items-center gap-3">
		<a href="/active-events" class="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
			<IconArrowLeft class="h-3.5 w-3.5" /> {$_('sidebar.activeEvents')}
		</a>
	</div>
	<h1 class="text-lg font-semibold tracking-tight">{$_('events.history')}</h1>

	<!-- New-message tip -->
	{#if newCount > 0}
		<button
			type="button"
			class="sticky top-0 z-10 flex items-center justify-center gap-2 rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-xs font-medium text-brand transition-colors hover:bg-brand/20"
			onclick={handleNewMessageClick}
		>
			<IconBellRing class="h-3.5 w-3.5" />
			{$_('events.newMessages', { values: { n: newCount } })}
		</button>
	{/if}

	<!-- Filter -->
	{#if groups.length > 0 || filterText.trim()}
		<Input bind:value={filterText} placeholder={$_('events.historyFilterPlaceholder')} />
	{/if}

	<div bind:this={listTopEl}></div>

	<!-- Loading skeleton -->
	{#if loading}
		<div class="space-y-2.5">
			{#each Array(5) as _, i (i)}
				<div class="space-y-2 rounded-xl border border-border p-4">
					<div class="flex items-center gap-2">
						<Skeleton class="h-8 w-8 rounded-md" />
						<div class="flex-1 space-y-1.5">
							<Skeleton class="h-3.5 w-32" />
							<Skeleton class="h-2.5 w-20" />
						</div>
						<Skeleton class="h-5 w-16 rounded-full" />
					</div>
					<Skeleton class="h-9 w-full rounded-md" />
				</div>
			{/each}
		</div>
	{:else if groups.length === 0}
		<!-- Empty state -->
		<div class="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
			{filterText.trim() ? $_('events.noFilterMatch') : $_('events.noEvents')}
		</div>
	{:else}
		<!-- Grouped history (compact cards) -->
			<div class="space-y-2.5">
			{#each groups as group, i (group.id)}
				<div animate:flip={flipParams} in:fade|global={enterParams(i)} out:fade|global={leaveParams}>
					{#if group.isGroup}
						<GroupEventCard group={group} surface="history" />
					{:else}
						<EventCard event={group.latest} variant="compact" />
					{/if}
				</div>
			{/each}
		</div>

		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="flex items-center justify-between pt-1">
				<span class="text-[11px] text-muted-foreground">
					{$_('events.pageOf', { values: { page: page + 1, total: totalPages } })}
				</span>
				<div class="flex gap-1.5">
					<Button variant="outline" size="sm" disabled={page === 0} onclick={() => (page = page - 1)}>
						<IconChevronLeft class="h-3.5 w-3.5" /> {$_('events.prev')}
					</Button>
					<Button variant="outline" size="sm" disabled={page >= totalPages - 1} onclick={() => (page = page + 1)}>
						{$_('events.next')} <IconChevronRight class="h-3.5 w-3.5" />
					</Button>
				</div>
			</div>
		{/if}
	{/if}
</div>
