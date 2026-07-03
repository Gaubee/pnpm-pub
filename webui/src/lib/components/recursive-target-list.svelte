<!--
	RecursiveTargetList — the multi-package list shown on a recursive-publish
	EventCard, as a collapsible accordion. Pending events default open (the user
	is about to confirm and wants to see what will publish); resolved events
	default collapsed (the list is reference-only).
-->
<script lang="ts">
	import type { PublishTarget } from '$lib/types.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import IconChevronRight from '@lucide/svelte/icons/chevron-right';
	import IconLayers from '@lucide/svelte/icons/layers';
	import { _ } from 'svelte-i18n';
	import { untrack } from 'svelte';

	interface Props {
		targets: PublishTarget[];
		/** Whether the parent event is still pending (controls default expansion). */
		pending?: boolean;
	}
	let { targets, pending = false }: Props = $props();

	// Intentionally capture only the INITIAL value of `pending` — once the user
	// toggles the accordion, subsequent status changes must not override them.
	let open = $state(untrack(() => pending));
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
				{#each targets as t (t.path)}
					<li class="flex items-center gap-2 py-0.5">
						<span class="truncate font-mono">{t.name}</span>
						<Badge variant="outline" class="ml-auto shrink-0 font-mono text-[10px]">@{t.version}</Badge>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>
