<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { actions, daemon, closeAddProfile } from '$lib/store.js';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
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
	import IconTrash from '@lucide/svelte/icons/trash-2';
	import IconUser from '@lucide/svelte/icons/user-round';
	import IconRegistry from '@lucide/svelte/icons/server';
	import IconLoader from '@lucide/svelte/icons/loader-circle';
	import IconKey from '@lucide/svelte/icons/key-round';
	import IconEye from '@lucide/svelte/icons/eye';
	import IconEyeOff from '@lucide/svelte/icons/eye-off';
	import IconCopy from '@lucide/svelte/icons/copy';
	import IconCheck from '@lucide/svelte/icons/check';
	import { apiFetch } from '$lib/api-fetch.js';
	import { parseProfileTokenResponse } from '$lib/rest-response.js';
	import { _ } from 'svelte-i18n';

	let deleteOpen = $state(false);
	let deleting = $state(false);
	let error = $state<string | null>(null);
	// Type-to-confirm: must match the profile username exactly.
	let confirmName = $state('');

	const username = $derived(decodeURIComponent(page.params.username ?? ''));
	const profile = $derived($daemon.profiles.find((item) => item.username === username) ?? null);
	const canDelete = $derived(confirmName.trim() === username);

	$effect(() => {
		if (!$daemon.profilesLoaded || profile) return;
		goto(`/${window.location.hash}`, { replaceState: true });
	});

	$effect(() => {
		void username;
		confirmName = '';
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

	async function deleteProfile(): Promise<void> {
		if (!profile || deleting || !canDelete) return;
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

	// ----- npm_token export (show / copy) -----
	let tokenLoading = $state(false);
	let token = $state<string | null>(null);
	let tokenError = $state<string | null>(null);
	let showToken = $state(false);
	let copied = $state(false);

	async function loadToken(): Promise<void> {
		if (tokenLoading || token) return;
		tokenLoading = true;
		tokenError = null;
		try {
			const res = await apiFetch(`/api/profile-token?username=${encodeURIComponent(username)}`);
			const json = parseProfileTokenResponse(await res.json());
			if (json?.ok && json.token) {
				token = json.token;
				showToken = true;
			} else {
				tokenError = json?.error ?? $_('profile.tokenError');
			}
		} catch {
			tokenError = $_('profile.tokenError');
		} finally {
			tokenLoading = false;
		}
	}

	async function copyToken(): Promise<void> {
		if (!token) return;
		try {
			await navigator.clipboard.writeText(token);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			/* clipboard unavailable */
		}
	}

	// Reset token state when navigating between profiles.
	$effect(() => {
		void username;
		token = null;
		tokenError = null;
		tokenLoading = false;
		showToken = false;
		copied = false;
	});
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
					<div class="space-y-2">
						<p class="text-sm text-muted-foreground">
							{$_('profile.deleteConfirmLabel', { values: { username: profile.username } })}
						</p>
						<Input
							bind:value={confirmName}
							placeholder={profile.username}
							autocomplete="off"
							spellcheck={false}
						/>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>{$_('common.cancel')}</AlertDialogCancel>
						<AlertDialogAction variant="destructive" disabled={deleting || !canDelete} onclick={deleteProfile}>
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

		<!-- npm_token export -->
		<section class="rounded-lg border border-border bg-card p-4">
			<div class="flex items-center justify-between gap-3">
				<div class="flex min-w-0 items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
					<IconKey /> {$_('profile.npmToken')}
				</div>
				<div class="flex shrink-0 items-center gap-1.5">
					{#if token}
						<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => (showToken = !showToken)} aria-label={showToken ? $_('addProfile.hidePassword') : $_('addProfile.showPassword')} title={showToken ? $_('addProfile.hidePassword') : $_('addProfile.showPassword')}>
							{#if showToken}<IconEyeOff class="h-3.5 w-3.5" />{:else}<IconEye class="h-3.5 w-3.5" />{/if}
						</Button>
						<Button variant="ghost" size="icon" class="h-7 w-7" onclick={copyToken} aria-label={$_('profile.copyToken')} title={$_('profile.copyToken')}>
							{#if copied}<IconCheck class="h-3.5 w-3.5 text-success" />{:else}<IconCopy class="h-3.5 w-3.5" />{/if}
						</Button>
					{:else if tokenLoading}
						<IconLoader class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
					{:else}
						<Button variant="outline" size="sm" onclick={loadToken}>
							<IconEye class="h-3.5 w-3.5" /> {$_('profile.revealToken')}
						</Button>
					{/if}
				</div>
			</div>
			<div class="mt-2">
				{#if tokenError}
					<p class="text-xs text-destructive">{tokenError}</p>
				{:else if token}
					<p class="break-all rounded-md bg-muted px-2 py-1.5 font-mono text-[11px]">
						{showToken ? token : '•'.repeat(Math.min(token.length, 40))}
					</p>
				{:else}
					<p class="text-xs text-muted-foreground">{$_('profile.tokenHidden')}</p>
				{/if}
			</div>
		</section>
	</div>
{:else}
	<div class="mx-auto flex max-w-3xl flex-col gap-5 p-6">
		<div class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
			{$_('profile.noProfileRoute')}
		</div>
	</div>
{/if}
