/**
 * The notch — a pill at the top centre of the shell.
 *
 * The site assistant's front door, and where the shell says short
 * things: `say()` expands it with a message and collapses it again.
 *
 * **It never reserves work area.** It floats above windows and dims
 * itself under a maximized one rather than pushing it down. Taking
 * height would make it another hardcoded claimant on a work-area
 * rectangle that already has several disagreeing answers.
 *
 * Top-centre because window title text reads from the leading edge of
 * the title bar's `flex: 1` region, leaving the centre of a maximized
 * window's top edge reliably empty.
 */

import { __ } from './i18n';
import { OS_SITE_LOGO_SVG } from './ui/site-logo-icon';

/** How long a message stays up before the notch shrinks back. */
const MESSAGE_MS = 2400;

/** Root element id, so a second boot can find and replace its own. */
const NOTCH_ID = 'os-notch';

export interface NotchApi {
	/**
	 * Expand the notch with a short message, then collapse.
	 *
	 * Deliberately not a queue: two things happening at once is one
	 * situation, not two messages, and a queue would still be draining
	 * an old one after the thing it described had finished.
	 */
	say( text: string ): void;
	/** Remove the notch and drop its listeners. */
	destroy(): void;
}

/**
 * Mount the notch.
 *
 * @param shell Shell root to append to.
 * @param open  Opens the assistant. Injected rather than imported so
 *              this module never reaches into the lazy assistant
 *              bundle — the notch paints on every boot, and the
 *              assistant is downloaded only if asked for.
 */
export function mountNotch(
	shell: HTMLElement,
	open: () => void,
): NotchApi {
	document.getElementById( NOTCH_ID )?.remove();

	const root = document.createElement( 'button' );
	root.type = 'button';
	root.id = NOTCH_ID;
	root.className = 'os-notch';
	root.setAttribute( 'aria-label', __( 'Open the site assistant' ) );

	const glyph = document.createElement( 'span' );
	glyph.className = 'os-notch__glyph';
	glyph.setAttribute( 'aria-hidden', 'true' );
	glyph.innerHTML = OS_SITE_LOGO_SVG;
	root.appendChild( glyph );

	// The resting label. A bare glyph at the top edge read as
	// decoration rather than as somewhere to go — naming it is what
	// makes it an affordance. `aria-hidden` because the button's own
	// label already says this, and better: it names the ACTION.
	const label = document.createElement( 'span' );
	label.className = 'os-notch__label';
	label.setAttribute( 'aria-hidden', 'true' );
	label.textContent = __( 'Site assistant' );
	root.appendChild( label );

	// The message region is always in the DOM and always
	// `aria-live="polite"`: a live region created at the moment it
	// gains text is announced unreliably across screen readers, and
	// the whole point of the surface is that it speaks.
	//
	// Separate from the label rather than swapping one element's text,
	// so the live region only ever holds things worth announcing.
	// Reusing it for the resting label would announce "Site assistant"
	// every time a message finished.
	const message = document.createElement( 'span' );
	message.className = 'os-notch__message';
	message.setAttribute( 'aria-live', 'polite' );
	root.appendChild( message );

	root.addEventListener( 'click', open );

	let messageTimer: number | null = null;
	const say = ( text: string ): void => {
		if ( messageTimer !== null ) {
			window.clearTimeout( messageTimer );
		}
		message.textContent = text;
		root.classList.add( 'os-notch--speaking' );
		messageTimer = window.setTimeout( () => {
			messageTimer = null;
			root.classList.remove( 'os-notch--speaking' );
			// Cleared a beat later so the text doesn't vanish while the
			// pill is still visibly closing around it.
			window.setTimeout( () => {
				if ( ! root.classList.contains( 'os-notch--speaking' ) ) {
					message.textContent = '';
				}
			}, 200 );
		}, MESSAGE_MS );
	};

	shell.appendChild( root );

	return {
		say,
		destroy: () => {
			if ( messageTimer !== null ) {
				window.clearTimeout( messageTimer );
			}
			root.remove();
		},
	};
}
