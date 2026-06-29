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
	import { closeAddProfile, daemon, ui } from '$lib/store.js';
	import { _ } from 'svelte-i18n';

	/** Dismissable only once a profile exists (the no-profile case uses the route). */
	const hasProfiles = $derived($daemon.profiles.length > 0);

	let open = $derived($ui.addProfileOpen);

	function setOpen(next: boolean): void {
		if (!next && !hasProfiles) return;
		ui.set({ addProfileOpen: next });
	}
</script>

<Dialog bind:open={() => open, setOpen}>
	<DialogContent class="max-w-[440px]" showCloseButton={hasProfiles} aria-describedby={undefined}>
		<DialogTitle class="sr-only">{$_('addProfile.heading')}</DialogTitle>
		<AddProfileForm onSuccess={() => closeAddProfile(true)} />
	</DialogContent>
</Dialog>
