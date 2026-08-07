import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig( ( { mode } ) => ( {
	build: {
		outDir: 'assets/js',
		emptyOutDir: false,
		target: 'es2020',
		minify: mode === 'production' ? 'esbuild' : false,
		sourcemap: false,
		lib: {
			entry: resolve( __dirname, 'src/index.ts' ),
			formats: [ 'iife' ],
			name: 'openStationFeedBuddy',
			fileName: () =>
				mode === 'production' ? 'feed-buddy.min.js' : 'feed-buddy.js',
		},
	},
} ) );
