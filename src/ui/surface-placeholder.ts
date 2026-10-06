/**
 * OpenStation: a stand-in for a lazily loaded surface.
 *
 * Some surfaces live in their own bundle and are fetched the first time
 * the user asks for them: the command palette, the workspace wizard. On
 * a slow connection that fetch is seconds long, and until it lands the
 * click or keystroke that asked for the surface produced nothing at
 * all, so the shell looked frozen. This paints the surface's frame
 * straight away, in the position it is about to occupy (scrim, card,
 * spinner and a line saying what is coming), and the caller takes it
 * down when the real surface replaces it or the load fails.
 *
 * `src/ui/inline-loader.ts` covers the same gap inside a container (a
 * widget card, a panel body). This is the full-viewport version, for a
 * surface that has no container yet because it IS the container.
 *
 * ## Three behaviours worth knowing
 *
 * **Everything is inline-styled.** The surface's stylesheet is often
 * one of the things still in flight, so a class-based skeleton would
 * render unstyled for exactly the window it exists to cover. The caller
 * passes the geometry and skin as declarations that mirror the real
 * surface's rules, token-with-literal-fallback included, so the swap
 * lands where the placeholder already was.
 *
 * **It is a status, not a dialog.** `role="status"` and a polite live
 * region: announcing a dialog would move focus away from wherever the
 * real surface is about to claim it.
 *
 * **Escape cancels, and so does a click on the dimmed area.** During
 * the load nothing else is listening: the real surface binds both to
 * an element that does not exist yet. So the placeholder listens for
 * Escape on `document` and for a click on its own scrim, takes itself
 * down and reports the cancel, which the caller uses to drop its
 * pending open, so the surface does not appear afterwards behind the
 * user's back. The scrim dims the whole desk, so it has to behave the
 * way it looks: a layer that let the pointer through would send a
 * click meant to dismiss it to whichever dock tile sat underneath.
 */

import { buildLoadingSpinner } from './inline-loader';

/** Options for {@link showSurfacePlaceholder}. */
export interface SurfacePlaceholderOptions {
	/** Element id; one placeholder per id is ever on screen. */
	id: string;
	/** Visible, announced status text. */
	label: string;
	/** Declarations for the full-viewport layer: where the card sits. */
	layerStyle: string[];
	/** Declarations for the scrim behind the card. */
	scrimStyle: string[];
	/** Declarations for the card: the real surface's own skin. */
	cardStyle: string[];
	/** Invoked when the user presses Escape before the surface arrives. */
	onCancel?: () => void;
}

/**
 * How long a placeholder takes to fade out under the surface replacing
 * it: the length of that surface's own entrance fade (the palette's
 * 180 ms, `<os-modal>`'s 220 ms). See {@link hideSurfacePlaceholder}.
 */
export const SURFACE_HANDOFF_MS = 200;

interface Painted {
	el: HTMLElement;
	onKey: ( e: KeyboardEvent ) => void;
	/** Timer of a handoff in progress: the element is on its way out. */
	leaving?: number;
}

const painted = new Map< string, Painted >();

/**
 * Paint the placeholder, unless one with this id is already up.
 *
 * Safe to call repeatedly: a second click or keystroke while the first
 * load is still running reuses the element rather than stacking a copy.
 */
export function showSurfacePlaceholder( options: SurfacePlaceholderOptions ): void {
	const current = painted.get( options.id );
	if ( current && current.el.isConnected && undefined === current.leaving ) {
		return;
	}
	hideSurfacePlaceholder( options.id );

	const cancel = (): void => {
		hideSurfacePlaceholder( options.id );
		options.onCancel?.();
	};
	const onKey = ( e: KeyboardEvent ): void => {
		if ( 'Escape' === e.key ) {
			cancel();
		}
	};
	document.addEventListener( 'keydown', onKey );

	const el = document.createElement( 'div' );
	el.id = options.id;
	el.setAttribute( 'role', 'status' );
	el.setAttribute( 'aria-live', 'polite' );
	el.style.cssText = [
		'position:fixed',
		'inset:0',
		// One below the palette and `<os-modal>` (10000), so the real
		// surface lands on top of it during the handoff.
		'z-index:9999',
		'display:flex',
		'box-sizing:border-box',
		...options.layerStyle,
	].join( ';' );

	const scrim = document.createElement( 'div' );
	scrim.setAttribute( 'aria-hidden', 'true' );
	scrim.style.cssText = [
		'position:absolute',
		'inset:0',
		...options.scrimStyle,
	].join( ';' );

	const card = document.createElement( 'div' );
	card.style.cssText = [
		'position:relative',
		'display:flex',
		'align-items:center',
		'gap:12px',
		'width:100%',
		'box-sizing:border-box',
		'font-size:14px',
		'font-family:inherit',
		...options.cardStyle,
	].join( ';' );

	const label = document.createElement( 'span' );
	label.textContent = options.label;

	card.appendChild( buildLoadingSpinner() );
	card.appendChild( label );
	el.appendChild( scrim );
	el.appendChild( card );
	// Outside the card only, as on the surfaces this stands in for: a
	// click on the palette's panel or the modal's dialog dismisses
	// neither.
	el.addEventListener( 'click', ( e ) => {
		if ( ! ( e.target instanceof Node && card.contains( e.target ) ) ) {
			cancel();
		}
	} );
	document.body.appendChild( el );
	painted.set( options.id, { el, onKey } );
}

/**
 * Remove the placeholder with this id, if one is up.
 *
 * @param id      The id it was shown with.
 * @param afterMs Fade it out over this long, under the surface that is
 *                replacing it. The layer sits one step below the
 *                surfaces it stands in for, so the real one covers it;
 *                removing it in the same frame would leave the real
 *                one's scrim fading in from nothing, a flash of the
 *                desk between two dimmed states. A fade rather than a
 *                hold, because two full scrims stacked are darker than
 *                either: held, the backdrop sank while the real one
 *                faded in and jumped back when this one was removed.
 *                Fading out against the fade in keeps the dim level.
 *                It stops listening for Escape and for the pointer at
 *                once either way: the surface owns both from here.
 */
export function hideSurfacePlaceholder( id: string, afterMs = 0 ): void {
	const current = painted.get( id );
	if ( current && afterMs > 0 ) {
		if ( undefined !== current.leaving ) {
			// Already on its way out. Two opens queued behind one load
			// both land here, and the second must not cut the fade
			// short through the sweep below.
			return;
		}
		document.removeEventListener( 'keydown', current.onKey );
		const { el } = current;
		el.style.pointerEvents = 'none';
		el.style.transition = `opacity ${ afterMs }ms linear`;
		el.style.opacity = '0';
		current.leaving = window.setTimeout( () => {
			el.remove();
			if ( painted.get( id ) === current ) {
				painted.delete( id );
			}
		}, afterMs );
		return;
	}
	if ( current ) {
		window.clearTimeout( current.leaving );
		document.removeEventListener( 'keydown', current.onKey );
		current.el.remove();
		painted.delete( id );
	}
	// A stray copy from an earlier bundle version, or one left behind
	// if the map entry was dropped without a remove.
	document.getElementById( id )?.remove();
}
