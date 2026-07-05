<script lang="ts">
	/**
	 * 偏好 (Preferences) settings tab.
	 *
	 * ⚠️ MAINTAINER NOTE — READ BEFORE EDITING `PreferencesSchema`.
	 * Every typed top-level field in `PreferencesSchema` (src/shared/schemas.ts) is the single
	 * source of truth for one app-wide preference, persisted to
	 * `~/.pnpm-pub/preferences.json` and broadcast to all clients. THERE IS NO
	 * OTHER WRITE PATH — the titlebar pin button and this tab both call
	 * `actions.setPreferences({ ... })`. Therefore every persisted field MUST
	 * have a matching editable control in THIS tab; the free-form `values`
	 * record is intentionally edited by the component that owns each small UI
	 * preference.
	 *
	 * When you add a field to `PreferencesSchema`:
	 *   1. Add it to `DEFAULT_PREFERENCES` (schemas.ts).
	 *   2. Mirror the type on the WebUI in `lib/types.ts` (`Preferences`).
	 *   3. Add a control for it below (group new fields under a new section,
	 *      separated by a `<Separator />`).
	 *
	 * Today the only typed field is `keepOnTop` (the "keep open" pin that
	 * suppresses blur auto-hide; the native always-on-top window style is
	 * permanent and unrelated).
	 */
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { actions, daemon } from '$lib/store.js';
	import { _ } from 'svelte-i18n';

	// The Switch needs a writable `bind:checked` target (its `checked` prop is
	// `$bindable`, not getter/setter like Dialog's `open`). We keep a local
	// `$state` in sync with the store-backed `pinned` and write back through the
	// single preferences path on change. Without this, `checked={pinned}` (one-way)
	// desyncs from bits-ui's internal state — the same class of bug the dialogs
	// hit with `setOpen`.
	const storePinned = $derived($daemon.pinned);
	let pinned = $state(false);
	// Push store → local whenever the daemon broadcasts a new value.
	$effect(() => {
		pinned = storePinned;
	});
</script>

<div class="space-y-5">
	<!-- keepOnTop — the keep-open pin. Toggling writes through the single
	     preferences path; the daemon re-evaluates auto-close and broadcasts the
	     new state, so the titlebar pin button reflects this change too. -->
	<div class="flex items-center justify-between gap-4">
		<div class="space-y-1">
			<Label for="pref-keepOnTop">{$_('settings.keepOnTop')}</Label>
			<p class="text-xs text-muted-foreground">{$_('settings.keepOnTopDesc')}</p>
		</div>
		<Switch
			id="pref-keepOnTop"
			bind:checked={pinned}
			onCheckedChange={(v) => actions.setPreferences({ keepOnTop: v })}
		/>
	</div>

	<Separator />

	<!--
		Future preference fields: add their controls above this comment in a new
		section. Remember to also update PreferencesSchema + DEFAULT_PREFERENCES +
		the WebUI Preferences type (see the module note above).
	-->
</div>
