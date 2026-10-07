export interface SharedStore< T > {

	state: T;

	getState(): Readonly< T >;

	notify(): void;

	subscribe( cb: ( state: Readonly< T > ) => void ): () => void;

	setState( patch: Partial< T > ): void;

	reset(): void;
}

interface InternalRecord< T > {
	state: T;
	listeners: Set< ( state: Readonly< T > ) => void >;

	rebuild: () => T;
}

const SHARED_STORES_SLOT = '__openStationSharedStores';

interface SharedStoresWindow {
	[ SHARED_STORES_SLOT ]?: Map< string, InternalRecord< unknown > >;
}

function resolveSlot(): Map< string, InternalRecord< unknown > > {
	const w = window as unknown as SharedStoresWindow;
	let slot = w[ SHARED_STORES_SLOT ];
	if ( ! slot ) {
		slot = new Map();
		w[ SHARED_STORES_SLOT ] = slot;
	}
	return slot;
}

export function createSharedStore< T >(
	key: string,
	initialState: () => T,
): SharedStore< T > {
	const slot = resolveSlot();
	let record = slot.get( key ) as InternalRecord< T > | undefined;
	if ( ! record ) {
		record = {
			state: initialState(),
			listeners: new Set(),
			rebuild: initialState,
		};
		slot.set( key, record as InternalRecord< unknown > );
	}

	const handle: SharedStore< T > = {

		get state() {
			return record!.state;
		},
		set state( next: T ) {
			record!.state = next;
		},
		getState(): Readonly< T > {
			return record!.state as Readonly< T >;
		},
		notify(): void {
			for ( const cb of Array.from( record!.listeners ) ) {
				try {
					cb( record!.state as Readonly< T > );
				} catch ( err ) {
					console.error(
						`[desktop-mode/shared-store:${ key }] subscriber threw:`,
						err,
					);
				}
			}
		},
		subscribe( cb ): () => void {
			record!.listeners.add( cb );
			return () => {
				record!.listeners.delete( cb );
			};
		},
		setState( patch: Partial< T > ): void {
			const cur = record!.state;
			if ( typeof cur !== 'object' || cur === null ) {
				console.warn(
					`[desktop-mode/shared-store:${ key }] setState called on a primitive store; use the state setter instead.`,
				);
				return;
			}
			Object.assign( cur as Record< string, unknown >, patch );
			handle.notify();
		},
		reset(): void {
			const fresh = record!.rebuild();

			const cur = record!.state;
			if (
				typeof cur === 'object' && cur !== null &&
				typeof fresh === 'object' && fresh !== null
			) {
				const target = cur as Record< string, unknown >;
				for ( const k of Object.keys( target ) ) {
					delete target[ k ];
				}
				Object.assign( target, fresh as object );
			} else {
				record!.state = fresh;
			}
			record!.listeners.clear();
		},
	};
	return handle;
}

export function _resetAllSharedStoresForTests(): void {
	const w = window as unknown as SharedStoresWindow;
	const slot = w[ SHARED_STORES_SLOT ];
	if ( ! slot ) {
		return;
	}
	for ( const record of slot.values() ) {
		const fresh = record.rebuild();
		const cur = record.state;
		if (
			typeof cur === 'object' && cur !== null &&
			typeof fresh === 'object' && fresh !== null
		) {
			const target = cur as Record< string, unknown >;
			for ( const k of Object.keys( target ) ) {
				delete target[ k ];
			}
			Object.assign( target, fresh as object );
		} else {
			record.state = fresh;
		}
		record.listeners.clear();
	}
}
