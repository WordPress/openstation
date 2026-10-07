import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

const pixiVersion = JSON.parse(
	readFileSync(
		resolve(
			createRequire( import.meta.url ).resolve( 'pixi.js' ),
			'../../package.json',
		),
		'utf8',
	),
).version;

const here = resolve( fileURLToPath( import.meta.url ), '..' );
const shim = ( name ) => resolve( here, 'src/shims', name );

const PIXI_PINNED = '8.18.1';

const PIXI_UNUSED = [

	{ id: 'events/init.mjs' },

	{ id: 'accessibility/init.mjs' },

	{ id: 'dom/init.mjs' },

	{ id: 'spritesheet/init.mjs' },

	{
		id: 'rendering/renderers/gpu/WebGPURenderer.mjs',
		from: 'rendering/renderers/autoDetectRenderer.mjs',
	},

	{ id: '@xmldom/xmldom', stub: 'pixi-no-xmldom.ts' },
];

function matchUnused( source, importer ) {
	if ( ! importer || ! importer.includes( `pixi.js${ sep }lib` ) ) {
		return null;
	}

	const libPath = ( id ) => `pixi.js${ sep }lib${ sep }${ id.split( '/' ).join( sep ) }`;
	const abs = source.startsWith( '.' )
		? resolve( dirname( importer ), source )
		: null;

	return (
		PIXI_UNUSED.find( ( entry ) => {

			if ( entry.from && ! importer.endsWith( libPath( entry.from ) ) ) {
				return false;
			}
			return abs
				? abs.endsWith( libPath( entry.id ) )
				: source === entry.id;
		} ) ?? null
	);
}

function trimPixi() {
	return {
		name: 'mio-trim-pixi',
		enforce: 'pre',
		resolveId( source, importer ) {
			const hit = matchUnused( source, importer );
			return hit ? shim( hit.stub ?? 'pixi-unused.ts' ) : null;
		},
	};
}

function verifyTrim( pixiVersion ) {
	const seen = new Set();
	return {
		name: 'mio-verify-trim',
		enforce: 'pre',
		buildStart() {
			if ( pixiVersion !== PIXI_PINNED ) {
				this.error(
					`pixi.js is ${ pixiVersion }, but the trim list in ` +
						`vite.config.js was measured against ${ PIXI_PINNED }. ` +
						'Re-run `BUNDLE_REPORT=1 npm run build`, check the ' +
						'treemap, update PIXI_UNUSED and PIXI_PINNED together.',
				);
			}
		},
		resolveId( source, importer ) {
			const hit = matchUnused( source, importer );
			if ( hit ) {
				seen.add( hit.id );
			}
			return null;
		},
		buildEnd() {
			const missing = PIXI_UNUSED.filter( ( e ) => ! seen.has( e.id ) );
			if ( missing.length ) {
				this.error(
					'These entries in PIXI_UNUSED matched nothing, so they ' +
						'trimmed nothing:\n  ' +
						missing.map( ( e ) => e.id ).join( '\n  ' ) +
						'\nPixiJS has moved them. Re-measure with ' +
						'`BUNDLE_REPORT=1 npm run build`.',
				);
			}
		},
	};
}

export default defineConfig( ( { mode } ) => {
	const isProd = mode === 'production';

	const wantReport = process.env.BUNDLE_REPORT === '1' && isProd;

	return {
		root: here,
		plugins: [
			verifyTrim( pixiVersion ),
			trimPixi(),
			...( wantReport
				? [
					visualizer( {
						filename: resolve( here, 'dist/mio.report.html' ),
						template: 'treemap',
						gzipSize: true,
						brotliSize: false,
						emitFile: false,
						open: false,
					} ),
				]
				: [] ),
		],
		resolve: {
			alias: [

				{ find: /^\.\.\/hooks$/, replacement: shim( 'hooks.ts' ) },

				{
					find: /^\.\/style-panel$/,
					replacement: shim( 'style-panel.ts' ),
				},
			],
		},
		build: {
			outDir: resolve( here, 'dist' ),

			emptyOutDir: false,
			target: 'es2020',
			minify: isProd ? 'esbuild' : false,
			sourcemap: false,
			lib: {
				entry: resolve( here, 'src/entry.ts' ),

				formats: [ 'iife' ],

				name: 'MioBundle',
				fileName: () => ( isProd ? 'mio.min.js' : 'mio.js' ),
			},
		},
	};
} );
