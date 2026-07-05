<script lang="ts">
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	type InputType = Exclude<HTMLInputTypeAttribute, 'file'>;

	type Props = WithElementRef<
		Omit<HTMLInputAttributes, 'type'> &
			({ type: 'file'; files?: FileList } | { type?: InputType; files?: undefined })
	>;

	let {
		ref = $bindable(null),
		value = $bindable(),
		type,
		files = $bindable(),
		class: className,
		'data-slot': dataSlot = 'input',
		...restProps
	}: Props = $props();
</script>

{#if type === 'file'}
	<input
		bind:this={ref}
		bind:files
		bind:value
		data-slot={dataSlot}
		type="file"
		class={cn(
			'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium',
			'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
			'disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
			// When nested inside an <InputGroup>, drop the input's own chrome — the
			// group owns the border/ring/shadow so the fused control looks unified.
			'[&[data-slot=input-group]_&]:border-0 [&[data-slot=input-group]_&]:shadow-none [&[data-slot=input-group]_&]:ring-0 [&[data-slot=input-group]_&]:focus-visible:ring-0',
			className,
		)}
		{...restProps}
	/>
{:else}
	<input
		bind:this={ref}
		bind:value
		data-slot={dataSlot}
		{type}
		class={cn(
			'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors',
			'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
			'disabled:cursor-not-allowed disabled:opacity-50',
			// When nested inside an <InputGroup>, drop the input's own chrome — the
			// group owns the border/ring/shadow so the fused control looks unified.
			'[&[data-slot=input-group]_&]:border-0 [&[data-slot=input-group]_&]:shadow-none [&[data-slot=input-group]_&]:ring-0 [&[data-slot=input-group]_&]:focus-visible:ring-0',
			className,
		)}
		{...restProps}
	/>
{/if}
