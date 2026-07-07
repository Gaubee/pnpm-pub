<!--
	RecursiveTargetList — the multi-package list shown on a recursive-publish
	EventCard, as a collapsible accordion. Pending events default open (the user
	is about to confirm and wants to see what will publish); resolved events
	default collapsed (the list is reference-only).
-->
<script lang="ts">
	import type { PublishTarget, TarballSummary } from '$lib/types.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import IconChevronRight from '@lucide/svelte/icons/chevron-right';
	import IconLayers from '@lucide/svelte/icons/layers';
	import IconFolder from '@lucide/svelte/icons/folder';
	import IconLoader from '@lucide/svelte/icons/loader-circle';
	import { _ } from 'svelte-i18n';
	import { untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { flipParams, enterParams, leaveParams } from '$lib/transitions.js';
	import TargetTarballDialog from './target-tarball-dialog.svelte';

	interface Props {
		targets: PublishTarget[];
		/** Per-target tarball summaries prefetched by the daemon and stored on
		 *  the event (so the preview persists after resolve / across history). */
		summaries?: { name: string; version: string; summary: TarballSummary }[];
		/** Whether the parent event is still pending (controls default expansion). */
		pending?: boolean;
	}
	let { targets, summaries = [], pending = false }: Props = $props();

	// Intentionally capture only the INITIAL value of `pending` — once the user
	// toggles the accordion, subsequent status changes must not override them.
	let open = $state(untrack(() => pending));

	// Per-target tarball preview dialog. Clicking a target row opens it.
	let previewTarget: PublishTarget | null = $state(null);
	let previewOpen = $state(false);

	function openPreview(t: PublishTarget): void {
		previewTarget = t;
		previewOpen = true;
	}

	/** Look up the prefetched summary for a target (matched by name@version). */
	function summaryFor(t: PublishTarget): TarballSummary | null {
		const hit = summaries.find((s) => s.name === t.name && s.version === t.version);
		return hit ? hit.summary : null;
	}
</script>

<div class="rounded-md border border-border">
	<button
		type="button"
		class="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
		onclick={() => (open = !open)}
		aria-expanded={open}
	>
		<IconChevronRight class="h-3 w-3 transition-transform {open ? 'rotate-90' : ''}" />
		<IconLayers class="h-3 w-3" />
		<span>{$_('eventCard.publishTargets', { values: { count: targets.length } })}</span>
	</button>
	{#if open}
		{#if targets.length === 0}
			<div class="border-t border-border px-3 py-2 text-[11px] italic text-muted-foreground/70">
				{$_('eventCard.noTargets')}
			</div>
		{:else}
				<ul class="max-h-40 overflow-auto border-t border-border px-3 py-1.5 text-xs">
					{#each targets as t, i (t.path)}
						{@const sum = summaryFor(t)}
						{@const loading = !sum && pending}
						<li animate:flip={flipParams} in:fade|global={enterParams(i)} out:fade|global={leaveParams}>
							<button
								type="button"
								disabled={!sum}
								onclick={() => sum && openPreview(t)}
								title={sum ? $_('eventCard.tarballPreviewTitle', { values: { name: t.name } }) : $_('eventCard.tarballLoading')}
								class="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
							>
								{#if loading}
									<IconLoader class="h-3 w-3 shrink-0 animate-spin text-muted-foreground/60" />
								{:else}
									<IconFolder class="h-3 w-3 shrink-0 text-muted-foreground/60" />
								{/if}
								<span class="truncate font-mono">{t.name}</span>
								<Badge variant="outline" class="ml-auto shrink-0 font-mono text-[10px]">@{t.version}</Badge>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>

<TargetTarballDialog
	bind:open={previewOpen}
	target={previewTarget}
	summary={previewTarget ? summaryFor(previewTarget) : null}
/>
