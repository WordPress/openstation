/**
 * Vite config for the two browser-side bundles.
 *
 * Selected by `OPENSTATION_ADAPTER_TARGET`, mirroring the main plugin's
 * `OPENSTATION_TARGET` convention:
 *
 *   - **`shell`** (default) — the adapter that runs inside wp-admin.
 *     IIFE, not ESM: WordPress enqueues it as a classic script with a
 *     dependency on the `openstation` handle, which is what gets it to
 *     run after the shell's API object exists and before the shell's own
 *     `DOMContentLoaded` boot. A module script would defer past that
 *     window. Two modes: development builds `electron-adapter.js`
 *     unminified, production builds `electron-adapter.min.js`, and
 *     `includes/assets.php` picks between them on `SCRIPT_DEBUG`.
 *
 *   - **`connect`** — the Electron app's first-run screen.
 *
 * The connect screen is bundled rather than compiled by `tsc` with the
 * rest of the app, and that is not a stylistic choice. The app's
 * `tsconfig` emits CommonJS, because that is what Electron's main
 * process and preloads load — and a CommonJS module opens with
 * `Object.defineProperty(exports, …)`, which in a page running with
 * `nodeIntegration: false` throws `exports is not defined` on line one.
 * The whole script dies, the submit handler never binds, and the
 * Connect button silently does nothing forever. An IIFE has no such
 * prologue. (ESM would be the other fix, but `type="module"` over
 * `file://` is blocked by CORS.)
 */

import { defineConfig } from 'vite';

const TARGETS = {
	shell: {
		entry: 'src/index.ts',
		name: 'openStationElectronAdapter',
		outDir: 'assets/js',
		fileName: ( production ) =>
			production ? 'electron-adapter.min.js' : 'electron-adapter.js',
	},
	connect: {
		entry: 'app/src/renderer/connect.ts',
		name: 'openStationConnectScreen',
		outDir: 'app/dist/renderer',
		// One name in both modes: the HTML references it literally, and
		// the connect screen is not served to users over a network, so
		// there is nothing for a `.min` variant to save.
		fileName: () => 'connect.js',
	},
};

export default defineConfig( ( { mode } ) => {
	const key = process.env.OPENSTATION_ADAPTER_TARGET || 'shell';
	const target = TARGETS[ key ];
	if ( ! target ) {
		throw new Error(
			`vite.config.mjs: unknown OPENSTATION_ADAPTER_TARGET="${ key }". ` +
				`Known targets: ${ Object.keys( TARGETS ).join( ', ' ) }.`,
		);
	}

	const production = 'production' === mode;

	return {
		build: {
			lib: {
				entry: target.entry,
				name: target.name,
				formats: [ 'iife' ],
				fileName: () => target.fileName( production ),
			},
			outDir: target.outDir,
			emptyOutDir: false,
			minify: production ? 'esbuild' : false,
			sourcemap: false,
			target: 'es2020',
		},
	};
} );
