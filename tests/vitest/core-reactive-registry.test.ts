import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { createReactiveRegistry } from '../../src/core/reactive-registry';

interface Item {
	id: string;
	label: string;
}

afterEach( () => {
	_resetAllSharedStoresForTests();
} );

describe( 'createReactiveRegistry', () => {
	it( 'registers, looks up, and snapshots entries', () => {
		const r = createReactiveRegistry< Item >( {
			key: 'test/basic',
			idOf: ( e ) => e.id,
		} );
		r.register( { id: 'a', label: 'A' } );
		r.register( { id: 'b', label: 'B' } );
		expect( r.all().map( ( e ) => e.id ) ).toEqual( [ 'a', 'b' ] );
		expect( r.get( 'a' )?.label ).toBe( 'A' );
		expect( r.get( 'missing' ) ).toBeUndefined();
	} );

	it( 'replaces a registration with the same id (late wins)', () => {
		const r = createReactiveRegistry< Item >( {
			key: 'test/replace',
			idOf: ( e ) => e.id,
		} );
		r.register( { id: 'x', label: 'first' } );
		r.register( { id: 'x', label: 'second' } );
		expect( r.all().length ).toBe( 1 );
		expect( r.get( 'x' )?.label ).toBe( 'second' );
	} );

	it( 'unregister removes the entry and is a no-op for unknown ids', () => {
		const r = createReactiveRegistry< Item >( {
			key: 'test/unregister',
			idOf: ( e ) => e.id,
		} );
		r.register( { id: 'a', label: 'A' } );
		r.unregister( 'a' );
		r.unregister( 'unknown' );
		expect( r.all() ).toEqual( [] );
	} );

	it( 'subscribers fire on register and unregister', () => {
		const r = createReactiveRegistry< Item >( {
			key: 'test/subscribe',
			idOf: ( e ) => e.id,
		} );
		const cb = vi.fn();
		r.subscribe( cb );
		r.register( { id: 'a', label: 'A' } );
		r.unregister( 'a' );
		expect( cb ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'unsubscribe stops further notifications', () => {
		const r = createReactiveRegistry< Item >( {
			key: 'test/unsubscribe',
			idOf: ( e ) => e.id,
		} );
		const cb = vi.fn();
		const off = r.subscribe( cb );
		off();
		r.register( { id: 'a', label: 'A' } );
		expect( cb ).not.toHaveBeenCalled();
	} );

	it( 'one throwing subscriber does not strand the others', () => {
		const r = createReactiveRegistry< Item >( {
			key: 'test/throw',
			idOf: ( e ) => e.id,
		} );
		const errSpy = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		const ok = vi.fn();
		r.subscribe( () => {
			throw new Error( 'boom' );
		} );
		r.subscribe( ok );
		r.register( { id: 'a', label: 'A' } );
		expect( ok ).toHaveBeenCalledOnce();
		expect( errSpy ).toHaveBeenCalled();
		errSpy.mockRestore();
	} );

	it( 'rejects entries that fail validation', () => {
		const r = createReactiveRegistry< Item >( {
			key: 'test/validate',
			idOf: ( e ) => e.id,
			validate: ( e ) => ( e.label ? undefined : [ 'label is required' ] ),
		} );
		expect( () => r.register( { id: 'a', label: '' } ) ).toThrow(
			/label is required/,
		);
	} );

	it( 'reset clears entries and listeners', () => {
		const r = createReactiveRegistry< Item >( {
			key: 'test/reset',
			idOf: ( e ) => e.id,
		} );
		const cb = vi.fn();
		r.subscribe( cb );
		r.register( { id: 'a', label: 'A' } );
		r.reset();
		r.register( { id: 'b', label: 'B' } );
		// First call from initial register; subscribe was cleared before the second register.
		expect( cb ).toHaveBeenCalledTimes( 1 );
		expect( r.all().map( ( e ) => e.id ) ).toEqual( [ 'b' ] );
	} );

	it( 'shares state across createReactiveRegistry calls with the same key', () => {
		const a = createReactiveRegistry< Item >( {
			key: 'test/shared',
			idOf: ( e ) => e.id,
		} );
		const b = createReactiveRegistry< Item >( {
			key: 'test/shared',
			idOf: ( e ) => e.id,
		} );
		a.register( { id: 'x', label: 'X' } );
		expect( b.all().map( ( e ) => e.id ) ).toEqual( [ 'x' ] );
	} );
} );
