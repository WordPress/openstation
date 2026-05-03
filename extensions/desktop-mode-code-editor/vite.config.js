/**
 * Vite configuration for the Desktop Mode Code Editor extension.
 *
 * Builds `src/index.ts` into:
 *
 *   assets/js/code-editor.js      (development, unminified — used when SCRIPT_DEBUG is true)
 *   assets/js/code-editor.min.js  (production, esbuild-minified — used otherwise)
 *
 * `npm run build` runs Vite twice (once per mode) plus the
 * `vendor:monaco` step that copies Monaco's AMD distributable
 * from `node_modules` into `assets/vendor/monaco-editor/`.
 *
 * **Source policy:** `assets/js/code-editor[.min].js` is build output.
 * NEVER hand-edit those files — only edit the TS sources under `src/`
 * and run `npm run build:bundle`.
 *
 * @since 0.22.0
 */

import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig( ( { mode } ) => {
	const isProd = mode === 'production';

	return {
		build: {
			outDir: 'assets/js',
			// Two passes (dev + prod) write into the same dir — don't let
			// the second run delete what the first produced.
			emptyOutDir: false,
			target: 'es2020',
			minify: isProd ? 'esbuild' : false,
			sourcemap: false,
			lib: {
				entry: resolve( __dirname, 'src/index.ts' ),
				formats: [ 'iife' ],
				name: 'wpDesktopCodeEditor',
				fileName: () =>
					isProd ? 'code-editor.min.js' : 'code-editor.js',
			},
		},
	};
} );
