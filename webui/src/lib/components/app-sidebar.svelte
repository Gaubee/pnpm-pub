<script lang="ts">
	/**
	 * App sidebar — sidebar-07 layout (Chapter 6.1).
	 *  - Main nav: Events (default home) + Workspaces
	 *  - Pinned workspaces under Workspaces
	 *  - Bottom-left profile switcher (Chapter 6.1.1)
	 */
	import { page } from '$app/state';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { actions, activeProfile, daemon, pendingEvents } from '$lib/store.js';
	import { toggleMode } from 'mode-watcher';
	import IconEvent from '@lucide/svelte/icons/list-checks';
	import IconWorkspaces from '@lucide/svelte/icons/folder-tree';
	import IconPlus from '@lucide/svelte/icons/plus';
	import IconSun from '@lucide/svelte/icons/sun';
	import IconMoon from '@lucide/svelte/icons/moon';
	import IconChevron from '@lucide/svelte/icons/chevrons-up-down';
	import IconBackup from '@lucide/svelte/icons/database-backup';
	import NpmMark from '$lib/components/npm-mark.svelte';

	let menuOpen = $state(false);

	const nav = [
		{ href: '/', label: 'Events', icon: IconEvent },
		{ href: '/workspaces', label: 'Workspaces', icon: IconWorkspaces },
		{ href: '/backup', label: 'Backup', icon: IconBackup },
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

<aside class="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
	<!-- Brand header (NPM logo mark — Chapter 1.3.2), unified with the tray icon. -->
	<div class="no-drag flex h-12 items-center gap-2 px-4">
		<NpmMark class="h-6 w-6 rounded-[5px]" />
		<span class="text-sm font-semibold tracking-tight">pnpm-pub</span>
	</div>
	<Separator />

	<!-- Primary navigation (Chapter 6.1.2). -->
	<nav class="no-drag flex flex-1 flex-col gap-1 p-3">
		<a
			href="/add-profile"
			class="mb-2 inline-flex items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
		>
			<IconPlus class="h-3.5 w-3.5" /> New Profile
		</a>

		{#each nav as item (item.href)}
			{@const active = page.url.pathname === item.href}
			<a
				href={item.href}
				class="group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors {active
					? 'bg-accent text-accent-foreground'
					: 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground'}"
			>
				<item.icon class="h-4 w-4" />
				<span class="flex-1">{item.label}</span>
				{#if item.href === '/' && $pendingEvents.length}
					<Badge variant="brand" class="h-5 px-1.5 text-[10px]">{$pendingEvents.length}</Badge>
				{/if}
			</a>
		{/each}

		{#if pinned.length > 0}
			<div class="mt-4 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
				Pinned
			</div>
			{#each pinned as ws (ws.path)}
				<a
					href="/workspaces"
					class="flex items-center gap-2.5 truncate rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-accent-foreground"
				>
					<IconWorkspaces class="h-3.5 w-3.5 shrink-0" />
					<span class="truncate">{ws.path.split('/').pop() ?? ws.path}</span>
				</a>
			{/each}
		{/if}
	</nav>

	<!-- Bottom controls: theme toggle + profile switcher (Chapter 6.1.1). -->
	<div class="no-drag relative border-t border-sidebar-border p-3">
		<Button
			variant="ghost"
			size="icon"
			class="absolute right-3 top-3 h-7 w-7"
			onclick={() => toggleMode()}
			aria-label="Toggle theme"
		>
			<IconSun class="hidden dark:block" />
			<IconMoon class="block dark:hidden" />
		</Button>

		<button
			type="button"
			onclick={() => (menuOpen = !menuOpen)}
			class="flex w-full items-center gap-2.5 rounded-md p-2 text-left transition-colors hover:bg-accent/60"
		>
			<Avatar>
				{#if $activeProfile?.avatarUrl}
					<AvatarImage src={$activeProfile.avatarUrl} alt={$activeProfile.username} />
				{:else}
					<AvatarFallback>{$activeProfile ? initials($activeProfile.username) : '??'}</AvatarFallback>
				{/if}
			</Avatar>
			<div class="min-w-0 flex-1">
				<div class="truncate text-sm font-medium">{$activeProfile?.username ?? 'No profile'}</div>
				<div class="truncate text-[11px] text-muted-foreground">
					{$daemon.profiles.length} profile{$daemon.profiles.length === 1 ? '' : 's'}
				</div>
			</div>
			<IconChevron class="h-4 w-4 text-muted-foreground" />
		</button>

		{#if menuOpen}
			<div class="absolute inset-x-3 bottom-16 z-20 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-lg">
				<div class="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
					Switch profile
				</div>
				{#each $daemon.profiles as p (p.username)}
					<button
						type="button"
						onclick={() => {
							actions.selectProfile(p.username);
							menuOpen = false;
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
				<a
					href="/add-profile"
					onclick={() => (menuOpen = false)}
					class="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
				>
					<IconPlus class="h-3.5 w-3.5" /> Add profile…
				</a>
			</div>
		{/if}
	</div>
</aside>
