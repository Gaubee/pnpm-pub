<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	let { class: className = undefined, children, ...rest }: HTMLAttributes<HTMLDivElement> & { children?: Snippet } = $props();
</script>

<div class={cn('rounded-xl border border-border bg-card text-card-foreground shadow-sm', className)} {...rest}>
	{@render children?.()}
</div>
