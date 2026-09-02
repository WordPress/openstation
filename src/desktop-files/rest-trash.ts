/**
 * WP Explorer — trash one entity by its REST collection path.
 *
 * The Recycle Bin's shortcut-drop handler lives in the desktop
 * bundle; the row it received was dragged out of the explorer app in
 * another. The payload carries the section's `restPath` (`wp/v2
 * /posts`, `wp/v2/pages`, a CPT's collection, the bridge route for a
 * non-REST type), so trashing needs no app window, no config blob and
 * no cross-bundle API — one DELETE against the canonical collection,
 * the same call the explorer's own "Move to Trash" ends at.
 *
 * @public
 */

import { joinRestUrl } from '../rest-url';
import { trackedFetch } from '../tracked-fetch';

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

/**
 * DELETE `<restPath>/<id>` — WordPress's trash semantics for post
 * collections. Throws on a non-2xx answer so the caller can toast.
 *
 * @param restPath Collection path relative to the REST root.
 * @param id       Object id.
 */
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
		let message = `Failed to move to trash (${ response.status })`;
		try {
			const body = ( await response.json() ) as { message?: string };
			if ( body?.message ) {
				message = body.message;
			}
		} catch {
			// A non-JSON error body — the status code will do.
		}
		throw new Error( message );
	}
}
