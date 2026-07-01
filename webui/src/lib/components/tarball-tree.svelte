<script lang="ts">
	/**
	 * Tarball file-tree preview — renders a flat list of {path, size} entries as
	 * a collapsible nested tree (directories auto-derived from `/` separators).
	 * Directories collapse by default; the user expands them on demand.
	 *
	 * Self-recursive: a directory node renders <TarballTree node={child} /> for
	 * each subdirectory. The root accepts `files` and builds the tree; nested
	 * invocations receive a pre-built `node`.
	 */
	import type { TarballFile } from '$lib/types.js';
	import IconChevronRight from '@lucide/svelte/icons/chevron-right';
	import IconFolder from '@lucide/svelte/icons/folder';
	import IconFile from '@lucide/svelte/icons/file';
	import TarballTree from './tarball-tree.svelte';

	export interface DirNode {
		name: string;
		dirs: Map<string, DirNode>;
		files: { name: string; size: number }[];
	}

	let { files = undefined, node = undefined }: { files?: TarballFile[]; node?: DirNode } = $props();

	function buildTree(entries: TarballFile[]): DirNode {
		const root: DirNode = { name: '', dirs: new Map(), files: [] };
		for (const entry of entries) {
			// npm tarballs nest everything under `package/`; strip it so the tree
			// reflects the package contents directly.
			const clean = entry.path.replace(/^package\//, '');
			const parts = clean.split('/');
			let cur = root;
			for (let i = 0; i < parts.length - 1; i++) {
				const part = parts[i]!;
				let child = cur.dirs.get(part);
				if (!child) {
					child = { name: part, dirs: new Map(), files: [] };
					cur.dirs.set(part, child);
				}
				cur = child;
			}
			cur.files.push({ name: parts[parts.length - 1]!, size: entry.size });
		}
		return root;
	}

	// Root invocation builds the tree from `files`; nested invocations use `node`.
	const resolved = $derived(node ?? (files ? buildTree(files) : { name: '', dirs: new Map(), files: [] }));
	const sortedDirs = $derived([...resolved.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)));
	const sortedFiles = $derived(resolved.files.slice().sort((a, b) => a.name.localeCompare(b.name)));
	const dirTotalSize = $derived.by(() => {
		let total = 0;
		const walk = (n: DirNode): void => {
			for (const f of n.files) total += f.size;
			for (const d of n.dirs.values()) walk(d);
		};
		walk(resolved);
		return total;
	});

	// Each instance owns its own expansion state. Root starts collapsed too,
	// but since the root has no name/chevron it renders its children directly.
	let expanded = $state(false);

	function humanSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
	}

	// Whether this is the root node (no name) — renders without a chevron row.
	const isRoot = $derived(!node);
</script>

{#if isRoot}
	<!-- Root: render directories + files directly (no toggle row). -->
	{#each sortedDirs as d (d.name)}
		<TarballTree node={d} />
	{/each}
	{#each sortedFiles as f (f.name)}
		<div class="flex items-center gap-1.5 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
			<IconFile class="h-3 w-3 shrink-0 text-muted-foreground/60" />
			<span class="truncate">{f.name}</span>
			<span class="ml-auto shrink-0 text-muted-foreground/50">{humanSize(f.size)}</span>
		</div>
	{/each}
{:else}
	<div>
		<button
			type="button"
			class="flex w-full items-center gap-1.5 px-1.5 py-0.5 text-left font-mono text-[11px] text-foreground/90 transition-colors hover:bg-muted/50"
			onclick={() => (expanded = !expanded)}
		>
			<IconChevronRight class="h-3 w-3 shrink-0 transition-transform {expanded ? 'rotate-90' : ''}" />
			<IconFolder class="h-3 w-3 shrink-0 text-muted-foreground/70" />
			<span class="truncate">{resolved.name}</span>
			<span class="ml-auto shrink-0 text-muted-foreground/50">{humanSize(dirTotalSize)}</span>
		</button>
		{#if expanded}
			<div class="ml-3 border-l border-border/60 pl-1">
				{#each sortedDirs as d (d.name)}
					<TarballTree node={d} />
				{/each}
				{#each sortedFiles as f (f.name)}
					<div class="flex items-center gap-1.5 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
						<IconFile class="h-3 w-3 shrink-0 text-muted-foreground/60" />
						<span class="truncate">{f.name}</span>
						<span class="ml-auto shrink-0 text-muted-foreground/50">{humanSize(f.size)}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
