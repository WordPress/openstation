import { defineConfig } from 'vitest/config';

export default defineConfig( {
	test: {
		environment: 'jsdom',
		include: [ 'tests/vitest/**/*.test.ts' ],
		isolate: true,
		testTimeout: 2000,
	},
} );
