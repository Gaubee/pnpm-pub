import { defineConfig } from 'vitest/config';

// Browser-backed WebUI regressions live outside the unit lane because they may
// start dev servers and drive a real browser process.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['test/browser/**/*.test.ts'],
		testTimeout: 120_000,
		hookTimeout: 60_000,
	},
});
