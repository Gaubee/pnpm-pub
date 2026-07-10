<script lang="ts">
	/**
	 * TrustedPublishingReadonly — read-only display of a Trusted Publisher
	 * config, in one of three variants chosen by `mode`:
	 *
	 *   - `compact`   : a single line of provider + value chips. Each chip's
	 *                   Tooltip carries its label (and help text, if any).
	 *                   Container-query responsive: at very narrow widths
	 *                   GitHub/GitLab drop the owner and keep only the repo
	 *                   name. CircleCI is special — its compact mode shows
	 *                   ONLY the "Version Control System Origin", because the
	 *                   other fields are opaque UUIDs that read poorly inline.
	 *   - `multiline` : one `Label: Value` row per field.
	 *   - `detailed`  : multiline + each field's help description, mirroring the
	 *                   visual style of the edit form (TrustedPublishingDraftForm).
	 *
	 * === Variant placement (decision rationale — keep in sync with spec/06.md) ===
	 *   - WorkspaceDetail → OIDC dialog      : `multiline`
	 *       Rationale: the viewer's main goal is to SEE what's configured, and a
	 *       dialog gives ample room, so a multi-line scan beats a one-liner.
	 *   - EventDialog (configure-trust)      : `detailed`
	 *       Rationale: the user may edit next, so understanding each field's
	 *       purpose before expanding the form is valuable — render descriptions.
	 *   - everywhere else (lists, table rows): `compact`
	 *       Rationale: outside a dialog you're in a list, and list items must
	 *       stay short, so render on a single line.
	 *
	 * Field metadata is shared with the edit form via
	 * $lib/trusted-publishing.ts so the two never drift.
	 */
	import type { TrustedPublisherConfig, TrustedPublisherCreateConfig } from '$lib/types.js';
	import { cn } from '$lib/utils.js';
	import {
		extractTrustedPublishingValues,
		providerLabelKey,
		TRUSTED_PUBLISHING_FIELDS,
		type TrustedPublishingFieldDescriptor,
	} from '$lib/trusted-publishing.js';
	import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/components/ui/tooltip/index.js';
	import { _ } from 'svelte-i18n';

	type Mode = 'compact' | 'multiline' | 'detailed';

	let {
		config,
		mode = 'compact',
		class: className,
	}: {
		config: TrustedPublisherConfig | TrustedPublisherCreateConfig | null | undefined;
		mode?: Mode;
		class?: string;
	} = $props();

	/** Normalized field values for the active config. */
	const values = $derived(config ? extractTrustedPublishingValues(config) : null);
	/** Field descriptors for the active provider. */
	const fields = $derived(config ? TRUSTED_PUBLISHING_FIELDS[config.type] : []);

	/**
	 * Compact-mode field selection. CircleCI shows ONLY vcsOrigin (its other
	 * fields are opaque UUIDs); GitHub/GitLab show every populated field.
	 */
	const compactFields = $derived.by((): readonly TrustedPublishingFieldDescriptor[] => {
		if (!config) return [];
		if (config.type === 'circleci') {
			return fields.filter((f) => f.key === 'vcsOrigin');
		}
		return fields;
	});

	/** Field rows for multiline / detailed: every populated field, in order. */
	const populatedFields = $derived.by((): readonly TrustedPublishingFieldDescriptor[] => {
		if (!values) return [];
		return fields.filter((f) => (values[f.key] ?? '').trim() !== '');
	});

	function valueOf(field: TrustedPublishingFieldDescriptor): string {
		return values?.[field.key] ?? '';
	}
</script>

{#if !values}
	<span class={cn('text-[11px] text-muted-foreground/50', className)}>{$_('trustedPublishing.notConfigured')}</span>
{:else if mode === 'compact'}
	<!--
		Compact: provider name + value chips on one line. Each chip is a Tooltip
		whose content is `Label: Value` (+ help text when available). Container-
		query responsive: at very narrow widths GitHub/GitLab drop the owner
		(keep repo name only); CircleCI already collapses to vcsOrigin above.
	-->
	<div class={cn('@container flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]', className)}>
		<span class="shrink-0 font-medium text-foreground">{$_(providerLabelKey(config!.type))}</span>
		{#each compactFields as field, i (field.id)}
			{@const val = valueOf(field)}
			{#if val}
				{#if i > 0}<span class="text-muted-foreground/40">·</span>{/if}
				<Tooltip>
					<TooltipTrigger>
						{#snippet child({ props })}
							<span
								{...props}
								class="max-w-[12rem] truncate font-mono text-muted-foreground {field.key ===
								'repoOwner'
									? '@max-[20rem]:hidden'
									: ''}"
							>
								{val}
							</span>
						{/snippet}
					</TooltipTrigger>
					<TooltipContent class="max-w-xs text-[11px]">
						<div class="flex flex-col gap-0.5">
							<span><span class="text-muted-foreground">{$_(field.labelKey)}:</span> <span class="break-all font-mono">{val}</span></span>
							{#if field.helpKey}<span class="text-[10px] leading-snug text-muted-foreground/80">{$_(field.helpKey)}</span>{/if}
						</div>
					</TooltipContent>
				</Tooltip>
			{/if}
		{/each}
	</div>
{:else}
	<!--
		Multiline / detailed. Multiline = one Label: Value row per field.
		Detailed adds the help description under each row and wraps everything in
		the same bg-muted/20 card the edit form uses, so the two feel parallel.
	-->
	<dl
		class={cn(
			'flex flex-col gap-1.5 text-xs',
			mode === 'detailed' && 'rounded-md border border-border bg-muted/20 p-3',
			className,
		)}
	>
		{#each populatedFields as field (field.id)}
			{@const val = valueOf(field)}
			<div class="flex flex-col gap-0.5">
				<div class="flex min-w-0 flex-wrap items-baseline gap-x-2">
					<dt class="shrink-0 text-muted-foreground">{$_(field.labelKey)}</dt>
					<dd class="min-w-0 break-all font-mono">{val}</dd>
				</div>
				{#if mode === 'detailed' && field.helpKey}
					<p class="text-[10px] leading-snug text-muted-foreground/70">{$_(field.helpKey)}</p>
				{/if}
			</div>
		{/each}
	</dl>
{/if}
