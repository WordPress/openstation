/**
 * Workspace-editor lazy bundle — loader (main-bundle side).
 *
 * Mirrors `src/item-visibility-menu-loader.ts`: on the first open it
 * `<script>`-injects `assets/js/workspace-editor[.min].js` (URL from
 * `openStationConfig.workspaceEditorBundleUrl`), then forwards the
 * call to the API the bundle published on
 * `window.openStationWorkspaceEditor`.
 *
 * The generation guard covers the user picking "Edit this workspace…"
 * twice while the first fetch is still in flight: only the most recent
 * call opens, so they do not get two modals stacked on each other.
 */

import type { WorkspaceEditorOptions } from './editor';
import { loadVendorScript } from '../wallpapers/vendor-loader';

interface EditorApi {
	openWorkspaceEditor: ( opts: WorkspaceEditorOptions ) => void;
	closeWorkspaceEditor: () => void;
}

let generation = 0;

function loadedApi(): EditorApi | null {
	return (
		( window as unknown as { openStationWorkspaceEditor?: EditorApi } )
			.openStationWorkspaceEditor ?? null
	);
}

function bundleUrl(): string {
	return (
		(
			window as unknown as {
				openStationConfig?: { workspaceEditorBundleUrl?: string };
			}
		).openStationConfig?.workspaceEditorBundleUrl ?? ''
	);
}

/** Open the workspace editor, loading its bundle on first use. */
export function openWorkspaceEditor( opts: WorkspaceEditorOptions ): void {
	const api = loadedApi();
	if ( api ) {
		api.openWorkspaceEditor( opts );
		return;
	}
	const url = bundleUrl();
	if ( ! url ) {
		// No URL configured — vitest / jsdom, or a misconfigured
		// deploy. Nothing sane to inject, so stay silent rather than
		// throwing out of a click handler.
		return;
	}
	const myGen = ++generation;
	void loadVendorScript( url )
		.then( () => {
			if ( myGen !== generation ) {
				return;
			}
			loadedApi()?.openWorkspaceEditor( opts );
		} )
		.catch( ( err ) => {
			if ( typeof console !== 'undefined' ) {
				console.warn(
					'[openstation] workspace-editor bundle failed to load; editor suppressed:',
					err,
				);
			}
		} );
}

/** Close it, if the bundle is loaded and something is open. */
export function closeWorkspaceEditor(): void {
	// Bumped so an open still in flight resolves into a no-op rather
	// than opening a modal the caller has already dismissed.
	generation++;
	loadedApi()?.closeWorkspaceEditor();
}
