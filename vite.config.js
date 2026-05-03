/**
 * Vite configuration for the WP Desktop Mode plugin.
 *
 * Builds two TypeScript entries into IIFE bundles:
 *
 *   `src/desktop.ts` →
 *     - `assets/js/desktop.js`     (development, unminified — loaded when SCRIPT_DEBUG is true)
 *     - `assets/js/desktop.min.js` (production, esbuild-minified — loaded otherwise)
 *
 *   `src/iframe-bridge-standalone.ts` →
 *     - `assets/js/iframe-bridge.js`     (development)
 *     - `assets/js/iframe-bridge.min.js` (production)
 *
 * Which entry the current invocation builds is controlled by the
 * `WPDM_TARGET` env var (`desktop` — default — or `iframe-bridge`).
 * `npm run build` runs Vite four times (two targets × two modes).
 * `npm run dev` watches and rebuilds the unminified `desktop` bundle
 * only — iframe-bridge changes are rare so a one-shot
 * `npm run build:iframe-bridge` covers them.
 *
 * **Source policy:** `assets/js/*.js` is build output. NEVER hand-edit
 * those files — only edit the TS sources under `src/` and run a build.
 *
 * @since 0.5.0
 */

import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const TARGETS = {
	desktop: {
		entry:    'src/desktop.ts',
		fileBase: 'desktop',
		// Exports from the entry land on `window.wpDesktop` — a no-op
		// today (no external consumers) but leaves the door open for
		// tests or devtools probing.
		iifeName: 'wpDesktop',
	},
	'iframe-bridge': {
		entry:    'src/iframe-bridge-standalone.ts',
		fileBase: 'iframe-bridge',
		iifeName: 'wpDesktopIframeBridge',
	},
	// Monaco-backed code editor app. Bundles only OUR shell code (file
	// tree, REST glue, Monaco bootstrap shim) — Monaco itself is loaded
	// at runtime from `assets/vendor/monaco-editor/` via its own AMD
	// loader, which is incompatible with our IIFE pipeline. See
	// `src/code-editor/monaco-bootstrap.ts`.
	'code-editor': {
		entry:    'src/code-editor/index.ts',
		fileBase: 'code-editor',
		iifeName: 'wpDesktopCodeEditor',
	},
	// Recycle Bin app — a thin bundle that registers a render
	// callback on `window.wpDesktopNativeWindows['wpdm-recycle-bin']`
	// and renders a `<wpd-table>` populated from the REST list. The
	// `<wpd-*>` elements themselves are defined by the main desktop
	// bundle, so this module just consumes them.
	'recycle-bin': {
		entry:    'src/recycle-bin/index.ts',
		fileBase: 'recycle-bin',
		iifeName: 'wpDesktopRecycleBin',
	},
	// Routines — visual automation. P1 ships a list view + JSON editor;
	// the visual canvas lands in P2 inside the same bundle.
	routines: {
		entry:    'src/routines/index.ts',
		fileBase: 'routines',
		iifeName: 'wpDesktopRoutines',
	},
};

export default defineConfig( ( { mode } ) => {
	const isProd = mode === 'production';
	const targetKey = process.env.WPDM_TARGET || 'desktop';
	const target = TARGETS[ targetKey ];
	if ( ! target ) {
		throw new Error(
			`vite.config.js: unknown WPDM_TARGET="${ targetKey }". ` +
				`Expected one of: ${ Object.keys( TARGETS ).join( ', ' ) }.`,
		);
	}

	return {
		build: {
			outDir: 'assets/js',
			// Every run writes into the same dir — don't let later runs
			// delete what earlier ones produced.
			emptyOutDir: false,
			target: 'es2020',
			// esbuild minification is ~10x faster than terser with comparable
			// output for plain TS; no separate dep needed.
			minify: isProd ? 'esbuild' : false,
			sourcemap: false,
			lib: {
				entry: resolve( __dirname, target.entry ),
				// IIFE wraps the module so it runs on script load without any
				// module-system glue. WordPress admin can't reliably import
				// <script type="module">, so we ship a self-contained bundle.
				formats: [ 'iife' ],
				name: target.iifeName,
				fileName: () =>
					isProd
						? `${ target.fileBase }.min.js`
						: `${ target.fileBase }.js`,
			},
		},
	};
} );
