/**
 * Monaco editor AMD loader bootstrap.
 *
 * Why this exists: Monaco's official distribution is an AMD package
 * (`vendor/monaco-editor/min/vs/loader.js` + `vs/editor/editor.main.js`
 * + per-language workers). We can't run it through Vite's IIFE
 * pipeline — the dynamic worker URLs Monaco emits get mangled — so we
 * vendor the AMD distributable as-is and load it at runtime.
 *
 * `@monaco-editor/loader` is a tiny wrapper that promisifies Monaco's
 * AMD bootstrap and dedupes concurrent calls. We point its `paths.vs`
 * at our vendored copy.
 *
 * **`define` / `require` collision** — the loader handles this for
 * us: it snapshots `window.define` / `window.require` before bootstrap
 * and restores them once Monaco's modules have loaded. So a parallel
 * RequireJS/UMD plugin on the same admin page keeps working. We
 * intentionally do NOT add our own snapshot/restore on top — doing so
 * races against the loader's restore and tries to `delete` non-
 * configurable Window properties, which throws in strict mode.
 *
 * **Cross-origin Web Workers**. Monaco spawns one Web Worker per
 * language service (TS, JSON, CSS, HTML). Workers are subject to
 * same-origin rules: a worker fetched from `wp-content/plugins/...`
 * via `new Worker(absoluteUrl)` fails the same-origin check whenever
 * the page and the worker are on different origins (CDN setups,
 * domain-mapped sites, headless frontends).
 *
 * The standard workaround is to spawn the worker from a **same-origin
 * Blob URL** that itself does `importScripts('<absolute>/workerMain.js')`.
 * `importScripts` from inside a worker is allowed for any same-origin
 * or CORS-permitted URL — the cross-origin barrier moves from
 * worker-creation to script-load, and the WP-served worker is
 * fetchable normally. See:
 *   https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-amd-cross.md
 *
 * @public
 * @since 0.7.0
 */

import loader from '@monaco-editor/loader';

import { registerPhpProviders } from './providers/php';

import type * as Monaco from 'monaco-editor';

/**
 * Shape of the config every editor module reads. Injected as
 * `window.wpDesktopCodeEditorConfig` by
 * `desktop_mode_code_editor_serve_bundle()` in `includes/window.php`,
 * which prepends the config assignment to the AJAX-served bundle.
 * Re-declared here in `monaco-bootstrap.ts` only — every other module
 * imports the type to keep one canonical declaration.
 */
export interface CodeEditorConfig {
	monacoVendorUrl: string;
	pluginUrl: string;
	restNonce: string;
	treeUrl: string;
	fileUrl: string;
	phpSymbolsUrl: string;
	phpSymbolUrl: string;
}

declare global {
	interface Window {
		wpDesktopCodeEditorConfig?: CodeEditorConfig;
	}
}

/** Resolved Monaco module — cached after first successful load. */
let cached: typeof Monaco | null = null;
let pending: Promise< typeof Monaco > | null = null;

/**
 * Install `self.MonacoEnvironment.getWorkerUrl` so Monaco's worker
 * spawn returns a same-origin Blob URL that imports the real worker.
 *
 * Idempotent: re-installing on a subsequent `loadMonaco()` call is
 * harmless because the function only reads `baseUrl` at worker-spawn
 * time, not at install time.
 *
 * @internal
 */
function installWorkerEnvironment( monacoVendorUrl: string ): void {
	// Monaco's loader expects `paths.vs` to point at the directory
	// holding `loader.js` + worker code (i.e. `…/min/vs`). The worker
	// importScripts URL needs the absolute path to `workerMain.js`,
	// also under `vs/base/worker/` — so derive it from the same root.
	const workerMainUrl = `${ monacoVendorUrl }/base/worker/workerMain.js`;

	// `vs/` lives under this — Monaco's worker reads
	// `MonacoEnvironment.baseUrl` to resolve sibling modules
	// (e.g. the language-specific worker the AMD loader will pull in
	// after `workerMain` boots).
	const baseUrl = monacoVendorUrl.replace( /\/vs$/, '' );

	const proxy = `
		self.MonacoEnvironment = { baseUrl: '${ baseUrl }' };
		importScripts('${ workerMainUrl }');
	`;

	( self as unknown as {
		MonacoEnvironment?: { getWorkerUrl: ( m: string, l: string ) => string };
	} ).MonacoEnvironment = {
		getWorkerUrl: () =>
			URL.createObjectURL(
				new Blob( [ proxy ], { type: 'text/javascript' } ),
			),
	};
}

/**
 * Idempotently load Monaco from the vendored AMD distributable.
 *
 * Resolves with the `monaco` namespace on success. Subsequent calls
 * return the cached module without re-running the loader.
 *
 * @since 0.7.0
 */
export async function loadMonaco(): Promise< typeof Monaco > {
	if ( cached ) {
		return cached;
	}
	if ( pending ) {
		return pending;
	}

	const config = window.wpDesktopCodeEditorConfig;
	if ( ! config?.monacoVendorUrl ) {
		throw new Error(
			'wp-desktop-code-editor: monacoVendorUrl missing from wpDesktopCodeEditorConfig — is window.php enqueued?',
		);
	}

	installWorkerEnvironment( config.monacoVendorUrl );

	loader.config( {
		paths: { vs: config.monacoVendorUrl },
	} );

	pending = loader.init().then( ( monaco ) => {
		cached = monaco as unknown as typeof Monaco;
		configureLanguageServices( cached );
		registerPhpProviders( cached );
		return cached;
	} );

	return pending;
}

/**
 * Tune Monaco's bundled language services for a WordPress-plugin /
 * theme editing context.
 *
 * - **TypeScript / JavaScript** — accept JSX/TSX, ES2020 target,
 *   NodeJs module resolution, allow plain `.js` files in the same
 *   project. Plugin authors editing block-editor source get JSX
 *   completion out of the box.
 * - **CSS / SCSS / HTML / JSON** — left at Monaco defaults; their
 *   workers boot with sensible behaviour already.
 *
 * @internal
 */
function configureLanguageServices( monaco: typeof Monaco ): void {
	const ts = monaco.languages.typescript;

	const compilerOptions = {
		target: ts.ScriptTarget.ES2020,
		module: ts.ModuleKind.ESNext,
		jsx: ts.JsxEmit.React,
		jsxFactory: 'React.createElement',
		jsxFragmentFactory: 'React.Fragment',
		moduleResolution: ts.ModuleResolutionKind.NodeJs,
		allowJs: true,
		allowNonTsExtensions: true,
		esModuleInterop: true,
		isolatedModules: true,
		resolveJsonModule: true,
		strict: false,
	};

	ts.typescriptDefaults.setCompilerOptions( compilerOptions );
	ts.javascriptDefaults.setCompilerOptions( compilerOptions );

	// Keep diagnostics noisy enough to be useful but quiet enough not
	// to drown a single-file edit (no project graph means cross-file
	// references show up as "cannot find module" otherwise).
	ts.typescriptDefaults.setDiagnosticsOptions( {
		noSemanticValidation: false,
		noSyntaxValidation: false,
		// 2307 — "Cannot find module 'X'": single-file context, almost
		// always noise. Re-enable once Phase 2's file tree gives the
		// worker a project to resolve against.
		// 2304 — "Cannot find name 'X'": same.
		diagnosticCodesToIgnore: [ 2307, 2304 ],
	} );
	ts.javascriptDefaults.setDiagnosticsOptions( {
		noSemanticValidation: false,
		noSyntaxValidation: false,
		diagnosticCodesToIgnore: [ 2307, 2304 ],
	} );
}
