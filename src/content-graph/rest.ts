/**
 * Content Graph — REST client.
 *
 * Thin layer over `trackedFetch` that talks to the
 * `desktop-mode/v1/content-graph/*` routes. `tagged: source` so the
 * activity bus and per-window spinner can attribute requests
 * correctly (per AGENTS.md).
 *
 * @public
 * @since 0.8.2
 */

import { trackedFetch } from '../tracked-fetch';
import type {
	ContentGraphConfig,
	GraphPayload,
	PostDetail,
	PostTypeDescriptor,
} from './types';

declare global {
	interface Window {
		desktopModeWindowConfig?: Record< string, unknown >;
	}
}

const WINDOW_ID = 'desktop-mode-content-graph';
const SOURCE = 'desktop-mode/content-graph';

export function getConfig(): ContentGraphConfig {
	const map = window.desktopModeWindowConfig ?? {};
	const cfg = map[ WINDOW_ID ] as ContentGraphConfig | undefined;
	if ( ! cfg ) {
		throw new Error(
			'Content Graph config missing — desktop_mode_register_window args lost in transit.',
		);
	}
	return cfg;
}

function authHeaders( cfg: ContentGraphConfig ): Record< string, string > {
	return {
		Accept: 'application/json',
		'X-WP-Nonce': cfg.restNonce,
	};
}

export async function fetchPostTypes(
	cfg: ContentGraphConfig,
): Promise< PostTypeDescriptor[] > {
	const res = await trackedFetch(
		`${ cfg.apiBase }/post-types`,
		{ headers: authHeaders( cfg ) },
		{ source: SOURCE, windowId: WINDOW_ID },
	);
	if ( ! res.ok ) {
		throw new Error( `post-types: ${ res.status }` );
	}
	return ( await res.json() ) as PostTypeDescriptor[];
}

export async function fetchGraph(
	cfg: ContentGraphConfig,
	types: string[],
): Promise< GraphPayload > {
	const url = new URL( `${ cfg.apiBase }/nodes` );
	if ( types.length > 0 ) {
		url.searchParams.set( 'types', types.join( ',' ) );
	}
	const res = await trackedFetch(
		url.toString(),
		{ headers: authHeaders( cfg ) },
		{ source: SOURCE, windowId: WINDOW_ID },
	);
	if ( ! res.ok ) {
		throw new Error( `nodes: ${ res.status }` );
	}
	return ( await res.json() ) as GraphPayload;
}

export async function fetchPostDetail(
	cfg: ContentGraphConfig,
	id: number,
): Promise< PostDetail > {
	const res = await trackedFetch(
		`${ cfg.apiBase }/post/${ id }`,
		{ headers: authHeaders( cfg ) },
		{ source: SOURCE, windowId: WINDOW_ID },
	);
	if ( ! res.ok ) {
		throw new Error( `post/${ id }: ${ res.status }` );
	}
	return ( await res.json() ) as PostDetail;
}
