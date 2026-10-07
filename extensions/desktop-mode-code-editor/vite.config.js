import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig( ( { mode } ) => {
	const isProd = mode === 'production';

	return {
		build: {
			outDir: 'assets/js',

			emptyOutDir: false,
			target: 'es2020',
			minify: isProd ? 'esbuild' : false,
			sourcemap: false,
			lib: {
				entry: resolve( __dirname, 'src/index.ts' ),
				formats: [ 'iife' ],
				name: 'openStationCodeEditor',
				fileName: () =>
					isProd ? 'code-editor.min.js' : 'code-editor.js',
			},
		},
	};
} );
