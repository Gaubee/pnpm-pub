<script lang="ts">
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	import { buttonVariants, type ButtonSize, type ButtonVariant } from './index.js';
	import { cn } from '$lib/utils.js';

	type Props = {
		variant?: ButtonVariant;
		size?: ButtonSize;
		href?: string;
		class?: string;
		children?: Snippet;
	} & (HTMLButtonAttributes | HTMLAnchorAttributes);

	let {
		variant = 'default',
		size = 'default',
		href = undefined,
		class: className = undefined,
		children,
		...rest
	}: Props = $props();
</script>

{#if href}
	<a {href} class={cn(buttonVariants({ variant, size }), className)} {...rest as HTMLAnchorAttributes}>
		{@render children?.()}
	</a>
{:else}
	<button class={cn(buttonVariants({ variant, size }), className)} {...rest as HTMLButtonAttributes}>
		{@render children?.()}
	</button>
{/if}
