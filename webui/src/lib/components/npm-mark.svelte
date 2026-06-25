<!--
	The npm logo mark — the single source of truth for the app's visual identity
	(Chapter 1.3.2). Kept in lockstep with assets/icon.svg (the red #c12127 square
	+ white "n"), which is also what the tray icon, favicon, and pending badge
	are rasterized from (scripts/gen-icons.mjs). Inlined so it stays crisp at any
	size and inherits no external icon-font dependency.
-->
<script lang="ts">
	let { class: klass = '' }: { class?: string } = $props();
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
	<g fill-rule="nonzero">
		<path d="M10.999 500.999v-490h490v490h-490z" fill="#c12127" />
		<path d="M102.874 102.874h306.25v306.25h-61.25v-245h-91.875v245H102.874v-306.25z" fill="#fff" />
	</g>
</svg>
