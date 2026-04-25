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
 * **Workers**: Phase 1a does NOT enable workers (we want syntax
 * highlighting only, to validate the embed in isolation). Phase 1b
 * adds `MonacoEnvironment.getWorkerUrl` returning a same-origin Blob
 * URL — see {@link https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-amd-cross.md}
 * for the standard cross-origin worker workaround we'll implement
 * there.
 *
 * @public
 * @since 0.18.0
 */

import loader from '@monaco-editor/loader';

import type * as Monaco from 'monaco-editor';

declare global {
	interface Window {
		wpDesktopCodeEditorConfig?: {
			monacoVendorUrl: string;
			pluginUrl: string;
		};
	}
}

/** Resolved Monaco module — cached after first successful load. */
let cached: typeof Monaco | null = null;
let pending: Promise< typeof Monaco > | null = null;

/**
 * Idempotently load Monaco from the vendored AMD distributable.
 *
 * Resolves with the `monaco` namespace on success. Subsequent calls
 * return the cached module without re-running the loader.
 *
 * @since 0.18.0
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

	loader.config( {
		paths: { vs: config.monacoVendorUrl },
	} );

	pending = loader.init().then( ( monaco ) => {
		cached = monaco as unknown as typeof Monaco;
		return cached;
	} );

	return pending;
}
