/**
 * OpenStation — the zoom guard.
 *
 * An installed app does not zoom. The viewport meta already says so
 * (`maximum-scale=1, user-scalable=no`, `openstation_mode_viewport_meta()`)
 * and mobile Safari has ignored that meta for pinch since iOS 10, so
 * the second half of the answer is here: while the document is
 * stamped `mobile` or `standalone`, the gestures that would scale
 * the page are cancelled at the document —
 *
 *   - Safari's proprietary `gesture*` events, the pinch on iOS and
 *     on a Mac trackpad;
 *   - a two-finger `touchmove`, the pinch on browsers without them;
 *   - a `wheel` with the control key held, the trackpad pinch
 *     Chromium reports.
 *
 * Every listener reads the stamps at event time, so the guard is
 * installed once at boot and follows the mode and the display
 * without a subscription. Double-tap zoom is CSS's job
 * (`touch-action: pan-x pan-y` in `mobile.css`). The focus zoom on a
 * small input is the kit's: every field reads
 * `--os-ui-field-font-size`, which the phone layer sets to 16px, the
 * size under which iOS stops zooming into a control.
 *
 * Nothing here runs on a desktop in a browser tab: pinch-to-zoom is
 * an accessibility affordance there and stays.
 */
import { isMobileStamped, isStandaloneStamped } from './stamp';

export interface ZoomGuardOptions {
	/** Defaults to `document.documentElement`. */
	root?: Element;
	/** Defaults to `document`. */
	doc?: Pick< Document, 'addEventListener' | 'removeEventListener' >;
}

/** Whether the guard is in force for the stamped root. */
export function zoomGuardActive( root: Element ): boolean {
	return isMobileStamped( root ) || isStandaloneStamped( root );
}

/**
 * Cancel page zoom while the document is stamped `mobile` or
 * `standalone`. Returns the uninstaller.
 */
export function installZoomGuard( opts: ZoomGuardOptions = {} ): () => void {
	const root = opts.root ?? document.documentElement;
	const doc = opts.doc ?? document;

	const cancel = ( e: Event ): void => {
		if ( zoomGuardActive( root ) && e.cancelable ) {
			e.preventDefault();
		}
	};
	const onTouchMove = ( e: Event ): void => {
		if ( ( e as TouchEvent ).touches?.length > 1 ) {
			cancel( e );
		}
	};
	const onWheel = ( e: Event ): void => {
		if ( ( e as WheelEvent ).ctrlKey ) {
			cancel( e );
		}
	};

	const active = { passive: false } as const;
	doc.addEventListener( 'gesturestart', cancel, active );
	doc.addEventListener( 'gesturechange', cancel, active );
	doc.addEventListener( 'gestureend', cancel, active );
	doc.addEventListener( 'touchmove', onTouchMove, active );
	doc.addEventListener( 'wheel', onWheel, active );

	return () => {
		doc.removeEventListener( 'gesturestart', cancel );
		doc.removeEventListener( 'gesturechange', cancel );
		doc.removeEventListener( 'gestureend', cancel );
		doc.removeEventListener( 'touchmove', onTouchMove );
		doc.removeEventListener( 'wheel', onWheel );
	};
}
