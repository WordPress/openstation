/**
 * The notch — the shell's voice, at the top edge of the screen.
 *
 * It is the site assistant's front door, and it is deliberately NOT a
 * dock tile. The assistant is the one affordance that answers "what is
 * going on with this site?", which is a different question from "open
 * this app", and the rail is a list of apps.
 *
 * **It is not a button that grew.** At rest it is a small pill you can
 * click to ask something; when the shell has something to say — a
 * request in flight, a save landing, the assistant thinking — it
 * expands to say it and shrinks back. That expansion is the reason the
 * surface exists: since the admin bar went away, the shell has had
 * nowhere to say anything short of a toast, which interrupts.
 *
 * `say()` is that mechanism, and it is deliberately unwired for now.
 * The obvious feed is request activity, but the typed activity bus
 * (`ActivityChannelMap`) has no request channel today — the tracked
 * fetch drives per-window spinners instead — and inventing a channel
 * name here would be adding public API sideways, in the module that
 * happens to want it. Callers can drive it directly meanwhile.
 *
 * **It never reserves work area.** This is the whole design
 * constraint. A 32px full-width bar that permanently steals height is
 * what OpenStation just removed; repeating it one element smaller
 * would be the same mistake in a nicer shape, and it would make the
 * notch a second hardcoded claimant on a work-area rectangle that
 * already has three disagreeing answers. So it floats above windows —
 * high `z-index`, below modals — and dims itself when a maximized
 * window is underneath rather than pushing that window down.
 *
 * Top-CENTRE is chosen, not incidental: window title text lives in the
 * title bar's `flex: 1` grow region and reads from the leading edge,
 * so the centre of a maximized window's title bar is the one strip of
 * the top edge that is reliably empty.
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
