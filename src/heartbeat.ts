import { createSharedStore } from './shared-store';

type HeartbeatSupplier< T = unknown > = () => T;

type HeartbeatSubscriber< T = unknown > = ( value: T ) => void;

interface JQueryLike {
	(
		selector: Document,
	): {
		on: ( event: string, handler: ( ...args: unknown[] ) => void ) => void;
	};
}

const store = createSharedStore< {
	suppliers: Map< string, HeartbeatSupplier >;
	subscribers: Map< string, Set< HeartbeatSubscriber > >;
	booted: boolean;
} >( 'desktop-mode/heartbeat-bus', () => ( {
	suppliers: new Map(),
	subscribers: new Map(),
	booted: false,
} ) );

export interface HeartbeatBus {

	contribute< T = unknown >(
		field: string,
		supplier: HeartbeatSupplier< T >,
	): () => void;

	subscribe< T = unknown >(
		field: string,
		cb: HeartbeatSubscriber< T >,
	): () => void;
}

export const heartbeat: HeartbeatBus = {
	contribute( field, supplier ) {
		store.state.suppliers.set( field, supplier as HeartbeatSupplier );
		return () => {
			if ( store.state.suppliers.get( field ) === ( supplier as HeartbeatSupplier ) ) {
				store.state.suppliers.delete( field );
			}
		};
	},
	subscribe( field, cb ) {
		let set = store.state.subscribers.get( field );
		if ( ! set ) {
			set = new Set();
			store.state.subscribers.set( field, set );
		}
		set.add( cb as HeartbeatSubscriber );
		return () => {
			set!.delete( cb as HeartbeatSubscriber );
		};
	},
};

export function bootHeartbeatBus(): void {
	if ( store.state.booted ) {
		return;
	}
	store.state.booted = true;
	const $ = ( window as unknown as { jQuery?: JQueryLike } ).jQuery;
	if ( ! $ ) {
		console.warn(
			'[desktop-mode/heartbeat] jQuery missing — Heartbeat bus disabled.',
		);
		return;
	}

	$( document ).on( 'heartbeat-send', ( ...args: unknown[] ) => {
		const data = args[ 1 ] as Record< string, unknown > | undefined;
		if ( ! data ) {
			return;
		}
		for ( const [ field, supplier ] of store.state.suppliers ) {
			try {
				data[ field ] = supplier();
			} catch ( err ) {
				console.error(
					`[desktop-mode/heartbeat] supplier for "${ field }" threw:`,
					err,
				);
			}
		}
	} );

	$( document ).on( 'heartbeat-tick', ( ...args: unknown[] ) => {
		const response = args[ 1 ] as Record< string, unknown > | undefined;
		if ( ! response ) {
			return;
		}
		for ( const [ field, set ] of store.state.subscribers ) {
			const value = response[ field ];
			if ( value === undefined ) {
				continue;
			}
			for ( const cb of set ) {
				try {
					cb( value );
				} catch ( err ) {
					console.error(
						`[desktop-mode/heartbeat] subscriber for "${ field }" threw:`,
						err,
					);
				}
			}
		}
	} );
}

export function _resetHeartbeatBusForTests(): void {
	store.state.suppliers.clear();
	store.state.subscribers.clear();
	store.state.booted = false;
}
