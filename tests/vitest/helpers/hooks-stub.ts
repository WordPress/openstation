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

function assertValidHookName( name: string ): void {
	if ( ! /^[a-zA-Z][a-zA-Z0-9_.-]*$/.test( name ) || /^__/.test( name ) ) {
		throw new Error(
			`Invalid hook name "${ name }": @wordpress/hooks allows only ` +
				'letters, numbers, dashes, periods and underscores, ' +
				'and would reject this registration at runtime.',
		);
	}
}

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

export function installHooksStub(): FakeWpHooks {
	const stub = createHooksStub();

	( window as unknown as { wp?: unknown } ).wp = { hooks: stub };
	return stub;
}

export function clearHooksStub(): void {
	delete ( window as unknown as { wp?: unknown } ).wp;
}

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
