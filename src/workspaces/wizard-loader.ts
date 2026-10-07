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

function showPlaceholder(): void {
	showSurfacePlaceholder( {
		id: PLACEHOLDER_ID,
		label: __( 'Opening the workspace wizard…' ),

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

export function openWorkspaceWizard( opts: WorkspaceWizardOptions ): void {
	const api = loadedApi();
	if ( api ) {
		api.openWorkspaceWizard( opts );
		return;
	}
	const url = bundleUrl();
	if ( ! url ) {
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

export function closeWorkspaceWizard(): void {
	generation++;
	hideSurfacePlaceholder( PLACEHOLDER_ID );
	loadedApi()?.closeWorkspaceWizard();
}
