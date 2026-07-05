<script lang="ts">
	/**
	 * Add Profile dialog — the "add another" surface, used ONLY when at least one
	 * profile already exists. When the daemon has zero profiles, the app forces
	 * the dedicated `/add-profile` route instead (see +layout.svelte).
	 *
	 * This is a thin shell: the form logic lives in `<AddProfileForm>`. Here we
	 * only manage open/close state and the first-profile dismissal guard.
	 */
	import {
		Dialog,
		DialogContent,
		DialogTitle,
	} from '$lib/components/ui/dialog/index.js';
	import AddProfileForm from '$lib/components/add-profile-form.svelte';
	import { closeAddProfile, daemon, ui, activeProfile } from '$lib/store.js';
	import { goto } from '$app/navigation';
	import { _ } from 'svelte-i18n';

	/** Dismissable only once a profile exists (the no-profile case uses the route). */
	const hasProfiles = $derived($daemon.profiles.length > 0);
	/** Reauth mode when the active profile is not authenticated. */
	const isReauth = $derived(
		hasProfiles && ($activeProfile?.authStatus ?? 'unauthenticated') !== 'authenticated',
	);

	let open = $derived($ui.addProfileOpen);

	function setOpen(next: boolean): void {
		if (!next && !hasProfiles) return;
		ui.update((s) => ({ ...s, addProfileOpen: next }));
	}

	function handleSuccess(username: string): void {
		// Always close the dialog first.
		closeAddProfile(true);
		// Reauth just refreshed the active profile's token — stay where the user
		// was. Adding a NEW profile, however, should land on its detail page so the
		// user can review/adjust its settings.
		if (!isReauth) {
			goto(`/profiles/${encodeURIComponent(username)}${window.location.hash}`);
		}
	}
</script>

<Dialog bind:open={() => open, setOpen}>
	<DialogContent class="max-w-[440px]" showCloseButton={hasProfiles} aria-describedby={undefined}>
		<DialogTitle class="sr-only">{$_(isReauth ? 'addProfile.reauthHeading' : 'addProfile.heading')}</DialogTitle>
		<AddProfileForm
			mode={isReauth ? 'reauth' : 'add'}
			username={isReauth ? $activeProfile?.username : undefined}
			onSuccess={handleSuccess}
		/>
	</DialogContent>
</Dialog>
