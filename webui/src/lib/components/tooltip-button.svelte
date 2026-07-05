<script lang="ts">
	/**
	 * TooltipButton — an icon button with a shadcn Tooltip label.
	 *
	 * Wraps the shared `<Button>` in `<Tooltip>` so the label appears on hover
	 * (the native `title` attribute is unreliable in the opentray webview and
	 * can't be styled). Designed for icon-only action buttons; for text buttons
	 * a tooltip is usually redundant. Works standalone and inside an
	 * `<InputGroup.Addon>`.
	 */
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import type { Snippet } from 'svelte';
	import type { ComponentProps } from 'svelte';
	import { cn } from '$lib/utils.js';

	type ButtonProps = ComponentProps<typeof Button>;
	type Variant = NonNullable<ButtonProps['variant']>;
	// icon-* and xs sizes are the meaningful ones for icon buttons here.
	type IconSize = 'xs' | 'icon-xs' | 'icon-sm';

	let {
		label,
		side = 'top',
		variant = 'ghost',
		size = 'icon-xs',
		class: className,
		disabled = false,
		tabindex,
		onclick,
		children,
		...rest
	}: {
		label: string;
		side?: 'top' | 'bottom' | 'left' | 'right';
		variant?: Variant;
		size?: IconSize;
		class?: string;
		disabled?: boolean;
		tabindex?: number;
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
	} & Omit<ButtonProps, 'variant' | 'size' | 'class' | 'onclick' | 'children'> = $props();
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				{...rest}
				type="button"
				{variant}
				data-size={size}
				aria-label={label}
				{disabled}
				{tabindex}
				{onclick}
				class={cn(
					size === 'icon-xs' && 'size-6 rounded-[calc(var(--radius)-3px)] p-0 has-[>svg]:p-0',
					size === 'icon-sm' && 'size-8 p-0 has-[>svg]:p-0',
					className,
				)}
			>
				{@render children?.()}
			</Button>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content {side}>{label}</Tooltip.Content>
</Tooltip.Root>
