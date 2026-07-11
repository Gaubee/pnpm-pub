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
	import { untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { flipParams, enterParams, leaveParams } from '$lib/transitions.js';
	import { pendingEvents, visibleEvents } from '$lib/store.js';
	import { daemon, getRpcClient } from '$lib/store.js';
	import type { PubEvent } from '$lib/types.js';
	import { groupEvents, hasGroupEvents, materializeEventGroup, type EventGroup } from '$lib/group-event.js';
	import EventCard from '$lib/components/event-card.svelte';
	import GroupEventCard from '$lib/components/group-event-card.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import TrustedPublishingDialog from '$lib/components/trusted-publishing-dialog.svelte';
	import { actions } from '$lib/store.js';
	import { validateNpmPackageName } from '$shared/package-name.js';
	import IconPlus from '@lucide/svelte/icons/plus';
	import IconPackage from '@lucide/svelte/icons/package';
	import IconShieldCog from '@lucide/svelte/icons/shield-cog-corner';
	import IconHistory from '@lucide/svelte/icons/history';
	import IconArrowRight from '@lucide/svelte/icons/arrow-right';
	import { _ } from 'svelte-i18n';

	let actionsOpen = $state(false);
	let placeholderName = $state('');
	const placeholderValidation = $derived(validateNpmPackageName(placeholderName));
	const placeholderNamePresent = $derived(placeholderName.length > 0);
	const placeholderNameValid = $derived(placeholderNamePresent && placeholderValidation.valid);
	const placeholderNameError = $derived(placeholderValidation.errors[0] ?? 'Invalid npm package name.');
	// Trusted Publishing 配置走专属对话框（输入包名后打开），不再在菜单里堆裸表单字段。
	let trustedPublishingName = $state('');
	let trustedPublishingDialogOpen = $state(false);

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

	// Pending events + held (recently-resolved) events, newest-first, then
	// collapsed by groupId into EventGroups. Standalone events (no groupId)
	// form single-member groups (isGroup === false) rendered as plain EventCards.
	//
	// GROUP COMPLETENESS: if a group has even ONE pending member, the WHOLE
	// group is shown — including its resolved (success/failed/…) members — so
	// the user sees the batch's full state (e.g. 3 pending + 2 already-succeeded
	// in the same configure-trust run). We pull resolved siblings from
	// $daemon.events by groupId; events with no groupId (standalone) only
	// surface here when pending or held.
	const surfaceGroups = $derived.by((): EventGroup[] => {
		const seeds = [...$pendingEvents, ...held.values()];
		// Collect every groupId that has a pending/held seed.
		const activeGroupIds = new Set<string>();
		for (const e of seeds) {
			if (e.groupId) activeGroupIds.add(e.groupId);
		}
		// Pull in ALL members of those active groups (resolved siblings too)
		// from the profile-filtered visible set, so cross-profile siblings
		// don't leak into this surface.
		const merged: PubEvent[] = [];
		for (const e of $visibleEvents) {
			if (e.groupId && activeGroupIds.has(e.groupId)) {
				merged.push(e);
			}
		}
		// Add back the standalone (no groupId) seeds that aren't group members.
		for (const e of seeds) {
			if (!e.groupId) merged.push(e);
		}
		merged.sort((a, b) => b.createdAt - a.createdAt);
		return groupEvents(merged);
	});

	// Smooth-scroll to the top when a new event appears at the top of the list
	// (a fresh pending publish, or a newly-held resolved event). We watch the
	// newest event's id — when it changes, a new card landed at the top.
	let prevTopId = '';
	let prevTopIdWasSet = false;
	$effect(() => {
		const top = surfaceGroups[0]?.latest;
		const topId = top?.id ?? '';
		if (topId === prevTopId) return;
		// Skip the very first run (the list may already have content from a
		// reconnect — don't yank the viewport on mount).
		if (!prevTopIdWasSet) { prevTopIdWasSet = true; prevTopId = topId; return; }
		prevTopId = topId;
		window.scrollTo({ top: 0, behavior: 'smooth' });
	});



	// Preview-history: the latest few GROUPS, fetched directly from the daemon
	// as grouped history so a single large batch still occupies one slot.
	const PREVIEW_GROUP_COUNT = 5;
	let previewGroups = $state<EventGroup[]>([]);
	let previewLoading = $state(true);

	async function fetchPreview(): Promise<boolean> {
		previewLoading = true;
		const client = getRpcClient();
		if (!client) return false;
		try {
			const json = await client.events.queryHistoryGroups({
				page: 0,
				limit: PREVIEW_GROUP_COUNT,
				q: '',
			});
			previewGroups = json.groups.filter(hasGroupEvents).map(materializeEventGroup);
			return true;
		} catch {
			previewGroups = [];
			return false;
		} finally {
			if (client === getRpcClient()) previewLoading = false;
		}
	}

	let previewLoaded = false;
	$effect(() => {
		const connected = $daemon.connected;
		if (!connected || previewLoaded) return;
		void fetchPreview().then((ok) => {
			if (ok) previewLoaded = true;
		});
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
		const connected = $daemon.connected;
		const now = lastResolvedAt;
		// Only re-fetch when the signal actually advances (a new resolution).
		// The first grouped preview load is handled by the connection-gated
		// effect above, so this path only handles later live updates.
		if (!connected || now === prevResolvedAt) return;
		prevResolvedAt = now;
		if (now === 0) return;
		void fetchPreview();
	});

	function createPlaceholder(): void {
		if (!placeholderNameValid) return;
		actions.createEvent('create-placeholder', {
			name: placeholderValidation.name,
			args: ['--access', 'public'],
		});
		actionsOpen = false;
		placeholderName = '';
	}

	function updatePlaceholderName(value: string): void {
		placeholderName = value.toLowerCase();
	}

	function openTrustedPublishingDialog(): void {
		if (!trustedPublishingName.trim()) return;
		actionsOpen = false;
		trustedPublishingDialogOpen = true;
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
			<DropdownMenu.Content class="w-80 p-3" align="end" sideOffset={4}>
				<div class="space-y-3">
					<div class="space-y-1.5">
						<div class="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><IconPackage class="h-3.5 w-3.5" /> {$_('events.placeholder')}</div>
						<Label class="sr-only" for="placeholder-package-name">{$_('events.packageName')}</Label>
						<Input
							id="placeholder-package-name"
							value={placeholderName}
							placeholder={$_('events.placeholderName')}
							aria-invalid={placeholderNamePresent && !placeholderNameValid}
							aria-describedby={placeholderNamePresent && !placeholderNameValid ? 'placeholder-package-name-error' : undefined}
							oninput={(e) => updatePlaceholderName(e.currentTarget.value)}
							onkeydown={(e) => e.key === 'Enter' && createPlaceholder()}
						/>
						{#if placeholderNamePresent && !placeholderNameValid}
							<p id="placeholder-package-name-error" class="text-[11px] text-destructive">{placeholderNameError}</p>
						{/if}
						<Button variant="outline" size="sm" class="w-full" disabled={!placeholderNameValid} onclick={createPlaceholder}>{$_('events.createPlaceholder')}</Button>
					</div>
					<div class="space-y-1.5 border-t border-border pt-3">
							<div class="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><IconShieldCog class="h-3.5 w-3.5" /> {$_('events.trustedPublish')}</div>
						<Label class="sr-only" for="trusted-publishing-name">{$_('events.packageName')}</Label>
						<Input id="trusted-publishing-name" bind:value={trustedPublishingName} placeholder={$_('events.packageScopePlaceholder')} onkeydown={(e) => e.key === 'Enter' && openTrustedPublishingDialog()} />
						<Button variant="brand" size="sm" class="w-full" disabled={!trustedPublishingName.trim()} onclick={openTrustedPublishingDialog}>{$_('events.configureTrustedPublish')}</Button>
					</div>
				</div>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</header>

	<!-- Pending (active) + recently-resolved (lingering) events — grouped by
	     groupId. Multi-member groups render as a GroupEventCard (unified form +
	     batch confirm); single-member groups render as a plain EventCard. -->
	{#if surfaceGroups.length > 0}
		<section class="space-y-2.5">
			<h2 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{$_('events.pending')}</h2>
			{#each surfaceGroups as g, i (g.id)}
				<div id="event-{g.id}" animate:flip={flipParams} in:fade|global={enterParams(i)} out:fade|global={leaveParams}>
				{#if g.isGroup}
					<GroupEventCard
						group={g}
						surface="pending"
						autoClose={g.events.some((e) => held.has(e.id))}
						onAutoClose={() => { for (const e of g.events) if (held.has(e.id)) dismiss(e.id); }}
					/>
				{:else}
					<EventCard
						event={g.latest}
						autoClose={held.has(g.latest.id)}
						onAutoClose={() => dismiss(g.latest.id)}
					/>
				{/if}
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
		{:else if previewGroups.length === 0}
			<div class="rounded-xl border border-dashed border-border p-10 text-center">
				<p class="text-sm text-muted-foreground">{$_('events.noEvents')}</p>
				<p class="mt-1 text-xs text-muted-foreground/70">
					{$_('events.runPublishHint', { values: { command: 'pnpm-pub publish' } })}
				</p>
			</div>
		{:else}
			{#each previewGroups as g, i (g.id)}
				<div id="event-{g.id}" animate:flip={flipParams} in:fade|global={enterParams(i)} out:fade|global={leaveParams}>
				{#if g.isGroup}
					<GroupEventCard group={g} surface="history" />
				{:else}
					<EventCard event={g.latest} />
				{/if}
				</div>
			{/each}
		{/if}
	</section>
</div>

<!-- Trusted Publishing 配置对话框（从 New Action 菜单触发）。 -->
<TrustedPublishingDialog
	bind:open={trustedPublishingDialogOpen}
	packageName={trustedPublishingName.trim()}
	config={null}
	onChanged={() => {}}
/>
