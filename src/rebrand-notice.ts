import { __ } from './i18n';
import { trackedFetch } from './tracked-fetch';
import type { DesktopConfig } from './types';

export const REBRAND_INTRO_SLUG = 'openstation-rebrand';

const MOUNT_DELAY_MS = 1200;

const FOCUSABLE = 'a[href], button:not([disabled])';

export interface RebrandNoticeDeps {

	config: DesktopConfig;
}

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

	}
}

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

	const hero = document.createElement( 'div' );
	hero.className = 'os-announce__hero';
	card.appendChild( hero );

	const eyebrow = document.createElement( 'span' );
	eyebrow.className = 'os-announce__eyebrow';
	const dot = document.createElement( 'span' );
	dot.className = 'os-announce__eyebrow-dot';
	dot.setAttribute( 'aria-hidden', 'true' );
	eyebrow.appendChild( dot );
	eyebrow.appendChild( document.createTextNode( __( 'New name' ) ) );
	hero.appendChild( eyebrow );

	const title = document.createElement( 'h2' );
	title.id = 'os-announce-title';
	title.className = 'os-announce__title';
	title.textContent = __( 'Desktop Mode is now OpenStation' );
	hero.appendChild( title );

	const subtitle = document.createElement( 'p' );
	subtitle.className = 'os-announce__subtitle';
	subtitle.textContent = __( 'The beginning of a new identity.' );
	hero.appendChild( subtitle );

	const body = document.createElement( 'div' );
	body.className = 'os-announce__body';
	card.appendChild( body );

	const why = document.createElement( 'p' );
	why.id = 'os-announce-desc';
	why.textContent = __(
		'Why OpenStation? Because it represents much more than a desktop interface. It\'s an open workspace where WordPress becomes a complete environment for creating, managing and building, just like a real workstation, but powered by the web.',
	);
	body.appendChild( why );

	const theme = document.createElement( 'p' );
	theme.textContent = __(
		'This update also comes with a new default theme that we hope you enjoy.',
	);
	body.appendChild( theme );

	const fine = document.createElement( 'p' );
	fine.className = 'os-announce__fine';
	fine.textContent = __(
		'Everything is already set up. You don\'t need to install any new plugins, so you can keep using the same features as before.',
	);
	body.appendChild( fine );

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

export async function maybeShowRebrandNotice(
	deps: RebrandNoticeDeps,
): Promise< void > {
	const { config } = deps;
	if ( ! config.rebrandNotice ) {
		return;
	}

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

	let closed = false;
	const close = (): void => {
		if ( closed ) {
			return;
		}
		closed = true;
		document.removeEventListener( 'keydown', onKeyDown, true );
		scrim.remove();

		returnFocusTo?.focus?.();
		void markSeen( config );
	};

	function onKeyDown( e: KeyboardEvent ): void {
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
		} else if (
			! e.shiftKey &&
			( active === last || ! scrim.contains( active ) )
		) {
			e.preventDefault();
			first.focus();
		}
	}

	scrim.addEventListener( 'click', ( e: MouseEvent ) => {
		if ( card && ! card.contains( e.target as Node ) ) {
			close();
		}
	} );
	for ( const el of scrim.querySelectorAll< HTMLElement >(
		'[data-rebrand-dismiss]',
	) ) {
		el.addEventListener( 'click', close );
	}

	document.addEventListener( 'keydown', onKeyDown, true );

	document.body.appendChild( scrim );
	scrim
		.querySelector< HTMLElement >( '.os-announce__btn--primary' )
		?.focus();
}
