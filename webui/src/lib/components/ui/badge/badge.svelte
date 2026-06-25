<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	import { badgeVariants, type BadgeVariant } from './index.js';
	import { cn } from '$lib/utils.js';

	let {
		variant = 'default',
		class: className = undefined,
		children,
		...rest
	}: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant; children?: Snippet } = $props();
</script>

<span class={cn(badgeVariants({ variant }), className)} {...rest}>
	{@render children?.()}
</span>
