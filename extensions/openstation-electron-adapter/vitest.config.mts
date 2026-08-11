/**
 * Vitest config for the Electron Adapter.
 *
 * `jsdom`, because half of what is under test is browser code and the
 * other half — the app's `lib/` modules — was deliberately written to
 * need nothing but a runtime. Nothing here launches Electron: the app's
 * Electron-touching code is confined to `app/src/main.ts` and the
 * preloads, which are wiring, and the decisions worth testing were
 * moved out of them on purpose.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig( {
	test: {
		environment: 'jsdom',
		include: [ 'tests/**/*.test.ts' ],
		globals: true,
	},
} );
