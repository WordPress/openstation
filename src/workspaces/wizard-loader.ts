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
 *
 * While that first fetch runs, the modal's frame stands in for it
 * (`src/ui/surface-placeholder.ts`). The `+` has already made the new
 * desk and landed on it by then, so without one the user is looking
 * at an empty desk that ignored their click for as long as the bundle
 * takes, seconds on a slow connection.
 */

import { __ } from '../i18n';
import {
	hideSurfacePlaceholder,
	showSurfacePlaceholder,
	SURFACE_HANDOFF_MS,
} from '../ui/surface-placeholder';
import type { WorkspaceWizardOptions } from './wizard';
import { loadVendorScript } from '../wallpapers/vendor-loader';

const PLACEHOLDER_ID = 'os-workspace-wizard-loading';

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

/**
 * Paint the wizard's frame while its bundle loads.
 *
 * The declarations mirror `<os-modal size="lg">`
 * (`src/ui/components/os-modal/os-modal.styles.ts`): centred, the same
 * scrim and blur, the same width, surface, edge and radius, so the
 * modal opens in the place the placeholder already held. The edge
 * reads the modal's own border token: `<os-modal>` re-points
 * `--os-ui-border` to it on its host, and this card is not inside one.
 */
function showPlaceholder(): void {
	showSurfacePlaceholder( {
		id: PLACEHOLDER_ID,
		label: __( 'Opening the workspace wizard…' ),
		// Escape before the bundle lands is a cancel, exactly as it is
		// once the modal is up.
		onCancel: closeWorkspaceWizard,
		layerStyle: [
			'align-items:center',
			'justify-content:center',
			'padding:16px',
		],
		scrimStyle: [
			'background-color:var(--os-ui-scrim,rgba(0,0,0,0.45))',
			'background-image:var(--os-ui-scrim-image,none)',
			'background-repeat:var(--os-ui-scrim-image-repeat,repeat)',
			'background-size:var(--os-ui-scrim-image-size,auto)',
			'background-position:var(--os-ui-scrim-image-position,center)',
			'backdrop-filter:blur(2px)',
			'-webkit-backdrop-filter:blur(2px)',
		],
		cardStyle: [
			'max-width:min(760px,94vw)',
			'padding:20px',
			'border-radius:10px',
			'background-color:var(--os-ui-modal-bg,#1d2327)',
			'color:var(--os-ui-modal-fg,var(--os-fg,#fff))',
			'border:1px solid var(--os-ui-modal-border,rgba(255,255,255,0.25))',
			'box-shadow:0 20px 50px rgba(0,0,0,0.6)',
		],
	} );
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
	showPlaceholder();
	void loadVendorScript( url )
		.then( () => {
			if ( myGen !== generation ) {
				return;
			}
			loadedApi()?.openWorkspaceWizard( opts );
			hideSurfacePlaceholder( PLACEHOLDER_ID, SURFACE_HANDOFF_MS );
		} )
		.catch( ( err ) => {
			if ( myGen === generation ) {
				hideSurfacePlaceholder( PLACEHOLDER_ID );
			}
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
	hideSurfacePlaceholder( PLACEHOLDER_ID );
	loadedApi()?.closeWorkspaceWizard();
}
