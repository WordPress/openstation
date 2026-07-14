/**
 * Mounts the `<wpd-release-card>` — the major-release update moment —
 * into a singleton top-right host under `<body>`, mirroring the toast
 * container's position and z-layer. Returns a dismiss callback.
 *
 * The card is non-dismissible by the user (consistent with the update
 * toast): it clears when the user clicks "Update now" (which also opens
 * the update screen) or when the server stops reporting the update.
 *
 * @since 0.9.3
 */

// Side-effect import — defines the `<wpd-release-card>` custom element
// so the element we create below upgrades synchronously.
import './ui/components/wpd-release-card/wpd-release-card';

export interface ReleaseCardOptions {
	/** Version shown in the message (branch when crossing, else exact). */
	version: string;
	/** Release codename — shown in the message only when non-empty. */
	name: string;
	/** Major branch (e.g. `7.0`) — the record label. */
	branch: string;
	artUrl: string;
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
 * dismiss callback the caller can invoke early.
 */
export function showReleaseCard( opts: ReleaseCardOptions ): () => void {
	const host = ensureHost();
	host.textContent = '';

	const card = document.createElement( 'wpd-release-card' );
	card.setAttribute( 'art', opts.artUrl );
	card.setAttribute( 'version', opts.version );
	card.setAttribute( 'name', opts.name );
	card.setAttribute( 'branch', opts.branch );
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

	host.appendChild( card );
	return dismiss;
}
