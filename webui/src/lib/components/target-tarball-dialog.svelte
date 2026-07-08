<!--
	TargetTarballDialog — opens when a recursive-publish target is clicked.
	Shows that target's prefetched file tree (computed by the daemon during the
	pending phase and stored on the event as a per-target summary) so the user
	can preview what will be packed without confirming the whole recursive
	publish. The data persists with the event (pending / resolved / history).

	Header mirrors the publish EventCard's left cluster (icon + name@version +
	a "Tarball contents" badge); body is the TarballTree, expanded by default
	(the whole point of opening this dialog is to inspect the files). Footer
	holds the same right-side ButtonGroup of "click to open" actions the
	EventCard uses (repo / folder / npm), isolated at the inline-end.
-->
<script lang="ts">
	import type { PublishTarget, TarballSummary } from '$lib/types.js';
	import {
		Dialog,
		DialogContent,
		DialogFooter,
		DialogHeader,
		DialogTitle,
	} from '$lib/components/ui/dialog/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { ButtonGroup } from '$lib/components/ui/button-group/index.js';
	import TarballTree from './tarball-tree.svelte';
	import EventCardOpenActions from './event-card-open-actions.svelte';
	import type { RepoInfo } from './repo-info-types.js';
	import { actions } from '$lib/store.js';
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

	// Accordion expansion state for the tarball contents. DEFAULT EXPANDED: the
	// user opened this dialog specifically to see the file tree, so collapse the
	// header row only as an opt-out. Re-seed open whenever a different target is
	// opened.
	let showFiles = $state(true);
	$effect(() => {
		void target?.path;
		showFiles = true;
	});

	function humanSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
	}

	// --- Footer open-actions: resolve repo / folder / npm for THIS target ---
	// Mirrors the EventCard assembler's corner-action derivation, narrowed to a
	// single PublishTarget. repoInfo is async-resolved + cached by the store.
	let repoInfo = $state<RepoInfo | null>(null);
	const repoRaw = $derived(target?.repository ?? '');
	$effect(() => {
		if (!repoRaw) {
			repoInfo = null;
			return;
		}
		void actions.repoInfo(repoRaw).then((info) => {
			repoInfo = info;
		});
	});
	// The local package directory (open-folder). Recursive-publish targets each
	// carry their own path.
	const sourcePath = $derived(target?.path ?? '');
	// npm registry link. Pending targets aren't on the registry yet, so always
	// link to the package landing page (matches EventCard's pending behavior).
	const packageName = $derived(target?.name ?? '');
	const npmUrl = $derived(packageName ? `https://www.npmjs.com/package/${packageName}` : '');
	const hasOpenActions = $derived(!!repoInfo || !!sourcePath || !!npmUrl);

	function onOpenUrl(url: string): void {
		void actions.openUrl(url);
	}
	function onOpenPath(path: string): void {
		void actions.openPath(path);
	}
</script>

<Dialog bind:open>
	<!-- Height is a MAX, not fixed: `max-h` lets the dialog shrink to its
	     content when the file tree is small, while the grid's middle row only
	     scrolls once it would otherwise exceed the cap. -->
	<DialogContent
		class="grid max-h-[min(100dvh,40rem)] w-[min(100%,44rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
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

			<!-- Body: the tarball contents, expanded by default. Collapsing the
			     header row tucks the tree away; the dialog body still scrolls. -->
			<div class="min-h-0 overflow-y-auto p-3">
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

			<!-- Footer: the right-side ButtonGroup of "click to open" actions,
			     isolated at the inline-end (mirrors the EventCard footer's right
			     cluster). Omitted entirely when the target carries no repo/folder/
			     npm context. DialogFooter's default negative margins + muted bg
			     assume a p-4 DialogContent; this dialog uses p-0, so they are
			     reset here while keeping its sm:justify-end (right alignment). -->
			{#if hasOpenActions}
				<DialogFooter class="mx-0 mb-0 rounded-none bg-transparent px-4 py-3">
					<ButtonGroup>
						<EventCardOpenActions {repoInfo} {sourcePath} {npmUrl} {onOpenUrl} {onOpenPath} />
					</ButtonGroup>
				</DialogFooter>
			{/if}
		{/if}
	</DialogContent>
</Dialog>
