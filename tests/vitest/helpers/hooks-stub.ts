/**
 * Minimal in-memory implementation of the `@wordpress/hooks` API that
 * our production code reaches via `window.wp.hooks`. Mounting this
 * on `window.wp.hooks` in a test's `beforeEach` gives every module
 * under test a real (if tiny) hook bus to call against — no jest-
 * style module mocking, no stubbed wrappers. Tests can then assert
 * on observed side-effects (doAction fired, applyFilters returned
 * the mutated value, etc.).
 *
 * The real `@wordpress/hooks` ships many more features — priority
 * numbers, removable hooks, private namespaces, did-count for
 * filters, etc. This stub covers what our code actually uses: add/
 * remove, apply/do, did-count for actions.
 */
export interface FakeWpHooks {
	addFilter: ( name: string, ns: string, cb: ( ...a: unknown[] ) => unknown, priority?: number ) => void;
	addAction: ( name: string, ns: string, cb: ( ...a: unknown[] ) => void, priority?: number ) => void;
	removeFilter: ( name: string, ns: string ) => number;
	removeAction: ( name: string, ns: string ) => number;
	applyFilters: ( name: string, value: unknown, ...args: unknown[] ) => unknown;
	doAction: ( name: string, ...args: unknown[] ) => void;
	didAction: ( name: string ) => number;
	didFilter: ( name: string ) => number;
	hasAction: ( name: string, ns?: string ) => boolean | number;
	hasFilter: ( name: string, ns?: string ) => boolean | number;
}

/**
 * The same validation the real `@wordpress/hooks` applies before
 * registering a handler. `addAction`/`addFilter` silently bail on an
 * invalid name while `doAction`/`applyFilters` still run against an
 * empty handler list, so a stub that skips this reports a working
 * bus where a browser would register nothing. Throwing (rather than
 * WordPress's console.error) turns that into a red test.
 */
function assertValidHookName( name: string ): void {
	if ( ! /^[a-zA-Z][a-zA-Z0-9_.-]*$/.test( name ) || /^__/.test( name ) ) {
		throw new Error(
			`Invalid hook name "${ name }": @wordpress/hooks allows only ` +
				'letters, numbers, dashes, periods and underscores, ' +
				'and would reject this registration at runtime.',
		);
	}
}

/** Namespaces use a looser charset than hook names. */
function assertValidNamespace( ns: string ): void {
	if ( ! /^[a-zA-Z][a-zA-Z0-9_.\-/]*$/.test( ns ) ) {
		throw new Error( `Invalid hook namespace "${ ns }".` );
	}
}

export function createHooksStub(): FakeWpHooks {
	const filters = new Map<
		string,
		Array<{ ns: string; cb: ( ...a: unknown[] ) => unknown; priority: number }>
	>();
	const actions = new Map<
		string,
		Array<{ ns: string; cb: ( ...a: unknown[] ) => void; priority: number }>
	>();
	const did = new Map<string, number>();

	const sortByPriority = <T extends { priority: number }>( arr: T[] ): T[] =>
		[ ...arr ].sort( ( a, b ) => a.priority - b.priority );

	return {
		addFilter( name, ns, cb, priority = 10 ) {
			assertValidHookName( name );
			assertValidNamespace( ns );
			const list = filters.get( name ) ?? [];
			list.push( { ns, cb, priority } );
			filters.set( name, list );
		},
		addAction( name, ns, cb, priority = 10 ) {
			assertValidHookName( name );
			assertValidNamespace( ns );
			const list = actions.get( name ) ?? [];
			list.push( { ns, cb, priority } );
			actions.set( name, list );
		},
		removeFilter( name, ns ) {
			const list = filters.get( name );
			if ( ! list ) return 0;
			const before = list.length;
			filters.set( name, list.filter( ( e ) => e.ns !== ns ) );
			return before - ( filters.get( name )?.length ?? 0 );
		},
		removeAction( name, ns ) {
			const list = actions.get( name );
			if ( ! list ) return 0;
			const before = list.length;
			actions.set( name, list.filter( ( e ) => e.ns !== ns ) );
			return before - ( actions.get( name )?.length ?? 0 );
		},
		applyFilters( name, value, ...args ) {
			const list = filters.get( name );
			if ( ! list ) return value;
			let current = value;
			for ( const { cb } of sortByPriority( list ) ) {
				current = cb( current, ...args );
			}
			return current;
		},
		doAction( name, ...args ) {
			did.set( name, ( did.get( name ) ?? 0 ) + 1 );
			const list = actions.get( name );
			if ( ! list ) return;
			for ( const { cb } of sortByPriority( list ) ) {
				cb( ...args );
			}
		},
		didAction( name ) {
			return did.get( name ) ?? 0;
		},
		didFilter() {
			return 0;
		},
		hasAction( name, ns ) {
			const list = actions.get( name );
			if ( ! list ) return false;
			if ( ns === undefined ) return list.length > 0;
			return list.some( ( e ) => e.ns === ns );
		},
		hasFilter( name, ns ) {
			const list = filters.get( name );
			if ( ! list ) return false;
			if ( ns === undefined ) return list.length > 0;
			return list.some( ( e ) => e.ns === ns );
		},
	};
}

/** Install the stub on `window.wp.hooks`. Returns the instance. */
export function installHooksStub(): FakeWpHooks {
	const stub = createHooksStub();
	// Tests may run back-to-back with cached module state; clear
	// anything else under `window.wp` so getter leakage can't occur.
	( window as unknown as { wp?: unknown } ).wp = { hooks: stub };
	return stub;
}

/** Clear `window.wp` so the next test starts fresh. */
export function clearHooksStub(): void {
	delete ( window as unknown as { wp?: unknown } ).wp;
}

/**
 * Subscribe a spy to one or more action hooks, returning a growing
 * array of the `{ name, args }` records captured in firing order.
 * Lets tests assert "X fired before Y" plus inspect the payload
 * without cluttering each test with boilerplate addAction wiring.
 */
export function recordActions(
	hooks: FakeWpHooks,
	names: readonly string[],
): Array<{ name: string; args: unknown[] }> {
	const log: Array<{ name: string; args: unknown[] }> = [];
	for ( const name of names ) {
		hooks.addAction( name, `vitest/spy/${ name }`, ( ...args ) => {
			log.push( { name, args } );
		} );
	}
	return log;
}
