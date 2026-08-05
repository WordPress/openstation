/**
 * One-off announcement: Desktop Mode is now OpenStation.
 *
 * People who installed this plugin under its old name open wp-admin one
 * morning to a differently-named, differently-coloured shell. With no
 * word of explanation that reads as a compromised site rather than as a
 * release, so the rename gets told once, to exactly the people it
 * happened to, and then never again.
 *
 * Both halves of "exactly the people it happened to" are decided
 * server-side and arrive as the single `config.rebrandNotice` boolean:
 * the install ran under the old name (migration 5's flag in
 * `includes/migrations.php`), and this user has not dismissed the
 * `openstation-rebrand` intro. Fresh installs never see it, because
 * there is nothing to explain to someone who has only ever known the
 * new name.
 *
 * Dismissal goes to the shared seen-intros registry rather than to
 * localStorage, which buys two things a local flag could not: it
 * follows the user to their other browsers, and "Reset what's-new
 * dialogs" in OpenStation Settings → Features brings the announcement
 * back with every other intro.
 *
 * ## Why this is hand-built DOM and not `<os-modal>`
 *
 * It is the same dialog as the first-run welcome card in
 * `includes/welcome-dialog.php`, deliberately: a blurred Void scrim, a
 * Starlight card with a holographic hairline, a shimmering hero. That
 * is the product's one loud moment and an announcement about the
 * product's own name is the only other thing that earns it.
 * `<os-modal>` is a control-panel chrome; every gradient here would
 * have to be fought past it. Styles live in `assets/css/announce.css`
 * under the `.os-announce` namespace.
 */

import { __ } from './i18n';
import { OPENSTATION_LOGOMARK_SVG } from './ui/brand-mark';
import { trackedFetch } from './tracked-fetch';
import type { DesktopConfig } from './types';

/** Slug this announcement records in the seen-intros registry. */
export const REBRAND_INTRO_SLUG = 'openstation-rebrand';

/**
 * Delay before the dialog mounts, in ms.
 *
 * Boot is already busy, and a modal that lands mid-paint reads as a
 * page that broke rather than as something addressed to you. Waiting
 * lets the desk finish arriving first, so the announcement is the
 * second thing the user sees and clearly about what they are looking
 * at.
 */
const MOUNT_DELAY_MS = 1200;

/** Everything inside the card that can take focus, in tab order. */
const FOCUSABLE = 'a[href], button:not([disabled])';

export interface RebrandNoticeDeps {
	/** The shell config, for the gate, the REST base and the nonce. */
	config: DesktopConfig;
}

/**
 * Record the dismissal so the announcement does not return.
 *
 * Deliberately fire-and-forget, and deliberately silent on failure:
 * the user has read the thing and closed it, and a toast apologising
 * that we could not write it down would be about our bookkeeping, not
 * about them. The cost of a lost write is seeing the dialog once more.
 */
async function markSeen( config: DesktopConfig ): Promise< void > {
	const base = config.seenIntrosUrl;
	if ( ! base ) {
		return;
	}
	try {
		await trackedFetch(
			`${ base.replace( /\/$/, '' ) }/seen`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': config.restNonce ?? '',
				},
				body: JSON.stringify( { slug: REBRAND_INTRO_SLUG } ),
			},
			{ source: 'desktop-mode/rebrand-notice', silent: true },
		);
	} catch {
		// See the docblock — nothing useful to say to the user here.
	}
}

/** Build the scrim + card. Exported so the test can read the markup. */
export function buildRebrandDialog(): HTMLElement {
	const scrim = document.createElement( 'div' );
	scrim.className = 'os-announce';
	scrim.setAttribute( 'role', 'dialog' );
	scrim.setAttribute( 'aria-modal', 'true' );
	scrim.setAttribute( 'aria-labelledby', 'os-announce-title' );
	scrim.setAttribute( 'aria-describedby', 'os-announce-desc' );

	const card = document.createElement( 'div' );
	card.className = 'os-announce__card';
	scrim.appendChild( card );

	const close = document.createElement( 'button' );
	close.type = 'button';
	close.className = 'os-announce__close';
	close.dataset.rebrandDismiss = '';
	close.setAttribute( 'aria-label', __( 'Close' ) );
	close.innerHTML = '&times;';
	card.appendChild( close );

	// ---- Hero -------------------------------------------------------
	const hero = document.createElement( 'div' );
	hero.className = 'os-announce__hero';
	card.appendChild( hero );

	const mark = document.createElement( 'div' );
	mark.className = 'os-announce__mark';
	mark.innerHTML = OPENSTATION_LOGOMARK_SVG;
	hero.appendChild( mark );

	const title = document.createElement( 'h2' );
	title.id = 'os-announce-title';
	title.className = 'os-announce__title';
	title.textContent = __( 'Desktop Mode is now OpenStation' );
	hero.appendChild( title );

	const subtitle = document.createElement( 'p' );
	subtitle.className = 'os-announce__subtitle';
	subtitle.textContent = __(
		'Same plugin, same vision, new name. Your windows, wallpaper, dock and settings are exactly where you left them.',
	);
	hero.appendChild( subtitle );

	// ---- Body -------------------------------------------------------
	const body = document.createElement( 'div' );
	body.className = 'os-announce__body';
	card.appendChild( body );

	const why = document.createElement( 'p' );
	why.id = 'os-announce-desc';
	why.textContent = __(
		'To virtually everyone online, "Desktop Mode" means the request-desktop-site toggle in a mobile browser, so we realized that the name didn\'t really capture what it is. We are building an environment where you can control your WordPress site more efficiently.',
	);
	body.appendChild( why );

	// Its own paragraph, and its own string. It is the sign-off, not
	// the tail of the explanation above it, and a translator handed it
	// separately can land it as one in their language.
	const welcome = document.createElement( 'p' );
	welcome.className = 'os-announce__welcome';
	welcome.textContent = __( 'Welcome to OpenStation.' );
	body.appendChild( welcome );

	const fine = document.createElement( 'p' );
	fine.className = 'os-announce__fine';
	fine.textContent = __(
		'Nothing about your install moved. Updates arrive the same way, from the same plugin listing, under the same slug.',
	);
	body.appendChild( fine );

	// ---- Actions ----------------------------------------------------
	const actions = document.createElement( 'div' );
	actions.className = 'os-announce__actions';
	card.appendChild( actions );

	const dismiss = document.createElement( 'button' );
	dismiss.type = 'button';
	dismiss.className = 'os-announce__btn os-announce__btn--primary';
	dismiss.dataset.rebrandDismiss = '';
	dismiss.textContent = __( 'Got it' );
	actions.appendChild( dismiss );

	return scrim;
}

/**
 * Show the announcement if this user is owed it.
 *
 * Fire-and-forget from boot. Resolves either way; a shell whose PHP
 * predates `rebrandNotice` simply never opens it.
 */
export async function maybeShowRebrandNotice(
	deps: RebrandNoticeDeps,
): Promise< void > {
	const { config } = deps;
	if ( ! config.rebrandNotice ) {
		return;
	}
	// Belt and braces against a stale config: the server already
	// excludes users who dismissed it, but the same boot payload is
	// what a session restore replays.
	if ( config.seenIntros?.includes( REBRAND_INTRO_SLUG ) ) {
		return;
	}

	await new Promise( ( resolve ) =>
		window.setTimeout( resolve, MOUNT_DELAY_MS ),
	);

	const scrim = buildRebrandDialog();
	const card = scrim.querySelector< HTMLElement >( '.os-announce__card' );
	const doc = document;
	const returnFocusTo = doc.activeElement as HTMLElement | null;

	// One close path for every route out (button, close chip, ESC,
	// backdrop) so the announcement is recorded as seen however the
	// user leaves it. Dismissing IS reading it; there is no second
	// chance being withheld, and a dialog that came back because you
	// pressed Escape instead of the button would be the more annoying
	// bug.
	let closed = false;
	const close = (): void => {
		if ( closed ) {
			return;
		}
		closed = true;
		document.removeEventListener( 'keydown', onKeyDown, true );
		scrim.remove();
		// Put the caret back where the user left it. The desk is
		// interactive behind this dialog and they did not choose to
		// come here.
		returnFocusTo?.focus?.();
		void markSeen( config );
	};

	function onKeyDown( e: KeyboardEvent ): void {
		// Self-heal if the dialog left the document some other way — a
		// plugin replacing the body, a test resetting the DOM. This
		// listener is on `document` in the capture phase, so a leaked
		// one would swallow Escape for the rest of the session and
		// break every window shortcut bound to it. Unbind without
		// recording a dismissal: the user never saw this close.
		if ( ! scrim.isConnected ) {
			document.removeEventListener( 'keydown', onKeyDown, true );
			return;
		}
		if ( e.key === 'Escape' ) {
			e.preventDefault();
			close();
			return;
		}
		if ( e.key !== 'Tab' ) {
			return;
		}
		// Focus trap. Only two or three controls in here, so the
		// cheap version is the honest one: find the ends, wrap at
		// them, and let the browser do everything in between.
		const items = Array.from(
			scrim.querySelectorAll< HTMLElement >( FOCUSABLE ),
		);
		if ( items.length === 0 ) {
			return;
		}
		const first = items[ 0 ];
		const last = items[ items.length - 1 ];
		const active = scrim.ownerDocument.activeElement;
		if ( e.shiftKey && ( active === first || ! scrim.contains( active ) ) ) {
			e.preventDefault();
			last.focus();
		} else if ( ! e.shiftKey && active === last ) {
			e.preventDefault();
			first.focus();
		}
	}

	scrim.addEventListener( 'click', ( e: MouseEvent ) => {
		// Backdrop only — a click that landed on the card is the user
		// selecting text, not asking to leave.
		if ( card && ! card.contains( e.target as Node ) ) {
			close();
		}
	} );
	for ( const el of scrim.querySelectorAll< HTMLElement >(
		'[data-rebrand-dismiss]',
	) ) {
		el.addEventListener( 'click', close );
	}
	// Capture phase so the shell's own global key handlers (the command
	// palette, window shortcuts) do not get the Escape first.
	document.addEventListener( 'keydown', onKeyDown, true );

	document.body.appendChild( scrim );
	scrim
		.querySelector< HTMLElement >( '.os-announce__btn--primary' )
		?.focus();
}
