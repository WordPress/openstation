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
