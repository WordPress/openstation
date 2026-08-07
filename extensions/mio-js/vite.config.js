/**
 * mio-js — build config.
 *
 * Produces `dist/mio.js` (readable) and `dist/mio.min.js` (shipping)
 * as self-contained IIFEs: Mio's simulation, its renderer, and the
 * whole of PixiJS in one file with no imports and no globals to set
 * up. A `<script src>` is the entire integration.
 *
 * The sources are the shell's own `src/mio/*`, imported across the
 * repo rather than copied, so this library cannot drift from the Mio
 * the plugin ships. What it can't take with it is the shell those
 * modules are used to having around, and the two aliases below are
 * that boundary — each points at a stand-in in `src/shims/` whose
 * header explains what it stands in for.
 *
 * Both aliases are deliberately narrow relative specifiers that
 * exactly one module in this build's graph imports (`src/mio/mio.ts`).
 * If a future `src/mio/*` module imports either one, it will be
 * shimmed too — which is the intent — but a THIRD shell dependency
 * appearing in the graph will surface as a build error rather than
 * silently, and should be answered with another shim here, not by
 * loosening these.
 *
 * Run from this directory: `npm run build`.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

/*
 * Read through the resolved entry rather than `require(
 * 'pixi.js/package.json' )` — Pixi's `exports` map doesn't list its
 * own manifest, so the direct subpath is blocked.
 */
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

/**
 * PixiJS version this build's trim list was derived from and tested
 * against. The list below names module paths inside `pixi.js/lib`,
 * which are private: they can move in any release, and a path that
 * stops matching stops trimming *silently* — the bundle just quietly
 * gets 200 kB heavier again. So the version is checked, and a bump is
 * a deliberate act with a re-measure attached.
 */
const PIXI_PINNED = '8.18.1';

/**
 * PixiJS features Mio does not use, redirected to an empty module.
 *
 * **Why this is needed at all.** Pixi registers each feature by side
 * effect — `lib/index.mjs` imports two dozen `init.mjs` files that
 * call `extensions.add( … )` — and every one of them is named in
 * Pixi's `sideEffects` allowlist. A side effect is precisely what a
 * bundler may not remove, so tree-shaking cannot touch any of it, and
 * the pipes those four-line files register drag their whole renderer
 * subtree in behind them.
 *
 * **What Mio actually uses**, in full: `Application` (with the ticker
 * and resize plugins), `Container`, `Graphics`, `BlurFilter`, and the
 * WebGL renderer. That is the entire surface — `src/mio/mio.ts` names
 * exactly four Pixi symbols. Everything below is therefore dead
 * weight, and each entry says how we know.
 *
 * Measured with `BUNDLE_REPORT=1 npm run build`; the sizes are
 * unminified rendered bytes, which is the number the treemap shows.
 */
const PIXI_UNUSED = [
	// 83 kB. The event system. Mio's canvas is `pointer-events: none`
	// and no display object is ever given an `eventMode` — the drag is
	// a plain DOM `pointerdown` on a `<div>` handle riding the body,
	// which is the whole reason a click one pixel off Mio reaches the
	// page underneath.
	{ id: 'events/init.mjs' },
	// 20 kB. The accessibility layer builds a shadow DOM of focusable
	// divs over interactive display objects. There are none, and the
	// layer element is `aria-hidden` on purpose: Mio is decorative.
	{ id: 'accessibility/init.mjs' },
	// 11 kB. DOMPipe, for DOM elements positioned in the scene graph.
	{ id: 'dom/init.mjs' },
	// 11 kB. Spritesheet parsing. Mio loads no textures at all —
	// every pixel of it is drawn with Graphics calls.
	{ id: 'spritesheet/init.mjs' },
	// 84 kB. The WebGPU renderer, trimmed at the ONE import that
	// actually pulls it in: the dynamic `import()` inside
	// `autoDetectRenderer`. The barrel also re-exports it by name, and
	// stubbing that would break the re-export — but a named re-export
	// nothing imports is shaken out normally, so it costs nothing.
	//
	// `autoDetectRenderer` tries webgl → webgpu → canvas, so WebGPU is
	// only ever reached on a browser that has WebGPU but NOT WebGL,
	// which does not exist: every WebGPU implementation ships
	// alongside WebGL. The canvas fallback is deliberately KEPT —
	// that one IS reachable, on a machine with WebGL disabled or
	// blocklisted.
	{
		id: 'rendering/renderers/gpu/WebGPURenderer.mjs',
		from: 'rendering/renderers/autoDetectRenderer.mjs',
	},
	// 166 kB, and the single largest thing in the bundle after the
	// renderer itself: `@xmldom/xmldom`, an XML parser. It reaches the
	// bundle through exactly one import — `WebWorkerAdapter.parseXML`,
	// which needs a `DOMParser` because a Web Worker has none. This
	// runs in a document, where `browserExt` wins and the worker
	// adapter is never selected. (Note it is NOT the SVG parser; that
	// one uses the browser's own `DOMParser`.)
	{ id: '@xmldom/xmldom', stub: 'pixi-no-xmldom.ts' },
];

/**
 * Which entry in {@link PIXI_UNUSED} an import resolves to, if any.
 *
 * Matching is on the **resolved path**, not the specifier: the same
 * module is imported as `./events/init.mjs` from one file and
 * `../events/init.mjs` from another, and a specifier list silently
 * catches one and misses the other. Every match is additionally
 * confined to imports made from inside `pixi.js/lib`, so a relative
 * path this generic can never reach anything of ours.
 */
function matchUnused( source, importer ) {
	if ( ! importer || ! importer.includes( `pixi.js${ sep }lib` ) ) {
		return null;
	}
	/** `lib`-relative id → the absolute path it would have. */
	const libPath = ( id ) => `pixi.js${ sep }lib${ sep }${ id.split( '/' ).join( sep ) }`;
	const abs = source.startsWith( '.' )
		? resolve( dirname( importer ), source )
		: null;

	return (
		PIXI_UNUSED.find( ( entry ) => {
			// `from` pins the trim to one importer. Used where a module
			// is both dynamically imported (the reachable path, worth
			// trimming) and statically re-exported by the barrel (where
			// stubbing would break the re-export, and where tree-shaking
			// already removes it).
			if ( entry.from && ! importer.endsWith( libPath( entry.from ) ) ) {
				return false;
			}
			return abs
				? abs.endsWith( libPath( entry.id ) )
				: source === entry.id;
		} ) ?? null
	);
}

/**
 * Redirect the unused Pixi features to an empty module — or, where an
 * entry names one, to a stand-in that keeps a binding alive.
 *
 * `@xmldom/xmldom` needs the second kind: it is imported for a named
 * binding (`DOMParser`), and rollup rightly refuses to resolve that
 * against a module which exports nothing.
 */
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

/**
 * Fail the build if PixiJS has moved out from under {@link PIXI_UNUSED}.
 *
 * The trim list is silent when it stops matching, so silence is what
 * has to be made loud. Two checks: the version is the one the list was
 * measured against, and every path in the list still resolved at least
 * once during the build.
 */
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

	// `BUNDLE_REPORT=1 npm run build` writes `dist/mio.report.html`, a
	// treemap of what is actually in the file. Nearly all of it is
	// PixiJS, and the map is how you tell which parts — the answer is
	// not obvious and has been guessed wrong before. Off by default;
	// zero impact on shipped code.
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
				// `wp.hooks` → DOM CustomEvents.
				{ find: /^\.\.\/hooks$/, replacement: shim( 'hooks.ts' ) },
				// The "Make it yours" panel → nothing. This library
				// ships the official Mio only.
				{
					find: /^\.\/style-panel$/,
					replacement: shim( 'style-panel.ts' ),
				},
			],
		},
		build: {
			outDir: resolve( here, 'dist' ),
			// Two modes write into the same directory; the second run
			// must not delete what the first one produced.
			emptyOutDir: false,
			target: 'es2020',
			minify: isProd ? 'esbuild' : false,
			sourcemap: false,
			lib: {
				entry: resolve( here, 'src/entry.ts' ),
				// IIFE, not ESM: the point of this build is a file a
				// blog can reference from a plain `<script src>`, in a
				// theme footer or a "custom HTML" box, with no module
				// support and no bundler on the other side.
				formats: [ 'iife' ],
				// NOT `Mio`. Vite's IIFE wrapper ends with
				// `var <name> = (function(){…})()`, which runs AFTER
				// the bundle body and would overwrite the tidy
				// `window.Mio` the entry publishes with the module's
				// export namespace. The entry owns that global; this
				// name is just the wrapper's variable.
				name: 'MioBundle',
				fileName: () => ( isProd ? 'mio.min.js' : 'mio.js' ),
			},
		},
	};
} );
