<script lang="ts">
	/**
	 * EventCardHeader — the top row of an EventCard: kind icon (+ status
	 * overlay), title, version + status badges, time, and a right-aligned
	 * identity chip (a cross-profile override indicator) plus an optional
	 * trailing slot.
	 *
	 * The "click to open" actions (repo link, open-folder, npm link) USED to
	 * live here; they have moved to the EventCardFooter's inline-end so all
	 * bottom action buttons (confirm / reject / retry / unpublish + the open
	 * links) gather in one place. See EventCardOpenActions.
	 *
	 * Pure presentational — no business logic. All derived values are passed in
	 * from the EventCard assembler. The header is shell-agnostic: it renders
	 * only its inner content; the surrounding CardHeader / DialogHeader wrapper
	 * is supplied by the parent (EventCard) so the same content can fuse into
	 * either a Card or a Dialog without duplication.
	 *
	 * Composition slots (Svelte 5 snippets):
	 *   - `titleLabel`: wraps the visible title text. In Card mode it's a plain
	 *     <span>; in Dialog mode the host wraps it in a <DialogTitle> so the
	 *     visible title IS the accessible name (no duplicate sr-only label).
	 *   - `headerTrailing`: extra content appended after the corner chip
	 *     on the same row (e.g. the Dialog's Inherit/Custom segmented toggle).
	 */
	import type { Component, Snippet } from 'svelte';
	import type {
		ConfigureTrustContext,
		EventStatus,
		PubEvent,
		PublishContext,
		PublishTarget,
		RecursivePublishContext,
		UnpublishContext,
	} from '$lib/types.js';
	import type { BadgeVariant } from '$lib/components/ui/badge/index.js';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/components/ui/tooltip/index.js';
	import { cn } from '$lib/utils.js';
	import EventIconBadge from '$lib/components/event-icon-badge.svelte';
	import { avatarUrlFor } from '$lib/store.js';
	import IconClock from '@lucide/svelte/icons/clock';
	import { _ } from 'svelte-i18n';

type Props = {
	event: PubEvent;
	iconCmp: Component;
	kindIconClass: string;
	kindIconColor: string;
	status: EventStatus;
	statusVariant: BadgeVariant;
	statusLabel: string;
	timeLabel: string;
	/** Primary display name + version source. */
	titleName: string;
	version: string;
	/** Whether the rejected-status badge should host a result tooltip. */
	rejectedWithResult: boolean;
	/** Right-corner identity chip. Only the cross-profile override chip
	 *  remains here (identity context); the open actions moved to the footer. */
	hasCornerActions: boolean;
	overrideActive: boolean;
	effectiveProfile: string;
	/** Composition slots — see component doc. */
	titleLabel?: Snippet<[{ child: Snippet }]>;
	headerTrailing?: Snippet;
	/** Extra classes for the header's root row. The dialog host uses this to
	 *  reserve space (e.g. `pr-9`) so its content clears the absolutely
	 *  positioned close button baked into DialogContent. Card mode passes
	 *  nothing. */
	class?: string;
};

let {
	event,
	iconCmp,
	kindIconClass,
	kindIconColor,
	status,
	statusVariant,
	statusLabel,
	timeLabel,
	titleName,
	version,
	rejectedWithResult,
	hasCornerActions,
	overrideActive,
	effectiveProfile,
	titleLabel,
	headerTrailing,
	class: className,
}: Props = $props();

	const isPending = $derived(status === 'pending');

	const initials = (n: string): string =>
		n.split(/[\s_-]+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
</script>

<!-- The visible styled title as a snippet, so the host can optionally wrap it
     (e.g. in a <DialogTitle> for a11y) without duplicating the markup. Default
     (Card) mode renders it bare; Dialog mode passes `titleLabel`, which wraps
     {@render child()} in <DialogTitle>. -->
{#snippet titleText()}
	<span class="truncate text-sm font-semibold">{titleName}</span>
{/snippet}

<div class={cn('flex min-w-0 items-center justify-between gap-3', className)}>
	<div class="flex min-w-0 items-center gap-2.5">
		<EventIconBadge icon={iconCmp} tileClass={kindIconClass} iconColor={kindIconColor} {status} />
		<div class="min-w-0">
			<div class="flex items-center gap-2">
				{#if titleLabel}
					{@render titleLabel({ child: titleText })}
				{:else}
					{@render titleText()}
				{/if}
				{#if version}
					<Badge variant="outline" class="h-5 font-mono text-[10px]">@{version}</Badge>
				{/if}
				{#if rejectedWithResult}
					<Tooltip>
						<TooltipTrigger>
							{#snippet child({ props })}
								<Badge {...props} variant={statusVariant} class="h-5 capitalize cursor-help">
									{statusLabel}
								</Badge>
							{/snippet}
						</TooltipTrigger>
						<TooltipContent class="max-w-sm text-[11px]">{event.result}</TooltipContent>
					</Tooltip>
				{:else}
					<Badge variant={statusVariant} class="h-5 capitalize">
						{#if isPending}<IconClock class="mr-1 h-3 w-3" />{/if}
						{statusLabel}
					</Badge>
				{/if}
			</div>
			<div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
				<IconClock class="h-3 w-3" /> {timeLabel}
				{#if event.clockDriftRecovered}
					<span class="ml-1 text-warning">· {$_('eventCard.driftRecovered')}</span>
				{/if}
			</div>
		</div>
	</div>

	<div class="flex items-center gap-2">
		{#if hasCornerActions}
			<!-- Only the identity chip remains in the header corner. The repo /
			     open-folder / npm-link "open" actions have moved to the
			     EventCardFooter (inline-end), beside the confirm / retry buttons. -->
			{#if overrideActive}
				<!-- Cross-profile event: show whose identity it runs under. -->
				<div data-slot="button" class="inline-flex h-7 items-center gap-1.5 border border-warning/60 bg-warning/10 px-2 text-[11px] font-medium text-foreground">
					<Avatar class="h-4 w-4">
						{#if effectiveProfile}
							<AvatarImage src={avatarUrlFor(effectiveProfile)} alt={effectiveProfile} />
						{/if}
						<AvatarFallback class="text-[8px]">{initials(effectiveProfile)}</AvatarFallback>
					</Avatar>
					<span class="max-w-[6rem] truncate">{effectiveProfile}</span>
				</div>
			{/if}
		{/if}
		{@render headerTrailing?.()}
	</div>
</div>
