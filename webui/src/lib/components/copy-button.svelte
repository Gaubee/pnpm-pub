<script lang="ts">
	/**
	 * CopyButton — a self-contained copy-to-clipboard icon button.
	 *
	 * Click copies `value` (a string, or a function/Promise returning one) to the
	 * OS clipboard, then swaps the icon to a checkmark for `feedbackMs` (default
	 * 1.5s) before reverting. A Tooltip labels the button and reflects the
	 * copied state ("Copied!" while the check is shown).
	 *
	 * Drop-in anywhere — including inside an `<InputGroup.Addon>` (the button
	 * keeps `variant="ghost"` by default and a compact `size`, matching the
	 * InputGroupButton look). The tooltip works because TooltipProvider is
	 * mounted globally in `+layout.svelte`.
	 */
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { cn } from '$lib/utils.js';
	import IconCopy from '@lucide/svelte/icons/copy';
	import IconCheck from '@lucide/svelte/icons/check';
	import { _ } from 'svelte-i18n';

	type Variant = 'ghost' | 'outline' | 'secondary' | 'brand';
	type Size = 'xs' | 'icon-xs' | 'icon-sm';

	let {
		value,
		label = $_('common.copy'),
		copiedLabel = $_('common.copied'),
		feedbackMs = 1500,
		variant = 'ghost',
		size = 'icon-xs',
		class: className,
		disabled = false,
		tabindex,
	}: {
		/** What to copy: a literal string, or a getter/Promise returning one. */
		value: string | (() => string | Promise<string>);
		/** Tooltip + aria-label for the idle (copy) state. */
		label?: string;
		/** Tooltip + aria-label shown while the check feedback is displayed. */
		copiedLabel?: string;
		/** How long the check icon stays after a successful copy. */
		feedbackMs?: number;
		variant?: Variant;
		size?: Size;
		class?: string;
		disabled?: boolean;
		tabindex?: number;
	} = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;

	async function onclick(): Promise<void> {
		const text = typeof value === 'function' ? await value() : value;
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				copied = false;
				timer = null;
			}, feedbackMs);
		} catch {
			/* clipboard may be unavailable (permissions / non-secure context) */
		}
	}

	const currentLabel = $derived(copied ? copiedLabel : label);
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
					// Match InputGroupButton sizing for the icon-* variants.
					size === 'icon-xs' && 'size-6 rounded-[calc(var(--radius)-3px)] p-0 has-[>svg]:p-0',
					size === 'icon-sm' && 'size-8 p-0 has-[>svg]:p-0',
					className,
				)}
			>
				{#if copied}
					<IconCheck class="size-4 text-success" />
				{:else}
					<IconCopy class="size-4" />
				{/if}
			</Button>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content>{currentLabel}</Tooltip.Content>
</Tooltip.Root>
