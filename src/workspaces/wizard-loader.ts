/**
 * Workspace-wizard lazy bundle — loader (main-bundle side).
 *
 * Mirrors `src/item-visibility-menu-loader.ts`: on the first open it
 * `<script>`-injects `assets/js/workspace-wizard[.min].js` (URL from
 * `openStationConfig.workspaceWizardBundleUrl`), then forwards the
 * call to the API the bundle published on
 * `window.openStationWorkspaceWizard`.
 *
 * The generation guard covers the user pressing `+` twice while the
 * first fetch is still in flight: only the most recent call opens, so
 * they do not get two modals stacked on each other.
 */

import type { WorkspaceWizardOptions } from './wizard';
import { loadVendorScript } from '../wallpapers/vendor-loader';

interface WizardApi {
	openWorkspaceWizard: ( opts: WorkspaceWizardOptions ) => void;
	closeWorkspaceWizard: () => void;
}

let generation = 0;

function loadedApi(): WizardApi | null {
	return (
		( window as unknown as { openStationWorkspaceWizard?: WizardApi } )
			.openStationWorkspaceWizard ?? null
	);
}

function bundleUrl(): string {
	return (
		(
			window as unknown as {
				openStationConfig?: { workspaceWizardBundleUrl?: string };
			}
		).openStationConfig?.workspaceWizardBundleUrl ?? ''
	);
}

/** Open the wizard, loading its bundle on first use. */
export function openWorkspaceWizard( opts: WorkspaceWizardOptions ): void {
	const api = loadedApi();
	if ( api ) {
		api.openWorkspaceWizard( opts );
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
			loadedApi()?.openWorkspaceWizard( opts );
		} )
		.catch( ( err ) => {
			if ( typeof console !== 'undefined' ) {
				console.warn(
					'[openstation] workspace-wizard bundle failed to load; wizard suppressed:',
					err,
				);
			}
		} );
}

/** Close it, if the bundle is loaded and something is open. */
export function closeWorkspaceWizard(): void {
	// Bumped so an open still in flight resolves into a no-op rather
	// than opening a modal the caller has already dismissed.
	generation++;
	loadedApi()?.closeWorkspaceWizard();
}
