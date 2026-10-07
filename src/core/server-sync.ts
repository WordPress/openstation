import { trackedFetch } from '../tracked-fetch';
import type { ReactiveRegistry } from './reactive-registry';

export interface CreateRegistrySyncOptions< T, P = unknown > {

	endpoint: string;

	transform?: ( snapshot: T[] ) => P;

	nonce?: string;

	source?: string;

	debounceMs?: number;

	silent?: boolean;
}

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
