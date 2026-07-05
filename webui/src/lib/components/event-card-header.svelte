<script lang="ts">
	/**
	 * EventCardHeader — the top row of an EventCard: kind icon (+ status
	 * overlay), title, version + status badges, time, and a right-aligned
	 * action group (override chip, repo link, open-folder, npm link) plus an
	 * optional trailing slot.
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
	 *   - `headerTrailing`: extra content appended after the corner ButtonGroup
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
	import { Button } from '$lib/components/ui/button/index.js';
	import { ButtonGroup } from '$lib/components/ui/button-group/index.js';
	import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/components/ui/tooltip/index.js';
	import { cn } from '$lib/utils.js';
	import EventIconBadge from '$lib/components/event-icon-badge.svelte';
	import RepoIcon from '$lib/components/repo-icon.svelte';
	import type { RepoInfo } from '$lib/components/repo-info-types.js';
	import { avatarUrlFor } from '$lib/store.js';
	import IconClock from '@lucide/svelte/icons/clock';
	import IconPlaceholder from '@lucide/svelte/icons/package';
	import IconFolderOpen from '@lucide/svelte/icons/folder-open';
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
		/** Right-corner action group. */
		hasCornerActions: boolean;
		overrideActive: boolean;
		effectiveProfile: string;
		repoInfo: RepoInfo | null;
		sourcePath: string;
		npmUrl: string;
		onOpenUrl: (url: string) => void;
		onOpenPath: (path: string) => void;
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
		repoInfo,
		sourcePath,
		npmUrl,
		onOpenUrl,
		onOpenPath,
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
			<ButtonGroup>
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
				{#if repoInfo}
					<Tooltip>
						<TooltipTrigger>
							{#snippet child({ props })}
								<Button {...props} variant="outline" size="sm" onclick={() => onOpenUrl(repoInfo!.browseUrl)} class="gap-1 px-2 text-[11px]">
									<RepoIcon brand={repoInfo!.brand} faviconUrl={repoInfo!.faviconUrl} class="h-3.5 w-3.5" />
									<span class="max-w-[10rem] truncate">{repoInfo!.slug}</span>
								</Button>
							{/snippet}
						</TooltipTrigger>
						<TooltipContent class="max-w-sm break-all font-mono text-[10px]">{repoInfo.browseUrl}</TooltipContent>
					</Tooltip>
				{/if}
				{#if sourcePath}
					<Tooltip>
						<TooltipTrigger>
							{#snippet child({ props })}
								<Button {...props} variant="outline" size="icon-sm" onclick={() => onOpenPath(sourcePath)} aria-label={$_('eventCard.openFolder')}>
									<IconFolderOpen class="h-3.5 w-3.5" />
								</Button>
							{/snippet}
						</TooltipTrigger>
						<TooltipContent class="max-w-xs break-all font-mono text-[10px]">{sourcePath}</TooltipContent>
					</Tooltip>
				{/if}
				{#if npmUrl}
					<Tooltip>
						<TooltipTrigger>
							{#snippet child({ props })}
								<Button {...props} variant="outline" size="icon-sm" onclick={() => onOpenUrl(npmUrl)} aria-label={$_('eventCard.openOnNpm')}>
									<IconPlaceholder class="h-3.5 w-3.5" />
								</Button>
							{/snippet}
						</TooltipTrigger>
						<TooltipContent class="max-w-sm break-all font-mono text-[10px]">{npmUrl}</TooltipContent>
					</Tooltip>
				{/if}
			</ButtonGroup>
		{/if}
		{@render headerTrailing?.()}
	</div>
</div>
