import type { DesktopConfig } from '../types';
import { __ } from '../i18n';
import { trackedFetch } from '../tracked-fetch';

export type LinkOffer = NonNullable< DesktopConfig[ 'hopLinkOffer' ] >;

export interface LinkOfferDeps {

	confirm: ( options: { title: string; message: string; confirmLabel: string } ) => Promise< boolean >;

	post: ( url: string, accept: boolean ) => Promise< unknown >;
}

export function createLinkPoster( restNonce: string ): LinkOfferDeps[ 'post' ] {
	return ( url, accept ) =>
		trackedFetch(
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
}

export async function offerAccountLink(
	offer: LinkOffer,
	deps: LinkOfferDeps,
): Promise< boolean > {
	const who = offer.email ? `${ offer.name } (${ offer.email })` : offer.name;
	const accept = await deps.confirm( {
		title: __( 'Arrive logged in next time?' ),

		message: __(
			'%1$s just switched here from %2$s while you were logged in. Link that account to yours, and a switch from there logs you in as you. You can undo this in the Network window.',
		)
			.replace( '%1$s', who )
			.replace( '%2$s', offer.site ),
		confirmLabel: __( 'Link accounts' ),
	} );
	try {
		await deps.post( offer.url, accept );
	} catch {

	}
	return accept;
}
