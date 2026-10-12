/**
 * OpenStation — first-open placeholder for the command palette.
 *
 * The palette is lazy in three separate ways, and the first ⌘K of a
 * session pays for all of them: the implementation bundle
 * (`ai-assistant.min.js`), its stylesheet (a `deferredStyles` entry),
 * and the Core command-palette runtime the manifest replays. Until the
 * first two land, pressing ⌘K would do nothing visible at all, and the
 * shell would look like it had ignored the keystroke, which is the
 * exact moment a user presses it again.
 *
 * So we paint the palette's frame immediately through
 * `src/ui/surface-placeholder.ts` and swap it for the real thing when
 * it arrives. The declarations below mirror `.os-ai`, `.os-ai__backdrop`
 * and `.os-ai__panel` in `assets/css/ai-assistant.css`: same `clamp()`
 * offset from the top, same scrim and blur, same 600px cap, radius and
 * hairline ring. When the panel replaces it, it lands where the
 * placeholder already was, on a backdrop that was already there. A
 * label floating over whatever window was underneath, with no scrim
 * and no edge, read as a stray tooltip rather than as the palette.
 */

import { __ } from '../i18n';
import {
	hideSurfacePlaceholder,
	showSurfacePlaceholder,
	SURFACE_HANDOFF_MS,
} from '../ui/surface-placeholder';

const PLACEHOLDER_ID = 'os-ai-loading';

/**
 * Paint the placeholder, unless one is already up.
 *
 * @param onCancel Invoked when the user presses Escape before the
 *                 panel arrives. The caller uses it to drop its
 *                 pending-open intent, so the panel does not open
 *                 afterwards behind the user's back.
 */
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

/**
 * Remove the placeholder, if one is up.
 *
 * @param handoff Keep it under the panel that just opened until the
 *                panel's entrance fade is over, rather than leaving
 *                that fade to start from an undimmed desk.
 */
export function hidePalettePlaceholder( handoff = false ): void {
	hideSurfacePlaceholder( PLACEHOLDER_ID, handoff ? SURFACE_HANDOFF_MS : 0 );
}
