/**
 * Generic registry → server sync helper.
 *
 * **Why this exists.** Several registries need to push their
 * current state to the server when a plugin registers / unregisters
 * an entry mid-session (commands, settings tabs, wallpapers,
 * widgets, dock-rail renderers, …). Each one had its own
 * `*-server-sync.ts` module with the same choreography:
 * subscribe to the registry → debounce → POST. This module owns
 * the choreography in one place.
 *
 * **What it provides.** `createRegistrySync()` wires a
 * {@link ReactiveRegistry} to a REST endpoint:
 * subscribe → snapshot → optional transform → tracked POST.
 * Returns a teardown function. Errors are caught and logged;
 * the registry stays usable.
 *
 * @since 0.8.1
 */

import { trackedFetch } from '../tracked-fetch';
import type { ReactiveRegistry } from './reactive-registry';

export interface CreateRegistrySyncOptions< T, P = unknown > {
	/** Endpoint the snapshot is POSTed to. */
	endpoint: string;
	/** Optional transform from registry snapshot → POST body. Defaults to `{ entries: snapshot }`. */
	transform?: ( snapshot: T[] ) => P;
	/** Optional REST nonce to include as `X-WP-Nonce`. */
	nonce?: string;
	/** Identifier shown on the activity bus. Defaults to the endpoint. */
	source?: string;
	/** Debounce in ms; consecutive registry mutations are batched into one POST. Default 50ms. */
	debounceMs?: number;
	/** If true, suppresses the activity-bus spinner (background sync). Default true. */
	silent?: boolean;
}

/**
 * Wire a registry to a REST endpoint.
 *
 * @param registry The registry to observe.
 * @param opts     See {@link CreateRegistrySyncOptions}.
 * @return Teardown function — calling it unsubscribes and aborts any pending flush.
 */
export function createRegistrySync< T, P = unknown >(
	registry: ReactiveRegistry< T >,
	opts: CreateRegistrySyncOptions< T, P >,
): () => void {
	const {
		endpoint,
		transform,
		nonce,
		source = endpoint,
		debounceMs = 50,
		silent = true,
	} = opts;

	let timer: ReturnType< typeof setTimeout > | null = null;
	let disposed = false;

	function flush(): void {
		timer = null;
		if ( disposed ) {
			return;
		}
		const snapshot = registry.all();
		const body = transform ? transform( snapshot ) : ( { entries: snapshot } as unknown as P );
		const headers: Record< string, string > = {
			'Content-Type': 'application/json',
		};
		if ( nonce ) {
			headers[ 'X-WP-Nonce' ] = nonce;
		}
		trackedFetch(
			endpoint,
			{
				method: 'POST',
				headers,
				body: JSON.stringify( body ),
			},
			{ source, silent },
		).catch( ( err ) => {
			if ( typeof console !== 'undefined' ) {
				console.warn(
					`[desktop-mode/server-sync:${ source }] sync failed:`,
					err,
				);
			}
		} );
	}

	const unsubscribe = registry.subscribe( () => {
		if ( timer !== null ) {
			clearTimeout( timer );
		}
		timer = setTimeout( flush, debounceMs );
	} );

	return () => {
		disposed = true;
		unsubscribe();
		if ( timer !== null ) {
			clearTimeout( timer );
			timer = null;
		}
	};
}
