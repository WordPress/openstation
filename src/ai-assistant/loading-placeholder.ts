import { __ } from '../i18n';
import {
	hideSurfacePlaceholder,
	showSurfacePlaceholder,
	SURFACE_HANDOFF_MS,
} from '../ui/surface-placeholder';

const PLACEHOLDER_ID = 'os-ai-loading';

export function showPalettePlaceholder( onCancel?: () => void ): void {
	showSurfacePlaceholder( {
		id: PLACEHOLDER_ID,
		label: __( 'Starting the command palette…' ),
		onCancel,
		layerStyle: [
			'align-items:flex-start',
			'justify-content:center',
			'padding-top:clamp(60px,16vh,180px)',
			'padding-inline:16px',
		],
		scrimStyle: [
			'background-color:var(--os-ui-scrim,rgba(0,0,0,0.36))',
			'background-image:var(--os-ui-scrim-image,none)',
			'background-repeat:var(--os-ui-scrim-image-repeat,repeat)',
			'background-size:var(--os-ui-scrim-image-size,auto)',
			'background-position:var(--os-ui-scrim-image-position,center)',
			'backdrop-filter:blur(8px) saturate(0.75)',
			'-webkit-backdrop-filter:blur(8px) saturate(0.75)',
		],
		cardStyle: [
			'max-width:600px',
			'padding:20px 22px',
			'border-radius:16px',
			'background-color:var(--os-ai-panel-bg,var(--os-ui-surface,rgba(255,255,255,0.97)))',
			'color:var(--os-ui-fg,#1d2327)',
			'font-family:var(--os-ui-font,inherit)',
			'box-shadow:0 0 0 1px var(--os-ui-border,rgba(0,0,0,0.07)),0 4px 16px rgba(0,0,0,0.12),0 24px 64px rgba(0,0,0,0.22)',
		],
	} );
}

export function hidePalettePlaceholder( handoff = false ): void {
	hideSurfacePlaceholder( PLACEHOLDER_ID, handoff ? SURFACE_HANDOFF_MS : 0 );
}
