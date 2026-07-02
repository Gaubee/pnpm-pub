<script lang="ts">
	/**
	 * Unified repository brand/favicon icon — renders an inline brand SVG for a
	 * known forge (github/gitlab/gitee/bitbucket/codeberg/gitcode), or an
	 * `<img>` favicon for an unknown host. Designed to be reused across
	 * EventCard, WorkspaceDetail and PackageDetail.
	 *
	 * The descriptor comes from the daemon's `/api/repo-info` resolver (see
	 * `src/daemon/repo-info.ts`), which caches results in the event DB.
	 */
	import type { RepoBrand } from './repo-info-types.js';

	let {
		brand = null,
		faviconUrl = '',
		class: className = 'h-3.5 w-3.5',
	}: {
		brand?: RepoBrand | null;
		faviconUrl?: string;
		class?: string;
	} = $props();

	// Inline brand SVGs (Simple Icons / official marks paths). viewBox 0 0 24 24.
	const BRAND_PATHS: Record<RepoBrand, string> = {
		github: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
		gitlab: 'M23.955 13.587l-1.34-4.135a.621.621 0 0 0-.04-.117l-2.66-8.184c-.145-.444-.55-.744-.99-.744-.435 0-.84.3-.99.74l-2.54 7.83H8.927L6.382.946c-.15-.44-.55-.74-.99-.74-.44 0-.84.3-.99.74L1.74 9.42a.6.6 0 0 0-.04.116L.345 13.59a1.24 1.24 0 0 0 .46 1.4l11.02 8.01a.62.62 0 0 0 .74 0l11.02-8.01a1.24 1.24 0 0 0 .37-1.406z',
		gitee: 'M11.984 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.016 0zm6.09 5.333c.328 0 .593.266.592.593v1.482a.594.594 0 0 1-.593.592H9.777c-.982 0-1.778.796-1.778 1.778v5.63c0 .327.266.592.593.592h5.63c.982 0 1.778-.796 1.778-1.778v-.296a.594.594 0 0 0-.593-.593h-4.74a.594.594 0 0 1-.593-.592v-1.482a.594.594 0 0 1 .593-.592h6.815c.328 0 .593.265.593.592v3.408a4 4 0 0 1-4 4H8.37a.594.594 0 0 1-.593-.593V8.926a4 4 0 0 1 4-4z',
		bitbucket: 'M.778 1.211c-.424-.006-.772.334-.772.76 0 .072.01.143.03.211l3.26 19.811C3.393 23.046 4.077 24 4.857 24h11.27c.6 0 1.114-.453 1.214-1.071l3.272-19.811a.762.762 0 0 0-.662-.875.733.733 0 0 0-.111-.006H.778zm13.576 13.273H9.645l-1.024-5.49h6.46l-1.157 5.49z',
		codeberg: 'M12 0L0 23.99h24L12 0zm0 6.99l6 12H6l6-12z',
		gitcode: 'M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 4.5a7.5 7.5 0 0 1 7.5 7.5c0 3.06-1.835 5.697-4.482 6.866a.75.75 0 0 1-1.02-.693v-1.85a.75.75 0 0 0-.75-.75h-.936a.75.75 0 0 0-.75.75v2.468a.75.75 0 0 1-.886.735A7.5 7.5 0 0 1 12 4.5z',
	};
</script>

{#if brand && BRAND_PATHS[brand]}
	<svg class={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path d={BRAND_PATHS[brand]} />
	</svg>
{:else if faviconUrl}
	<img src={faviconUrl} alt="" class={className} loading="lazy" />
{:else}
	<!-- fallback: generic globe -->
	<svg class={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
		<circle cx="12" cy="12" r="10" />
		<path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20" />
	</svg>
{/if}
