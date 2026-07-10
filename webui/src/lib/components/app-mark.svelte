<!--
	pnpm-pub's custom product mark.

	Built on the npm logo (the red square + white "n"), but the square's solid
	fill is replaced with a diagonal linear gradient: npm red (#CB3837) at the
	top-right corner → pnpm orange (#F69220) at the bottom-left. A visual
	bridge between the two ecosystems the tool connects (pnpm → npm publish).

	The gradient needs a unique id so multiple instances on one page don't
	collide; we derive it from a per-instance counter. Kept in lockstep with
	`npm-mark.svelte` geometry (same 512 viewBox + path data) so it can drop in
	anywhere the npm mark was used. Callers must NOT add `rounded-*` — the
	square's crisp corners are part of the identity.
-->
<script lang="ts">
	import { onMount } from "svelte";

	let { class: klass = "" }: { class?: string } = $props();

	// Unique gradient id per instance (avoids clashing when several marks render
	// on the same page). SSR-stable: starts as a fixed id, swapped on mount.
	let gradId = $state("app-mark-grad");
	onMount(() => {
		gradId = `app-mark-grad-${Math.random().toString(36).slice(2, 9)}`;
	});
</script>

<svg
	class={klass}
	viewBox="0 0 512 512"
	xmlns="http://www.w3.org/2000/svg"
	fill-rule="evenodd"
	clip-rule="evenodd"
	stroke-linejoin="round"
	stroke-miterlimit="2"
	aria-hidden="true"
>
	<defs>
		<!-- npm red (top-right) → pnpm orange (bottom-left). x2/y2 = bottom-left. -->
		<linearGradient id={gradId} x1="512" y1="0" x2="0" y2="512" gradientUnits="userSpaceOnUse">
			<stop offset="0" stop-color="#CB3837" />
			<stop offset="1" stop-color="#F69220" />
		</linearGradient>
	</defs>
	<g fill-rule="nonzero">
		<!-- The square background, now gradient-filled instead of solid #c12127. -->
		<path d="M10.999 500.999v-490h490v490h-490z" fill="url(#{gradId})" />
		<!-- The "n" cutout, kept white as in the original npm mark. -->
		<path d="M102.874 102.874h306.25v306.25h-61.25v-245h-91.875v245H102.874v-306.25z" fill="#fff" />
	</g>
</svg>
