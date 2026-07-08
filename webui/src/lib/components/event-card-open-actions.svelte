<script lang="ts">
	/**
	 * EventCardOpenActions — the "click to open" action group: repo browse
	 * link, open-local-folder, and npm package link. Extracted out of
	 * EventCardHeader so it can live at the inline-end of the EventCardFooter
	 * (beside confirm / reject / retry / unpublish), where bottom action
	 * buttons conventionally gather.
	 *
	 * Renders BARE items (Tooltip-wrapped Buttons) with NO wrapping
	 * ButtonGroup — the host wraps these in its OWN independent ButtonGroup,
	 * isolated (via `justify-between`) from the status-driven action buttons so
	 * the open links read as a separate right-side cluster.
	 *
	 * Pure presentational — all values + callbacks come from the parent.
	 */
	import { Button } from '$lib/components/ui/button/index.js';
	import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/components/ui/tooltip/index.js';
	import RepoIcon from '$lib/components/repo-icon.svelte';
	import type { RepoInfo } from '$lib/components/repo-info-types.js';
	import IconPlaceholder from '@lucide/svelte/icons/package';
	import IconFolderOpen from '@lucide/svelte/icons/folder-open';
	import { _ } from 'svelte-i18n';

	type Props = {
		repoInfo: RepoInfo | null;
		sourcePath: string;
		npmUrl: string;
		onOpenUrl: (url: string) => void;
		onOpenPath: (path: string) => void;
	};

	let { repoInfo, sourcePath, npmUrl, onOpenUrl, onOpenPath }: Props = $props();
</script>

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
