<script lang="ts">
	/**
	 * Event card — the unit of the Events Hub (Chapter 6.2).
	 * Renders a Pending (with Diff + Confirm/Reject), Success, Failed, or
	 * Expired event. Honors context-override (Chapter 5.4.5 / 6.2.2).
	 */
	import type { EventStatus, PubEvent, PublishTarget } from '$lib/types.js';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar/index.js';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader } from '$lib/components/ui/card/index.js';
	import { actions, daemon } from '$lib/store.js';
	import IconPublish from '@lucide/svelte/icons/upload';
	import IconOidc from '@lucide/svelte/icons/shield-check';
	import IconPlaceholder from '@lucide/svelte/icons/package';
	import IconRefresh from '@lucide/svelte/icons/refresh-cw';
	import IconArrowRight from '@lucide/svelte/icons/arrow-right';
	import IconClock from '@lucide/svelte/icons/clock';
	import IconCheck from '@lucide/svelte/icons/check';
	import IconX from '@lucide/svelte/icons/x';

	let { event }: { event: PubEvent } = $props();

	const STATUS_VARIANTS = {
		pending: 'brand',
		success: 'success',
		failed: 'destructive',
		expired: 'warning',
		'action-required': 'warning',
		rejected: 'secondary',
	} satisfies Record<EventStatus, NonNullable<BadgeVariant>>;

	const iconFor = (kind: PubEvent['kind']) =>
		({
			publish: IconPublish,
			'setup-oidc': IconOidc,
			'create-placeholder': IconPlaceholder,
			'refresh-token': IconRefresh,
			import: IconRefresh,
			export: IconRefresh,
		})[kind] ?? IconPublish;

	const IconCmp = $derived(iconFor(event.kind));

	const statusVariant = $derived(STATUS_VARIANTS[event.status]);

	const isPending = $derived(event.status === 'pending');
	const isExpired = $derived(event.status === 'expired');
	const needsAction = $derived(event.status === 'action-required');

	// Context-override: the event may be tied to a different profile than the
	// sidebar's current selection (Chapter 5.4.5 / 6.2.2).
	const overrideActive = $derived(!!event.profileOverride && event.profileOverride !== $daemon.defaultProfile);
	const effectiveProfile = $derived(event.profileOverride ?? event.profile);
	const effectiveProfileRecord = $derived($daemon.profiles.find((p) => p.username === effectiveProfile) ?? null);

	const initials = (n: string): string =>
		n.split(/[\s_-]+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

	// Publish carries a target; placeholder projects its generated v0.0.0 target for display.
	function makePlaceholderTarget(name: string): PublishTarget {
		return {
			name,
			version: '0.0.0',
			previousVersion: undefined,
			description: 'Generated placeholder package',
			path: '(generated)',
		};
	}

	const publishTarget = $derived(
		event.payload?.kind === 'publish'
			? event.payload.data
			: event.payload?.kind === 'create-placeholder'
				? ({ target: makePlaceholderTarget(event.payload.data.name) })
				: null,
	);
	const oidcCtx = $derived(event.payload?.kind === 'setup-oidc' ? event.payload.data : null);

	const timeLabel = $derived(new Date(event.createdAt).toLocaleTimeString());
</script>

<Card class="transition-shadow {isPending ? 'ring-2 ring-brand/40 shadow-md' : ''}">
	<CardHeader class="flex-row items-center justify-between gap-3 pb-3">
		<div class="flex min-w-0 items-center gap-2.5">
			<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground">
				<IconCmp class="h-4 w-4" />
			</div>
			<div class="min-w-0">
				<div class="flex items-center gap-2">
					<span class="truncate text-sm font-semibold">
						{#if publishTarget}{publishTarget.target.name}{:else if oidcCtx}{oidcCtx.name}{:else}{event.kind}{/if}
					</span>
					<Badge variant={statusVariant} class="h-5 capitalize">
						{#if isPending}<IconClock class="mr-1 h-3 w-3" />{/if}
						{event.status}
					</Badge>
				</div>
				<div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
					<IconClock class="h-3 w-3" /> {timeLabel}
					{#if event.clockDriftRecovered}
						<span class="ml-1 text-warning">· drift-recovered</span>
					{/if}
				</div>
			</div>
		</div>

		<!-- Effective identity pill (Chapter 6.2.2 context override). -->
		<div class="flex items-center gap-1.5 rounded-full border px-2 py-1 {overrideActive ? 'border-warning bg-warning/10' : 'border-border'}">
			<Avatar class="h-5 w-5">
				{#if effectiveProfileRecord?.avatarUrl}
					<AvatarImage src={effectiveProfileRecord.avatarUrl} alt={effectiveProfileRecord.username} />
				{/if}
				<AvatarFallback class="text-[9px]">{initials(effectiveProfile)}</AvatarFallback>
			</Avatar>
			<span class="max-w-[8rem] truncate text-[11px] font-medium">{effectiveProfile}</span>
		</div>
	</CardHeader>

	<CardContent class="space-y-3">
		{#if overrideActive}
			<div class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
				Command specified identity <strong>{event.profileOverride}</strong> — overriding sidebar selection.
			</div>
		{/if}

			{#if publishTarget}
				<div class="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs">
					<span class="font-semibold">{publishTarget.target.name}</span>
					{#if publishTarget.target.previousVersion}
						<span class="text-muted-foreground">{publishTarget.target.previousVersion}</span>
						<IconArrowRight class="h-3 w-3 text-muted-foreground" />
					{/if}
					<span class="text-brand">{publishTarget.target.version}</span>
				</div>
				{#if publishTarget.target.repository}
					<p class="text-[11px] text-muted-foreground">repo <span class="font-mono">{publishTarget.target.repository}</span></p>
				{/if}
				{#if publishTarget.target.description}
					<p class="text-xs text-muted-foreground">{publishTarget.target.description}</p>
				{/if}
		{:else if oidcCtx}
			<div class="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
				Configure Trusted Publish (OIDC) for <span class="font-mono">{oidcCtx.name}</span>
				{#if oidcCtx.repo}· repo <span class="font-mono">{oidcCtx.repo}</span>{/if}
			</div>
		{/if}

		{#if !isPending && event.result}
			<div class="rounded-md bg-muted/40 px-3 py-2 font-mono text-[11px] {isExpired || event.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}">
				{event.result}
			</div>
		{/if}

		{#if isPending}
			<div class="flex items-center gap-2 pt-1">
				<Button variant="brand" size="sm" class="flex-1" onclick={() => actions.confirm(event.id)}>
					<IconCheck class="h-3.5 w-3.5" />
					{#if event.kind === 'setup-oidc'}Confirm Setup OIDC{:else if event.kind === 'refresh-token'}Confirm Token Refresh{:else}Confirm Publish{/if}
				</Button>
				<Button variant="outline" size="sm" onclick={() => actions.reject(event.id)}>
					<IconX class="h-3.5 w-3.5" /> Reject
				</Button>
			</div>
		{:else if isExpired || needsAction}
			<!-- Chapter 6.2.4: expired/manual refresh events surface the renew flow. -->
			<Button
				variant="outline"
				size="sm"
				class="w-full"
				onclick={() => (window.location.href = `/renew?reason=${isExpired ? 'expired' : 'action-required'}`)}
			>
				{isExpired ? 'Token expired' : 'Credential input required'} — renew now
			</Button>
		{/if}
	</CardContent>
</Card>
