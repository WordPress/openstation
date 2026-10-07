import { HOOKS, addAction } from './../hooks';
import { armWindowReveal, playWindowReveal } from '../reveals/surface';
import {
	LOADING_CONTENT_FADE_IN_MS,
	LOADING_OVERLAY_CLASS,
	LOADING_OVERLAY_FADE_OUT_MS,
	LOADING_OVERLAY_VISIBLE_CLASS,
} from './constants';
import {
	ensureLoadingOverlay,
	loadingCycle,
	LOADING_BODY_CLASS,
	LOADING_HANDOFF_BODY_CLASS,
	LOADING_STARTED_ATTR,
	removeLoadingOverlay,
	stampLoadingStart,
} from './dom';

const FADE_OUT_MS = LOADING_OVERLAY_FADE_OUT_MS;

let _installed = false;

function findWindowElement( windowId: string ): HTMLElement | null {
	if ( ! windowId ) {
		return null;
	}
	return document.getElementById( `wp-window-${ windowId }` );
}

export function installWindowLoadingTransitions(): void {
	if ( _installed ) {
		return;
	}
	_installed = true;
	_installSubscriptions();
}

export function _resetWindowLoadingTransitionsForTests(): void {
	_installed = false;
}

function _installSubscriptions(): void {
	addAction(
		HOOKS.WINDOW_CONTENT_LOADING,
		'desktop-mode/window-loading-enter',
		( e: { windowId?: string } ) => {
			const el = findWindowElement( e?.windowId ?? '' );
			if ( ! el ) {
				return;
			}
			const body = el.querySelector< HTMLElement >(
				':scope .os-window__body',
			);
			if ( ! body ) {
				return;
			}

			el.setAttribute( 'aria-busy', 'true' );

			body.classList.remove( LOADING_HANDOFF_BODY_CLASS );
			body.classList.add( LOADING_BODY_CLASS );

			stampLoadingStart( body );
			ensureLoadingOverlay( el );

			armWindowReveal( el );
		},
	);

	addAction(
		HOOKS.WINDOW_CONTENT_LOADED,
		'desktop-mode/window-loading-exit',
		( e: { windowId?: string } ) => {
			const el = findWindowElement( e?.windowId ?? '' );
			if ( ! el ) {
				return;
			}
			const body = el.querySelector< HTMLElement >(
				':scope .os-window__body',
			);
			if ( ! body ) {
				return;
			}

			el.removeAttribute( 'aria-busy' );

			const spinnerWasVisible = !! body
				.querySelector( `:scope .${ LOADING_OVERLAY_CLASS }` )
				?.classList.contains( LOADING_OVERLAY_VISIBLE_CLASS );

			body.classList.remove( LOADING_BODY_CLASS );
			body.removeAttribute( LOADING_STARTED_ATTR );

			if ( ! spinnerWasVisible ) {
				removeLoadingOverlay( el );

				playWindowReveal( el );
				return;
			}

			body.classList.add( LOADING_HANDOFF_BODY_CLASS );

			const cycle = loadingCycle( body );

			playWindowReveal( el );

			window.setTimeout( () => {
				if ( loadingCycle( body ) !== cycle ) {
					return;
				}

				if ( ! body.classList.contains( LOADING_BODY_CLASS ) ) {
					removeLoadingOverlay( el );
				}
			}, FADE_OUT_MS );

			window.setTimeout( () => {
				if ( loadingCycle( body ) !== cycle ) {
					return;
				}
				if ( ! body.classList.contains( LOADING_BODY_CLASS ) ) {
					body.classList.remove( LOADING_HANDOFF_BODY_CLASS );
				}
			}, FADE_OUT_MS + LOADING_CONTENT_FADE_IN_MS );
		},
	);

	addAction(
		HOOKS.INIT,
		'desktop-mode/loading-overlay-init-sweep',
		() => {
			queueMicrotask( () => repaintLoadingOverlays() );
		},
	);
}

export function repaintLoadingOverlays(): void {
	const bodies = document.querySelectorAll< HTMLElement >(
		'.os-window__body--loading',
	);
	bodies.forEach( ( body ) => {
		const windowEl = body.closest< HTMLElement >( '.os-window' );
		if ( ! windowEl ) {
			return;
		}
		body.querySelector( ':scope .os-window__loading' )?.remove();
		ensureLoadingOverlay( windowEl );
	} );
}
