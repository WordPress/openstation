/**
 * Mounts the `<wpd-release-card>` — the major-release update moment —
 * into a singleton top-right host under `<body>`, mirroring the toast
 * container's position and z-layer. Returns a dismiss callback.
 *
 * The card carries a close button: dismissing it plays the record-back-
 * into-the-sleeve + collapse-into-the-Updates-icon animation (owned by
 * the component) and persists the dismissal (keyed by `dismissKey`) so
 * the release doesn't nag again until a newer one ships. The returned
 * callback removes the card without animation (e.g. once the update is
 * installed and the server stops reporting it).
 *
 * @since 0.9.3
 */

// Side-effect import — defines the `<wpd-release-card>` custom element
// so the element we create below upgrades synchronously.
import './ui/components/wpd-release-card/wpd-release-card';
import { markNoticeDismissed } from './ui/components/wpd-notice/storage';

export interface ReleaseCardOptions {
	/** Version shown in the message (branch when crossing, else exact). */
	version: string;
	/** Release codename — shown in the message only when non-empty. */
	name: string;
	artUrl: string;
	/** Persistence key — the dismissal is recorded under this id. */
	dismissKey: string;
	/** Optional accent override; omit to derive it from the art. */
	accent?: string;
	accentInk?: string;
	/** Invoked when the user clicks "Update now". */
	onUpdate: () => void;
}

function ensureHost(): HTMLElement {
	const existing = document.querySelector< HTMLElement >(
		'.desktop-mode-release-host',
	);
	if ( existing ) {
		return existing;
	}
	const el = document.createElement( 'div' );
	el.className = 'desktop-mode-release-host';
	// Fixed top-right, above fullscreen windows — same anchor + z as the
	// toast container. Host is click-transparent; the card opts back in.
	el.style.cssText =
		'position:fixed;' +
		'top:calc(var(--wp-admin--admin-bar--height,32px) + 16px);' +
		'inset-inline-end:16px;' +
		'z-index:calc(var(--desktop-mode-z-fullscreen,99999) + 10);' +
		'pointer-events:none;';
	document.body.appendChild( el );
	return el;
}

/**
 * Show the release card. Replaces any card already showing. Returns a
 * dismiss callback the caller can invoke early (removes without animation).
 */
export function showReleaseCard( opts: ReleaseCardOptions ): () => void {
	const host = ensureHost();
	host.textContent = '';

	const card = document.createElement( 'wpd-release-card' );
	card.setAttribute( 'art', opts.artUrl );
	card.setAttribute( 'version', opts.version );
	card.setAttribute( 'name', opts.name );
	// Only set the accent attributes when explicitly provided — otherwise
	// the component derives the accent from the sleeve art.
	if ( opts.accent ) {
		card.setAttribute( 'accent', opts.accent );
	}
	if ( opts.accentInk ) {
		card.setAttribute( 'accent-ink', opts.accentInk );
	}
	card.style.pointerEvents = 'auto';

	let dismissed = false;
	const dismiss = (): void => {
		if ( dismissed ) {
			return;
		}
		dismissed = true;
		card.remove();
	};

	card.addEventListener( 'wpd-release-update', () => {
		opts.onUpdate();
		dismiss();
	} );

	// User dismissed via the close button — the component runs the
	// animation and removes itself; we persist so it won't reappear.
	card.addEventListener( 'wpd-release-dismiss', () => {
		markNoticeDismissed( opts.dismissKey );
	} );

	host.appendChild( card );
	return dismiss;
}
