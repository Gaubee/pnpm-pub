<!--
	TargetTarballDialog — opens when a recursive-publish target is clicked.
	Shows that target's prefetched file tree (computed by the daemon during the
	pending phase and stored on the event as a per-target summary) so the user
	can preview what will be packed without confirming the whole recursive
	publish. The data persists with the event (pending / resolved / history).

	Header mirrors the publish EventCard's left cluster (icon + name@version +
	a "Tarball contents" badge); body is the TarballTree; footer intentionally
	empty (display-only). No RPC: the summary is passed in already computed.
-->
<script lang="ts">
	import type { PublishTarget, TarballSummary } from '$lib/types.js';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
	} from '$lib/components/ui/dialog/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import TarballTree from './tarball-tree.svelte';
	import IconPackage from '@lucide/svelte/icons/package';
	import IconFolder from '@lucide/svelte/icons/folder';
	import IconChevronRight from '@lucide/svelte/icons/chevron-right';
	import { _ } from 'svelte-i18n';

	let {
		open = $bindable(false),
		target = null,
		summary = null,
	}: {
		open?: boolean;
		target?: PublishTarget | null;
		summary?: TarballSummary | null;
	} = $props();

	// Accordion expansion state for the tarball contents (default collapsed, same
	// as the EventCard's inline accordion). Re-seed closed whenever a different
	// target is opened.
	let showFiles = $state(false);
	$effect(() => {
		void target?.path;
		showFiles = false;
	});

	function humanSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
	}
</script>

<Dialog bind:open>
	<DialogContent
		class="flex max-h-[min(100dvh,40rem)] w-[min(100%,44rem)] flex-col gap-0 overflow-hidden p-0"
		aria-describedby={undefined}
	>
		{#if target}
			<!-- Header: mirror the publish EventCard left cluster. The visible
			     name@version is also the DialogTitle (a11y). -->
			<DialogHeader class="flex-row items-center gap-2.5 border-b px-4 py-3">
				<DialogTitle>
					{#snippet child({ props })}
						<div {...props} class="flex min-w-0 items-center gap-2.5">
							<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
								<IconPackage class="h-4 w-4" />
							</div>
							<span class="truncate text-sm font-semibold">{target.name}</span>
							<Badge variant="outline" class="h-5 font-mono text-[10px]">@{target.version}</Badge>
						</div>
					{/snippet}
				</DialogTitle>
			</DialogHeader>

			<!-- Body: reuse the EventCard's tarball accordion verbatim. It is a
			     self-contained block that manages its own scroll region
			     (`max-h-56 overflow-auto`) ONLY when expanded; collapsed, the body
			     is just a single header row. This avoids the nested/double
			     scrollbar that appeared in Safari when the dialog body itself
			     scrolled and the tree had its own overflow. -->
			<div class="min-h-0 flex-1 overflow-y-auto p-3">
				{#if summary}
					<div class="rounded-md border border-border">
						<button
							type="button"
							class="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
							onclick={() => (showFiles = !showFiles)}
						>
							<IconChevronRight class="h-3 w-3 transition-transform {showFiles ? 'rotate-90' : ''}" />
							<IconFolder class="h-3 w-3" />
							<span>{$_('eventCard.tarballContents')}</span>
							<span class="ml-auto font-mono text-muted-foreground/70">
								{$_('eventCard.tarballSummary', { values: { n: summary.files.length, size: humanSize(summary.unpackedSize) } })}
							</span>
						</button>
						{#if showFiles}
							<div class="max-h-56 overflow-auto border-t border-border px-2 py-1.5">
								<TarballTree files={summary.files} />
							</div>
						{/if}
					</div>
				{:else}
					<div class="px-1 py-10 text-center text-[11px] italic text-muted-foreground/70">
						{$_('eventCard.tarballLoading')}
					</div>
				{/if}
			</div>
		{/if}
	</DialogContent>
</Dialog>
