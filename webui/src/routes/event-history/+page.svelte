<script lang="ts">
	/**
	 * Event History — the full, paginated, filterable event log.
	 *
	 * History events are grouped by groupId (only the latest in each group shows,
	 * with a +N more expander) and rendered in compact mode (single-line log that
	 * expands to a horizontally-scrollable block on click).
	 *
	 * Filter syntax: tokens prefixed with `name:` filter by package name; any
	 * other token is a free-text match against the event's kind/result/name.
	 */
	import { groupedHistoryEvents } from '$lib/store.js';
	import type { HistoryGroup } from '$lib/store.js';
	import type { PubEvent } from '$lib/types.js';
	import EventCard from '$lib/components/event-card.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import IconChevronDown from '@lucide/svelte/icons/chevron-down';
	import IconArrowLeft from '@lucide/svelte/icons/arrow-left';
	import IconChevronLeft from '@lucide/svelte/icons/chevron-left';
	import IconChevronRight from '@lucide/svelte/icons/chevron-right';
	import { _ } from 'svelte-i18n';

	const PAGE_SIZE = 20;

	let filterText = $state('');
	let page = $state(0);
	// Expanded collapsed groups (by group id).
	let expandedGroups = $state<Set<string>>(new Set());

	function toggleGroup(id: string): void {
		const next = new Set(expandedGroups);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expandedGroups = next;
	}

	/** Extract the package name from an event (publish / placeholder). */
	function eventName(e: PubEvent): string {
		const p = e.payload;
		if (p?.kind === 'publish') return p.data.target.name;
		if (p?.kind === 'create-placeholder') return p.data.name;
		return '';
	}

	/** Free-text haystack for an event. */
	function eventHaystack(e: PubEvent): string {
		return [e.kind, e.status, e.result ?? '', eventName(e)].join(' ').toLowerCase();
	}

	/** Parse `name:pkg keywords` into { name?: string, keywords: string[] }. */
	function parseFilter(text: string): { name: string | null; keywords: string[] } {
		const tokens = text.trim().split(/\s+/).filter(Boolean);
		let name: string | null = null;
		const keywords: string[] = [];
		for (const tok of tokens) {
			const m = tok.match(/^name:(.+)$/i);
			if (m) name = m[1]!.toLowerCase();
			else keywords.push(tok.toLowerCase());
		}
		return { name, keywords };
	}

	/** Filter a single group by the parsed filter. */
	function groupMatches(g: HistoryGroup, f: { name: string | null; keywords: string[] }): boolean {
		if (f.name) {
			// name filter: any member's package name must contain the term.
			const hit = g.events.some((e) => eventName(e).toLowerCase().includes(f.name!));
			if (!hit) return false;
		}
		if (f.keywords.length > 0) {
			const hit = g.events.some((e) => f.keywords.every((k) => eventHaystack(e).includes(k)));
			if (!hit) return false;
		}
		return true;
	}

	const parsedFilter = $derived(parseFilter(filterText));
	const filteredGroups = $derived(
		filterText.trim()
			? $groupedHistoryEvents.filter((g) => groupMatches(g, parsedFilter))
			: $groupedHistoryEvents,
	);

	// Pagination over filtered groups.
	const totalPages = $derived(Math.max(1, Math.ceil(filteredGroups.length / PAGE_SIZE)));
	const safePage = $derived(Math.min(page, totalPages - 1));
	const pagedGroups = $derived(filteredGroups.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE));

	// Reset to first page whenever the filter changes.
	let lastFilter = '';
	$effect(() => {
		if (filterText !== lastFilter) {
			lastFilter = filterText;
			page = 0;
		}
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

	<!-- Filter -->
	{#if filteredGroups.length > 0 || filterText.trim()}
		<Input bind:value={filterText} placeholder={$_('events.historyFilterPlaceholder')} />
	{/if}

	<!-- Grouped history (compact cards) -->
	{#if filteredGroups.length === 0}
		<div class="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
			{filterText.trim() ? $_('events.noFilterMatch') : $_('events.noEvents')}
		</div>
	{:else}
		<div class="space-y-2.5">
			{#each pagedGroups as group (group.id)}
				{#if group.collapsed && !expandedGroups.has(group.id)}
					<div class="space-y-1">
						<EventCard event={group.latest} variant="compact" />
						<button
							type="button"
							class="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
							onclick={() => toggleGroup(group.id)}
						>
							<IconChevronDown class="h-3 w-3" />
							{$_('eventCard.groupMore', { values: { n: group.events.length - 1 } })}
						</button>
					</div>
				{:else}
					{#if group.collapsed}
						<button
							type="button"
							class="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
							onclick={() => toggleGroup(group.id)}
						>
							<IconChevronDown class="h-3 w-3 rotate-180" />
							{$_('eventCard.collapse')}
						</button>
					{/if}
					{#each group.events as event (event.id)}
						<EventCard {event} variant="compact" />
					{/each}
				{/if}
			{/each}
		</div>

		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="flex items-center justify-between pt-1">
				<span class="text-[11px] text-muted-foreground">
					{$_('events.pageOf', { values: { page: safePage + 1, total: totalPages } })}
				</span>
				<div class="flex gap-1.5">
					<Button variant="outline" size="sm" disabled={safePage === 0} onclick={() => (page = safePage - 1)}>
						<IconChevronLeft class="h-3.5 w-3.5" /> {$_('events.prev')}
					</Button>
					<Button variant="outline" size="sm" disabled={safePage >= totalPages - 1} onclick={() => (page = safePage + 1)}>
						{$_('events.next')} <IconChevronRight class="h-3.5 w-3.5" />
					</Button>
				</div>
			</div>
		{/if}
	{/if}
</div>
