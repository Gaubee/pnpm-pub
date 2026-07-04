<script lang="ts">
	/**
	 * App sidebar — sidebar-07 layout (Chapter 6.1).
	 *  - Main nav: Events (default home) + Workspaces
	 *  - Pinned workspaces under Workspaces
	 *  - Bottom-left profile switcher (Chapter 6.1.1)
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { cn } from '$lib/utils.js';
	import { actions, activeProfile, avatarUrlFor, daemon, openAddProfile, pendingEvents } from '$lib/store.js';
	import IconEvent from '@lucide/svelte/icons/list-todo';
	import IconWorkspaces from '@lucide/svelte/icons/folder-tree';
	import IconPlus from '@lucide/svelte/icons/plus';
	import IconChevron from '@lucide/svelte/icons/chevrons-up-down';
	import IconBackup from '@lucide/svelte/icons/database-backup';
	import IconPackage from '@lucide/svelte/icons/package';
	import IconPanelClose from '@lucide/svelte/icons/panel-left-close';
	import IconPanelOpen from '@lucide/svelte/icons/panel-left-open';
	import NpmMark from '$lib/components/npm-mark.svelte';
	import { _ } from 'svelte-i18n';

	let menuOpen = $state(false);
	let collapsed = $state(true);

	const nav = [
		{ href: '/active-events', labelKey: 'sidebar.activeEvents', icon: IconEvent },
		{ href: '/packages', labelKey: 'sidebar.packages', icon: IconPackage },
		{ href: '/workspaces', labelKey: 'sidebar.workspaces', icon: IconWorkspaces },
		{ href: '/backup', labelKey: 'sidebar.backup', icon: IconBackup },
	];

	const pinned = $derived($daemon.workspaces.filter((w) => w.pinned));
	const initials = (name: string): string =>
		name
			.split(/[\s_-]+/)
			.map((p) => p[0])
			.join('')
			.slice(0, 2)
			.toUpperCase();
</script>

<aside
	class={cn(
		'flex shrink-0 flex-col bg-transparent text-sidebar-foreground transition-[width] duration-200 ease-out',
		collapsed ? 'w-14' : 'w-60',
	)}
	data-collapsed={collapsed}
>
	<!-- Brand header (NPM logo mark — Chapter 1.3.2), unified with the tray icon. -->
	<div class={cn('no-drag flex h-12 items-center gap-2 px-3', collapsed && 'justify-center')}>
		{#if !collapsed}
			<NpmMark class="h-6 w-6 rounded-[5px]" />
			<span class="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">pnpm-pub</span>
		{/if}
		<Button
			type="button"
			variant="ghost"
			size="icon"
			class="h-8 w-8 text-muted-foreground hover:text-foreground"
			aria-label={collapsed ? $_('sidebar.expand') : $_('sidebar.collapse')}
			aria-expanded={!collapsed}
			onclick={() => {
				collapsed = !collapsed;
				menuOpen = false;
			}}
		>
			{#if collapsed}
				<IconPanelOpen />
			{:else}
				<IconPanelClose />
			{/if}
		</Button>
	</div>
		<Separator />

	<!-- Primary navigation (Chapter 6.1.2). Profile creation lives in the bottom profile menu. -->
		<nav class="no-drag flex flex-1 flex-col gap-1 p-3">
			{#each nav as item (item.href)}
				{@const pathname = page.url.pathname}
				{@const active = pathname === item.href || (item.href === '/active-events' && pathname === '/')}
				{@const label = $_(item.labelKey)}
				{@const showBadge = item.href === '/active-events' && $pendingEvents.length > 0}
				<a
					href={item.href}
					class={cn(
						'group flex items-center gap-2.5 rounded-md py-2 text-sm font-medium transition-all duration-150',
						collapsed ? 'justify-center px-0' : 'px-3',
						active
							? '[backdrop-filter:contrast(2)] text-accent-foreground'
							: 'text-muted-foreground hover:[backdrop-filter:contrast(1)] hover:text-accent-foreground',
					)}
					aria-label={label}
					title={collapsed ? label : undefined}
				>
					<item.icon class="h-4 w-4" />
					{#if !collapsed}
						<span class="flex-1">{label}</span>
					{/if}
					{#if showBadge && !collapsed}
						<Badge variant="brand" class="h-5 px-1.5 text-[10px]">{$pendingEvents.length}</Badge>
					{:else if showBadge}
						<span class="absolute ml-5 mt-[-1.25rem] h-2 w-2 rounded-full bg-brand"></span>
					{/if}
				</a>
			{/each}

		{#if pinned.length > 0 && !collapsed}
			<div class="mt-4 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
				{$_('sidebar.pinned')}
			</div>
			{#each pinned as ws (ws.path)}
				<a
					href="/workspaces/{btoa(ws.path)}"
					class="flex items-center gap-2.5 truncate rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-all duration-150 hover:[backdrop-filter:contrast(1)] hover:text-accent-foreground"
				>
					<IconWorkspaces class="h-3.5 w-3.5 shrink-0" />
					<span class="truncate">{ws.path.split('/').pop() ?? ws.path}</span>
				</a>
			{/each}
		{/if}
	</nav>

	<!-- Bottom controls: profile switcher (Chapter 6.1.1). Theme toggle lives in the titlebar. -->
	<div class="no-drag relative border-t border-sidebar-border p-3">
		<button
			type="button"
			onclick={() => (menuOpen = !menuOpen)}
				class={cn(
					'flex w-full items-center rounded-md p-2 text-left transition-all duration-150 hover:[backdrop-filter:contrast(1)]',
					collapsed ? 'justify-center' : 'gap-2.5',
				)}
			aria-label={$_('sidebar.switchProfile')}
			title={collapsed ? ($activeProfile?.username ?? $_('sidebar.noProfile')) : undefined}
		>
			<Avatar>
				{#if $activeProfile?.username}
					<AvatarImage src={avatarUrlFor($activeProfile.username)} alt={$activeProfile.username} />
					<AvatarFallback>{$activeProfile ? initials($activeProfile.username) : '??'}</AvatarFallback>
				{:else}
					<AvatarFallback>{'??'}</AvatarFallback>
				{/if}
			</Avatar>
			{#if !collapsed}
				<div class="min-w-0 flex-1">
					<div class="truncate text-sm font-medium">{$activeProfile?.username ?? $_('sidebar.noProfile')}</div>
					<div class="truncate text-[11px] text-muted-foreground">
						{$_('sidebar.profileCount', { values: { count: $daemon.profiles.length } })}
					</div>
				</div>
				<IconChevron class="h-4 w-4 text-muted-foreground" />
			{/if}
		</button>

		{#if menuOpen}
			<div
				class={cn(
					'absolute bottom-16 z-20 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-lg',
					collapsed ? 'left-3 w-56' : 'inset-x-3',
				)}
			>
				<div class="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
					{$_('sidebar.switchProfile')}
				</div>
				{#each $daemon.profiles as p (p.username)}
					<button
						type="button"
						onclick={() => {
							actions.selectProfile(p.username);
							menuOpen = false;
							goto(`/profiles/${encodeURIComponent(p.username)}${location.hash}`);
						}}
						class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent {p.username ===
						$daemon.defaultProfile
							? 'font-medium'
							: ''}"
					>
						<Avatar class="h-6 w-6">
							<AvatarFallback class="text-[10px]">{initials(p.username)}</AvatarFallback>
						</Avatar>
						<span class="flex-1 truncate">{p.username}</span>
						{#if p.username === $daemon.defaultProfile}
							<span class="h-1.5 w-1.5 rounded-full bg-brand"></span>
						{/if}
					</button>
				{/each}
				<Separator class="my-1" />
				<button
					type="button"
					onclick={() => {
						menuOpen = false;
						openAddProfile();
					}}
					class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent"
				>
					<IconPlus class="h-3.5 w-3.5" /> {$_('sidebar.addProfile')}
				</button>
			</div>
		{/if}
	</div>
</aside>
