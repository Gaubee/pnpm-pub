<script lang="ts">
	/**
	 * DownloadButton — a self-contained download icon button.
	 *
	 * Mirrors CopyButton: click builds a Blob from `value` (a string, or a
	 * getter/Promise returning one) and triggers a download via the standard
	 * blob-anchor mechanism. When the page runs inside an opentray host that
	 * owns the `~/Downloads` write, the host emits a `downloadcompleted` event
	 * on `navigator.opentrayWindow`; this component listens for it and surfaces
	 * a Dynamic Island success notification carrying an "Open file" action that
	 * opens the downloaded file via `actions.openPath`.
	 *
	 * The completion listener is installed ONCE per component lifetime and
	 * reconciles the last-triggered download with the next completion event
	 * (the host doesn't currently echo a page-supplied id, so we match on the
	 * recency window + filename when possible).
	 */
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { cn } from '$lib/utils.js';
	import { notify } from '$lib/notify.js';
	import { actions } from '$lib/store.js';
	import IconDownload from '@lucide/svelte/icons/download';
	import IconCheck from '@lucide/svelte/icons/check';
	import IconFileText from '@lucide/svelte/icons/file-text';
	import { _ } from 'svelte-i18n';
	import { onMount } from 'svelte';
	import type { OpentrayDownloadCompletedEvent } from '../../opentray.d.ts';

	type Variant = 'ghost' | 'outline' | 'secondary' | 'brand';
	type Size = 'xs' | 'icon-xs' | 'icon-sm';

	let {
		value,
		filename,
		mime = 'application/octet-stream',
		label = $_('common.download'),
		doneLabel,
		feedbackMs = 1500,
		variant = 'brand',
		size = 'icon-xs',
		class: className,
		disabled = false,
		tabindex,
		onDownloaded,
	}: {
		/** File contents: a literal string, or a getter/Promise returning one. */
		value: string | (() => string | Promise<string>);
		/** Suggested filename (the host may rename on collision). */
		filename: string;
		/** MIME type for the Blob. Default `application/octet-stream`. */
		mime?: string;
		/** Tooltip + aria-label for the idle state. */
		label?: string;
		/** Optional override for the post-download tooltip (defaults to label). */
		doneLabel?: string;
		feedbackMs?: number;
		variant?: Variant;
		size?: Size;
		class?: string;
		disabled?: boolean;
		tabindex?: number;
		/** Optional callback after the download is triggered. */
		onDownloaded?: (filename: string) => void;
	} = $props();

	let done = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;

	// Track the most recent trigger so the completion listener can reconcile.
	let pendingFilename: string | null = null;
	let pendingAt = 0;

	const bridge = (): Navigator['opentrayWindow'] | undefined =>
		navigator.opentrayWindow ?? navigator.opentray?.window ?? undefined;

	onMount(() => {
		const win = bridge();
		const handler = (e: OpentrayDownloadCompletedEvent): void => {
			onDownloadCompleted(e);
		};
		win?.addEventListener?.('downloadcompleted', handler);
		return () => win?.removeEventListener?.('downloadcompleted', handler);
	});

	function onDownloadCompleted(e: OpentrayDownloadCompletedEvent): void {
		const p = e.payload;
		// Only react to a completion that matches a trigger we issued (within a
		// generous recency window). The host may rename on collision, so we
		// accept either our suggested name or any completion shortly after.
		const recent = Date.now() - pendingAt < 30_000;
		if (!recent || !p.success) return;
		const downloadedName = p.filename ?? pendingFilename ?? filename;

		notify({
			tone: 'success',
			message: $_('download.success', { values: { filename: downloadedName } }),
			icon: IconCheck,
			durationMs: 8000,
			action: {
				label: $_('download.openFile'),
				icon: IconFileText,
				run: () => {
					void actions.openPath(`~/Downloads/${downloadedName}`);
				},
			},
		});
		pendingFilename = null;
	}

	async function onclick(): Promise<void> {
		const text = typeof value === 'function' ? await value() : value;
		if (!text) return;
		// Trigger the download. In an opentray host the native layer intercepts
		// the anchor navigation and writes to ~/Downloads itself; in a plain
		// browser this is the legacy blob-anchor download.
		const blob = new Blob([text], { type: mime });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.rel = 'noopener';
		document.body.appendChild(a);
		a.click();
		a.remove();
		// Revoke lazily so the host (which may read the blob URL) has time.
		setTimeout(() => URL.revokeObjectURL(url), 60_000);

		pendingFilename = filename;
		pendingAt = Date.now();
		done = true;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			done = false;
			timer = null;
		}, feedbackMs);
		onDownloaded?.(filename);
	}

	const currentLabel = $derived(done ? (doneLabel ?? label) : label);
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				type="button"
				{variant}
				data-size={size}
				aria-label={currentLabel}
				{disabled}
				{tabindex}
				onclick={onclick}
				class={cn(
					size === 'icon-xs' && 'size-6 rounded-[calc(var(--radius)-3px)] p-0 has-[>svg]:p-0',
					size === 'icon-sm' && 'size-8 p-0 has-[>svg]:p-0',
					className,
				)}
			>
				<IconDownload class="size-4" />
			</Button>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content>{currentLabel}</Tooltip.Content>
</Tooltip.Root>
