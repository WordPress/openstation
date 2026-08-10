/**
 * Vite config for the shell-side adapter bundle.
 *
 * IIFE, not ESM: the bundle is enqueued by WordPress as a classic
 * script with a dependency on the `openstation` handle, which is what
 * gets it to run after the shell's API object exists and before the
 * shell's own `DOMContentLoaded` boot. A module script would defer past
 * that window.
 *
 * Two modes, matching the plugin's own convention: development builds
 * `electron-adapter.js` unminified, production builds
 * `electron-adapter.min.js`. `includes/assets.php` picks between them
 * on `SCRIPT_DEBUG`, so the choice stays server-side.
 */

import { defineConfig } from 'vite';

export default defineConfig( ( { mode } ) => {
	const production = 'production' === mode;

	return {
		build: {
			lib: {
				entry: 'src/index.ts',
				name: 'openStationElectronAdapter',
				formats: [ 'iife' ],
				fileName: () =>
					production ? 'electron-adapter.min.js' : 'electron-adapter.js',
			},
			outDir: 'assets/js',
			emptyOutDir: false,
			minify: production ? 'esbuild' : false,
			sourcemap: ! production,
			target: 'es2020',
		},
	};
} );
