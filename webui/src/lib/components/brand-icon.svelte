<!--
	Brand logo icons — inline Simple Icons (CC0) SVG paths for product / forge
	marks used in the UI (the About tab links, the runtime-version rows, …).

	Single source for brand logos the way `repo-icon.svelte` is for git forges:
	the SVG path data lives inline so the marks stay crisp at any size and pick
	up no external icon-font dependency. Each entry is the canonical monochrome
	brand path on a `0 0 24 24` viewBox; color is driven by the brand's official
	hex via `fill` (NOT `currentColor`) so the logos read as brands, not as
	muted UI glyphs. Callers can opt into `currentColor` (e.g. inside a Button
	that already tints its content) by passing `monochrome`.
-->
<script lang="ts">
	export type BrandId = "pnpm" | "npm" | "github" | "gitlab" | "circleci";

	let {
		id,
		monochrome = false,
		class: className = "size-4",
	}: {
		id: BrandId;
		/** Use `currentColor` instead of the brand hex (for tinted buttons). */
		monochrome?: boolean;
		class?: string;
	} = $props();

	// Canonical brand marks (Simple Icons). viewBox 0 0 24 24.
	const BRAND: Record<BrandId, { d: string; color: string }> = {
		// pnpm — the three-by-three grid of squares. Official orange #F69220.
		pnpm: {
			d: "M0 0v7.5h7.5V0zm8.25 0v7.5h7.498V0zm8.25 0v7.5H24V0zM2 2h3.5v3.5H2zm8.25 0h3.498v3.5H10.25zm8.25 0H22v3.5h-3.5zM8.25 8.25v7.5h7.498v-7.5zm8.25 0v7.5H24v-7.5zm2 2H22v3.5h-3.5zM0 16.5V24h7.5v-7.5zm8.25 0V24h7.498v-7.5zm8.25 0V24H24v-7.5z",
			color: "#F69220",
		},
		// npm — the red square + cut-out "n". Official red #CB3837.
		npm: {
			d: "M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z",
			color: "#CB3837",
		},
		// GitHub — the Octocat silhouette. Official near-black #181717.
		github: {
			d: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
			color: "#181717",
		},
		// GitLab — the tanuki fox. Official orange #FC6D26.
		gitlab: {
			d: "M23.955 13.587l-1.34-4.135a.621.621 0 0 0-.04-.117l-2.66-8.184c-.145-.444-.55-.744-.99-.744-.435 0-.84.3-.99.74l-2.54 7.83H8.927L6.382.946c-.15-.44-.55-.74-.99-.74-.44 0-.84.3-.99.74L1.74 9.42a.6.6 0 0 0-.04.116L.345 13.59a1.24 1.24 0 0 0 .46 1.4l11.02 8.01a.62.62 0 0 0 .74 0l11.02-8.01a1.24 1.24 0 0 0 .37-1.406z",
			color: "#FC6D26",
		},
		// CircleCI — the circular CI mark. Official dark #343434.
		circleci: {
			d: "M8.963 12c0-1.584 1.284-2.855 2.855-2.855 1.572 0 2.856 1.284 2.856 2.855 0 1.572-1.284 2.856-2.856 2.856-1.57 0-2.855-1.284-2.855-2.856zm2.855-12C6.215 0 1.522 3.84.19 9.025c-.01.036-.01.07-.01.12 0 .313.252.576.575.576H5.59c.23 0 .433-.13.517-.333.997-2.16 3.18-3.672 5.712-3.672 3.466 0 6.286 2.82 6.286 6.287 0 3.47-2.82 6.29-6.29 6.29-2.53 0-4.714-1.5-5.71-3.673-.097-.19-.29-.336-.517-.336H.755c-.312 0-.575.253-.575.576 0 .037.014.072.014.12C1.514 20.16 6.214 24 11.818 24c6.624 0 12-5.375 12-12 0-6.623-5.376-12-12-12z",
			color: "#343434",
		},
	};

	const mark = $derived(BRAND[id]);
</script>

<svg
	class={className}
	viewBox="0 0 24 24"
	fill={monochrome ? "currentColor" : mark.color}
	aria-hidden="true"
>
	<path d={mark.d} />
</svg>
