/**
 * Cross-feature WordPress Heartbeat bus.
 *
 * **What it is.** A thin subscription helper around the
 * `heartbeat-send` / `heartbeat-tick` jQuery events that core
 * WordPress dispatches on every Heartbeat tick (default 15 s in
 * admin). Plugins contribute payload fields to outgoing ticks and
 * subscribe to response fields from incoming ticks WITHOUT each
 * one rewiring the same five lines of jQuery boilerplate.
 *
 * **Why a framework helper.** Multiple features (presence, the
 * recycle-bin badge, third-party plugins) all want to ride the
 * same `heartbeat-send` + `heartbeat-tick` events. Without a shared
 * bus each one re-binds the same five lines of jQuery boilerplate
 * and they can't see each other's contributions. With one bus:
 *
 *   - jQuery boilerplate lives once.
 *   - Devtools can list contributors / subscribers as one group.
 *   - Plugins compose: many subscribers can listen to one
 *     response field, many contributors can write to a single
 *     request field (the LAST writer wins for the contribution
 *     case — by design, sub-plugin overrides shouldn't silently
 *     coexist).
 *
 * **The contract.**
 *
 *   `contribute( field, supplier )` — every outgoing
 *   `heartbeat-send` calls `supplier()` and writes the result
 *   into `data[field]`. Returns an unsubscribe.
 *
 *   `subscribe( field, cb )` — every incoming `heartbeat-tick`
 *   reads `response[field]` and (when not `undefined`) hands it
 *   to `cb`. Returns an unsubscribe.
 *
 *   `bootHeartbeatBus()` — wires the underlying jQuery
 *   listeners. Idempotent; the framework boots it during init,
 *   plugin authors typically don't call it.
 */

/**
 * Function that returns a value to attach to the next outgoing
 * heartbeat. Called every send, so cheap reads (cached state
 * lookups) are fine; avoid synchronous network or heavy
 * computation.
 */
type HeartbeatSupplier< T = unknown > = () => T;

/**
 * Callback invoked with the value of the subscribed field on
 * every incoming tick. If the field is missing on the response
 * (`undefined`), the callback is NOT invoked — feature owners
 * don't need to defend against undefined.
 */
type HeartbeatSubscriber< T = unknown > = ( value: T ) => void;

interface JQueryLike {
	(
		selector: Document,
	): {
		on: ( event: string, handler: ( ...args: unknown[] ) => void ) => void;
	};
}

const suppliers = new Map< string, HeartbeatSupplier >();
const subscribers = new Map< string, Set< HeartbeatSubscriber > >();
let booted = false;

export interface HeartbeatBus {
	/**
	 * Contribute a field to the outgoing tick. Returns an
	 * unsubscribe. Re-contributing the same `field` from a second
	 * call replaces the supplier — last writer wins. Plugins that
	 * want to coexist on a single field should namespace it
	 * (`my-plugin/something`).
	 */
	contribute< T = unknown >(
		field: string,
		supplier: HeartbeatSupplier< T >,
	): () => void;

	/**
	 * Subscribe to a field on the incoming tick. Returns an
	 * unsubscribe. Multiple subscribers per field compose; each
	 * is called in registration order with the same value.
	 */
	subscribe< T = unknown >(
		field: string,
		cb: HeartbeatSubscriber< T >,
	): () => void;
}

export const heartbeat: HeartbeatBus = {
	contribute( field, supplier ) {
		suppliers.set( field, supplier as HeartbeatSupplier );
		return () => {
			// Only delete if THIS supplier is still the registered
			// one — protects against a later contributor's
			// unsubscribe accidentally pulling out the wrong one.
			if ( suppliers.get( field ) === ( supplier as HeartbeatSupplier ) ) {
				suppliers.delete( field );
			}
		};
	},
	subscribe( field, cb ) {
		let set = subscribers.get( field );
		if ( ! set ) {
			set = new Set();
			subscribers.set( field, set );
		}
		set.add( cb as HeartbeatSubscriber );
		return () => {
			set!.delete( cb as HeartbeatSubscriber );
		};
	},
};

/**
 * Wire the underlying `heartbeat-send` / `heartbeat-tick`
 * listeners. Idempotent — running twice is a no-op. Must be
 * called once per page; the framework does this at init.
 *
 * Quietly disables itself when jQuery is missing (no Heartbeat
 * to bind to anyway). Plugins contributing fields BEFORE this
 * boot finishes are safely picked up — `contribute` mutates the
 * shared `suppliers` map directly.
 */
export function bootHeartbeatBus(): void {
	if ( booted ) {
		return;
	}
	booted = true;
	const $ = ( window as unknown as { jQuery?: JQueryLike } ).jQuery;
	if ( ! $ ) {
		// Heartbeat ships with WordPress core admin — its absence
		// is unusual but not fatal. Log a hint for plugin authors
		// who hit this on a stripped-down page.
		// eslint-disable-next-line no-console
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
		for ( const [ field, supplier ] of suppliers ) {
			try {
				data[ field ] = supplier();
			} catch ( err ) {
				// One bad supplier shouldn't strand the rest. Keep
				// the loop going; log loudly so plugin authors notice.
				// eslint-disable-next-line no-console
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
		for ( const [ field, set ] of subscribers ) {
			const value = response[ field ];
			if ( value === undefined ) {
				continue;
			}
			for ( const cb of set ) {
				try {
					cb( value );
				} catch ( err ) {
					// Same isolation rule as suppliers — one broken
					// subscriber must not interfere with peers.
					// eslint-disable-next-line no-console
					console.error(
						`[desktop-mode/heartbeat] subscriber for "${ field }" threw:`,
						err,
					);
				}
			}
		}
	} );
}

/**
 * Test-only reset. Drops every supplier + subscriber + the
 * `booted` flag so an isolated test can install its own jQuery
 * stub and start fresh.
 *
 * @internal
 */
export function _resetHeartbeatBusForTests(): void {
	suppliers.clear();
	subscribers.clear();
	booted = false;
}
