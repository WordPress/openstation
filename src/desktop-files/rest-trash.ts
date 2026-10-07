import { joinRestUrl } from '../rest-url';
import { trackedFetch } from '../tracked-fetch';
import { restErrorFromResponse } from '../core/api-client';

interface ShellRestConfig {
	restUrl?: string;
	restNonce?: string;
}

function shellRest(): ShellRestConfig {
	return (
		(
			window.wp as
				| { os?: { config?: ShellRestConfig } }
				| undefined
		)?.os?.config ?? {}
	);
}

export async function trashByRestPath( restPath: string, id: number ): Promise< void > {
	const { restUrl, restNonce } = shellRest();
	if ( ! restUrl || ! restPath || ! ( id > 0 ) ) {
		throw new Error( '[openstation] trashByRestPath: missing REST config or target.' );
	}
	const response = await trackedFetch(
		joinRestUrl( restUrl, `${ restPath.replace( /\/+$/, '' ) }/${ id }` ),
		{
			method: 'DELETE',
			credentials: 'same-origin',
			headers: {
				'X-WP-Nonce': String( restNonce ?? '' ),
				Accept: 'application/json',
			},
		},
		{ source: 'my-wordpress/trash' },
	);
	if ( ! response.ok ) {
		throw await restErrorFromResponse( response );
	}
}
