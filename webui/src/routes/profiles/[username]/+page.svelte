<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { actions, daemon, closeAddProfile } from '$lib/store.js';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		AlertDialog,
		AlertDialogAction,
		AlertDialogCancel,
		AlertDialogContent,
		AlertDialogDescription,
		AlertDialogFooter,
		AlertDialogHeader,
		AlertDialogTitle,
	} from '$lib/components/ui/alert-dialog/index.js';
	import IconPackage from '@lucide/svelte/icons/package';
	import IconTrash from '@lucide/svelte/icons/trash-2';
	import IconUser from '@lucide/svelte/icons/user-round';
	import IconRegistry from '@lucide/svelte/icons/server';
	import IconLoader from '@lucide/svelte/icons/loader-circle';
	import type { PublishTarget } from '$lib/types.js';
	import { _ } from 'svelte-i18n';

	const pageSize = 8;

	let deleteOpen = $state(false);
	let deleting = $state(false);
	let error = $state<string | null>(null);
	let pageIndex = $state(0);

	const username = $derived(decodeURIComponent(page.params.username ?? ''));
	const profile = $derived($daemon.profiles.find((item) => item.username === username) ?? null);
	const packages = $derived(filterPackagesForProfile($daemon.packages, username));
	const totalPages = $derived(Math.max(1, Math.ceil(packages.length / pageSize)));
	const currentPage = $derived(Math.min(pageIndex, totalPages - 1));
	const visiblePackages = $derived(packages.slice(currentPage * pageSize, currentPage * pageSize + pageSize));

	$effect(() => {
		if (!$daemon.profilesLoaded || profile) return;
		goto(`/${window.location.hash}`, { replaceState: true });
	});

	$effect(() => {
		void username;
		pageIndex = 0;
		error = null;
		deleteOpen = false;
	});

	function initials(name: string): string {
		return name
			.split(/[\s_-]+/)
			.map((part) => part[0])
			.join('')
			.slice(0, 2)
			.toUpperCase() || '??';
	}

	function filterPackagesForProfile(items: PublishTarget[], name: string): PublishTarget[] {
		const scope = name.toLowerCase();
		return items.filter((item) => {
			const match = item.name.match(/^@([^/]+)\//);
			return !match || match[1]?.toLowerCase() === scope;
		});
	}

	async function deleteProfile(): Promise<void> {
		if (!profile || deleting) return;
		deleting = true;
		error = null;
		try {
			const ok = await actions.deleteProfile(profile.username);
			if (!ok) {
				error = $_('profile.deleteFailed', { values: { username: profile.username } });
				return;
			}
			deleteOpen = false;
			closeAddProfile(true);
			goto(`/${window.location.hash}`, { replaceState: true });
		} catch {
			error = $_('profile.deleteError');
		} finally {
			deleting = false;
		}
	}
</script>

<svelte:head>
	<title>{profile ? $_('profile.title', { values: { username: profile.username } }) : $_('profile.noProfile')}</title>
</svelte:head>

{#if profile}
	<div class="mx-auto flex max-w-3xl flex-col gap-5 p-6">
		<header class="flex items-start justify-between gap-4">
			<div class="flex min-w-0 items-center gap-3">
				<Avatar class="size-12 border border-border">
					{#if profile.avatarUrl}
						<AvatarImage src={profile.avatarUrl} alt={profile.username} />
					{:else}
						<AvatarFallback>{initials(profile.username)}</AvatarFallback>
					{/if}
				</Avatar>
				<div class="min-w-0">
					<h1 class="truncate text-lg font-semibold tracking-tight">{profile.username}</h1>
					<p class="truncate text-xs text-muted-foreground">{profile.registry ?? 'https://registry.npmjs.org/'}</p>
				</div>
			</div>
			<AlertDialog bind:open={deleteOpen}>
				<Button variant="destructive" size="sm" onclick={() => (deleteOpen = true)}>
					<IconTrash /> {$_('profile.delete')}
				</Button>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{$_('profile.deleteTitle', { values: { username: profile.username } })}</AlertDialogTitle>
						<AlertDialogDescription>{$_('profile.deleteDescription')}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>{$_('common.cancel')}</AlertDialogCancel>
						<AlertDialogAction variant="destructive" disabled={deleting} onclick={deleteProfile}>
							{#if deleting}<IconLoader class="animate-spin" />{/if}
							{$_('profile.deleteProfile')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</header>

		{#if error}
			<div class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
				{error}
			</div>
		{/if}

		<section class="grid gap-3 sm:grid-cols-2">
			<div class="rounded-lg border border-border bg-card p-4">
				<div class="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
					<IconUser /> {$_('profile.identity')}
				</div>
				<p class="mt-2 truncate text-sm font-medium">{profile.username}</p>
				<p class="mt-1 text-xs text-muted-foreground">
					{$_('profile.default', {
						values: {
							value: profile.username === $daemon.defaultProfile ? $_('profile.defaultYes') : $_('profile.defaultNo'),
						},
					})}
				</p>
			</div>
			<div class="rounded-lg border border-border bg-card p-4">
				<div class="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
					<IconRegistry /> {$_('profile.registry')}
				</div>
				<p class="mt-2 truncate font-mono text-xs">{profile.registry ?? 'https://registry.npmjs.org/'}</p>
				<p class="mt-1 text-xs text-muted-foreground">{$_('profile.secretsStored')}</p>
			</div>
		</section>

		<section class="flex flex-col gap-3">
			<div class="flex items-center justify-between">
				<div>
					<h2 class="flex items-center gap-2 text-sm font-semibold">
						<IconPackage /> {$_('profile.packages')}
					</h2>
					<p class="text-xs text-muted-foreground">{$_('profile.packagesIntro')}</p>
				</div>
				<Badge variant="secondary">{packages.length}</Badge>
			</div>

			{#if packages.length === 0}
				<div class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
					{$_('profile.noPackages')}
				</div>
			{:else}
				<div class="overflow-hidden rounded-lg border border-border bg-card">
					{#each visiblePackages as pkg (pkg.path)}
						<div class="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0">
							<div class="min-w-0">
								<div class="flex items-center gap-2">
									<span class="truncate text-sm font-medium">{pkg.name}</span>
									<Badge variant="outline" class="font-mono text-[10px]">{pkg.version}</Badge>
								</div>
								<p class="mt-1 truncate font-mono text-[10px] text-muted-foreground">{pkg.path}</p>
							</div>
							{#if pkg.repository}
								<span class="hidden max-w-40 truncate font-mono text-[10px] text-muted-foreground sm:block">{pkg.repository}</span>
							{/if}
						</div>
					{/each}
				</div>
				<div class="flex items-center justify-end gap-2">
					<Button variant="outline" size="sm" disabled={currentPage === 0} onclick={() => (pageIndex = Math.max(0, currentPage - 1))}>
						{$_('common.previous')}
					</Button>
					<span class="text-xs text-muted-foreground">{currentPage + 1} / {totalPages}</span>
					<Button variant="outline" size="sm" disabled={currentPage + 1 >= totalPages} onclick={() => (pageIndex = Math.min(totalPages - 1, currentPage + 1))}>
						{$_('common.next')}
					</Button>
				</div>
			{/if}
		</section>
	</div>
{:else}
	<div class="mx-auto flex max-w-3xl flex-col gap-5 p-6">
		<div class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
			{$_('profile.noProfileRoute')}
		</div>
	</div>
{/if}
