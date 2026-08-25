/**
 * Code Blue — REST client.
 *
 * Thin layer over `trackedFetch` that talks to the
 * `desktop-mode/v1/code-blue/*` routes. Tagged with `source` +
 * `windowId` so the activity bus and the window's own spinner can
 * attribute requests correctly (per AGENTS.md).
 *
 * @public
 */

import { joinRestUrl } from '../rest-url';
import { trackedFetch } from '../tracked-fetch';
import type {
	CodeBlueConfig,
	EntriesResponse,
	SourcesResponse,
} from './types';

declare global {
	interface Window {
		openStationWindowConfig?: Record< string, unknown >;
	}
}

export const WINDOW_ID = 'openstation-code-blue';
const SOURCE = 'openstation/code-blue';

export function getConfig(): CodeBlueConfig {
	// Prefer the framework accessor — its JSDoc recommends it over
	// reading the global directly so the storage location can evolve
	// (the nonce refresher rewrites these blobs in place). The bare
	// global stays as the boot-time fallback.
	const getWindowConfig = (
		window.wp as
			| {
				os?: {
					getWindowConfig?: < T >( id: string ) => T | undefined;
				};
			}
			| undefined
	)?.os?.getWindowConfig;
	const cfg =
		( typeof getWindowConfig === 'function'
			? getWindowConfig< CodeBlueConfig >( WINDOW_ID )
			: undefined ) ??
		( ( window.openStationWindowConfig ?? {} )[ WINDOW_ID ] as
			| CodeBlueConfig
			| undefined );
	if ( ! cfg ) {
		throw new Error(
			'Code Blue config missing — openstation_register_window args lost in transit.',
		);
	}
	return cfg;
}

function headers( cfg: CodeBlueConfig ): Record< string, string > {
	return {
		Accept: 'application/json',
		'X-WP-Nonce': cfg.restNonce,
	};
}

async function request< T >(
	cfg: CodeBlueConfig,
	path: string,
	init?: RequestInit,
): Promise< T > {
	// `joinRestUrl` rather than string concatenation: on plain
	// permalinks `apiBase` is `index.php?rest_route=/…`, and a
	// `?source=` appended naively would be the URL's second `?`.
	const res = await trackedFetch(
		joinRestUrl( cfg.apiBase, path ),
		{ headers: headers( cfg ), ...init },
		{ source: SOURCE, windowId: WINDOW_ID },
	);
	if ( ! res.ok ) {
		let message = `${ res.status }`;
		try {
			const body = ( await res.json() ) as { message?: string };
			if ( body.message ) {
				message = body.message;
			}
		} catch {
			// Non-JSON error body — the status code will have to do.
		}
		throw new Error( message );
	}
	return ( await res.json() ) as T;
}

export function fetchSources(
	cfg: CodeBlueConfig,
): Promise< SourcesResponse > {
	return request< SourcesResponse >( cfg, '/sources' );
}

export function fetchEntries(
	cfg: CodeBlueConfig,
	sourceId: string,
): Promise< EntriesResponse > {
	return request< EntriesResponse >(
		cfg,
		`/entries?source=${ encodeURIComponent( sourceId ) }`,
	);
}

export function clearSource(
	cfg: CodeBlueConfig,
	sourceId: string,
): Promise< { cleared: boolean } > {
	return request< { cleared: boolean } >(
		cfg,
		`/entries?source=${ encodeURIComponent( sourceId ) }`,
		{ method: 'DELETE' },
	);
}
