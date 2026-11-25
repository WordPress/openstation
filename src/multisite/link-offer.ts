/**
 * The question a shell asks once, after a switch from another install
 * arrived with a login token while this user was logged in and none of
 * their accounts there is linked yet: link your account there, so that
 * from now on a switch from there logs you in here?
 *
 * The question names the install and nobody on it. A token that simply
 * arrives is anyone's to mint and send, so who it was minted for is not
 * who gets linked. A yes answers with the issuer's URL instead: the
 * browser goes there, its own session there mints a token carrying this
 * user's single-use link request back, and the server links the account
 * that token names. See `includes/network/hop.php`.
 */

import type { DesktopConfig } from '../types';
import { __, sprintf } from '../i18n';
import { trackedFetch } from '../tracked-fetch';

export type LinkOffer = NonNullable< DesktopConfig[ 'hopLinkOffer' ] >;

export interface LinkOfferDeps {
	/** The confirm dialog; resolves to the user's answer. */
	confirm: ( options: { title: string; message: string; confirmLabel: string } ) => Promise< boolean >;
	/** Records the answer on the route the offer names; resolves to its JSON. */
	post: ( url: string, accept: boolean ) => Promise< unknown >;
	/** Sends the browser to the issuer, where the link is confirmed. */
	navigate: ( url: string ) => void;
}

/** The request that records an answer on the link route, nonce attached. */
export function createLinkPoster( restNonce: string ): LinkOfferDeps[ 'post' ] {
	return async ( url, accept ) => {
		const response = await trackedFetch(
			url,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': restNonce,
				},
				body: JSON.stringify( { accept } ),
			},
			{ source: 'desktop-mode/network' },
		);
		return response.ok ? response.json() : null;
	};
}

/** The URL a yes answers with, when it is one. */
function issuerUrl( answer: unknown ): string {
	const url = ( answer as { url?: unknown } | null )?.url;
	return typeof url === 'string' && /^https?:\/\//i.test( url ) ? url : '';
}

/**
 * Ask, then record the answer either way: a no is remembered so the
 * same install is not offered again, a yes goes to the issuer to be
 * confirmed by the session there. A failed request is not retried; the
 * offer expires on its own.
 */
export async function offerAccountLink(
	offer: LinkOffer,
	deps: LinkOfferDeps,
): Promise< boolean > {
	const accept = await deps.confirm( {
		title: __( 'Arrive logged in next time?' ),
		message: sprintf(
			// translators: %1$s: the site the switch came from.
			__( 'You just switched here from %1$s while you were logged in. Link your account there to this one, and a switch from there logs you in here. You will pass through %1$s for a moment to confirm it is your account. You can undo this in the Network window.' ),
			offer.site,
		),
		confirmLabel: __( 'Link accounts' ),
	} );
	try {
		const answer = await deps.post( offer.url, accept );
		const url = accept ? issuerUrl( answer ) : '';
		if ( url ) {
			deps.navigate( url );
		}
	} catch {
		// The offer expires on its own; nothing to undo.
	}
	return accept;
}
