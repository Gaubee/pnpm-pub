<script lang="ts">
	/**
	 * First-profile onboarding route. This page is the SOLE entrypoint when the
	 * daemon has no profiles: +layout.svelte force-redirects here, and there is
	 * nothing else to show (no events, no profiles to manage).
	 *
	 * No nested card: the WINDOW itself is the card. The layout's onboarding
	 * branch paints the translucent root background (native blur shows through)
	 * and renders this page edge-to-edge in <main>. The form's own header
	 * (avatar + "Add profile" + description) is the sole title. On success the
	 * new profile is pushed over the WS and we route home. Also reachable
	 * directly (bookmark / deep link).
 */
	import { goto } from '$app/navigation';
	import AddProfileForm from '$lib/components/add-profile-form.svelte';
	import { daemon } from '$lib/store.js';
	import { ADD_PROFILE_WINDOW_SIZE, resizeWindow } from '$lib/window-size.js';
	import { onMount } from 'svelte';
	import { _ } from 'svelte-i18n';

	let contentEl = $state<HTMLDivElement | null>(null);

	function onSuccess(): void {
		// The new profile arrives over the WS; go home (replace so back doesn't
		// bounce to this onboarding page).
		goto('/', { replaceState: true });
	}

	function measuredWindowSize(target: HTMLElement): { width: number; height: number } {
		const rect = target.getBoundingClientRect();
		const titlebar = document.querySelector<HTMLElement>('[data-window-titlebar]');
		const titlebarHeight = titlebar?.getBoundingClientRect().height ?? 0;
		return {
			width: Math.max(ADD_PROFILE_WINDOW_SIZE.width, Math.ceil(rect.width)),
			height: Math.max(ADD_PROFILE_WINDOW_SIZE.height, Math.ceil(rect.height + titlebarHeight)),
		};
	}

	function resizeToContent(): void {
		if (!contentEl) {
			void resizeWindow(ADD_PROFILE_WINDOW_SIZE);
			return;
		}
		void resizeWindow(measuredWindowSize(contentEl));
	}

	$effect(() => {
		const connected = $daemon.connected;
		void connected;
		if (!connected) return;
		resizeToContent();
	});

	onMount(() => {
		if (!contentEl) {
			void resizeWindow(ADD_PROFILE_WINDOW_SIZE);
			return;
		}
		resizeToContent();
		const observer = new ResizeObserver(resizeToContent);
		observer.observe(contentEl);
		return () => observer.disconnect();
	});
</script>

<svelte:head><title>{$_('addProfile.title')}</title></svelte:head>

<!--
	The window IS the card: no nested <Card>. This single child is measured by a
	ResizeObserver; its size plus the titlebar height defines the host window
	size, with ADD_PROFILE_WINDOW_SIZE as the fallback minimum.
-->
<div bind:this={contentEl} class="mx-auto w-full max-w-md p-6">
	<AddProfileForm {onSuccess} />
</div>
