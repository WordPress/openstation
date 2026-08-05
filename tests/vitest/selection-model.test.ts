/**
 * Tests for the selection model — the set + anchor semantics every
 * tile canvas in the shell now shares.
 */
import { describe, expect, test, vi } from 'vitest';
import { createSelectionModel } from '../../src/selection/model';

const ORDER = [ 'a', 'b', 'c', 'd', 'e' ];

function model( order: string[] = ORDER.slice() ) {
	return createSelectionModel< string >( { order: () => order } );
}

describe( 'selection model', () => {
	test( 'set replaces the selection and moves the anchor', () => {
		const m = model();
		m.set( [ 'b', 'c' ] );
		expect( m.keys() ).toEqual( [ 'b', 'c' ] );
		expect( m.anchor() ).toBe( 'c' );
		m.set( [ 'a' ] );
		expect( m.keys() ).toEqual( [ 'a' ] );
		expect( m.anchor() ).toBe( 'a' );
	} );

	test( 'toggle adds then removes', () => {
		const m = model();
		m.toggle( 'b' );
		m.toggle( 'd' );
		expect( m.keys() ).toEqual( [ 'b', 'd' ] );
		m.toggle( 'b' );
		expect( m.keys() ).toEqual( [ 'd' ] );
	} );

	test( 'keys come back in the order the surface reports, not click order', () => {
		const m = model();
		m.toggle( 'd' );
		m.toggle( 'a' );
		m.toggle( 'c' );
		expect( m.keys() ).toEqual( [ 'a', 'c', 'd' ] );
	} );

	test( 'selectRange covers the span between anchor and target', () => {
		const m = model();
		m.set( [ 'b' ] );
		m.selectRange( 'd' );
		expect( m.keys() ).toEqual( [ 'b', 'c', 'd' ] );
	} );

	test( 'selectRange works backwards too', () => {
		const m = model();
		m.set( [ 'd' ] );
		m.selectRange( 'b' );
		expect( m.keys() ).toEqual( [ 'b', 'c', 'd' ] );
	} );

	test( 'successive ranges re-extend from the same anchor rather than walking', () => {
		const m = model();
		m.set( [ 'b' ] );
		m.selectRange( 'd' );
		m.selectRange( 'c' );
		// Anchor stayed at 'b', so the second range is b..c — NOT
		// b..d plus c..d, and not d..c from a moved anchor.
		expect( m.keys() ).toEqual( [ 'b', 'c' ] );
		expect( m.anchor() ).toBe( 'b' );
	} );

	test( 'additive range keeps the previous selection', () => {
		const m = model();
		m.set( [ 'a' ] );
		m.toggle( 'c' );
		m.selectRange( 'd', true );
		expect( m.keys() ).toEqual( [ 'a', 'c', 'd' ] );
	} );

	test( 'range with no usable anchor degrades to a plain click', () => {
		const m = model();
		m.selectRange( 'c' );
		expect( m.keys() ).toEqual( [ 'c' ] );
		expect( m.anchor() ).toBe( 'c' );
	} );

	test( 'selectAll and clear', () => {
		const m = model();
		m.selectAll();
		expect( m.keys() ).toEqual( ORDER );
		m.clear();
		expect( m.keys() ).toEqual( [] );
		expect( m.anchor() ).toBeNull();
	} );

	test( 'prune drops keys the surface no longer reports', () => {
		const order = ORDER.slice();
		const m = createSelectionModel< string >( { order: () => order } );
		m.set( [ 'b', 'c', 'd' ] );
		order.splice( order.indexOf( 'c' ), 1 );
		expect( m.prune() ).toBe( true );
		expect( m.keys() ).toEqual( [ 'b', 'd' ] );
		// A second prune with nothing to do reports no change.
		expect( m.prune() ).toBe( false );
	} );

	test( 'prune clears an anchor that no longer exists', () => {
		const order = ORDER.slice();
		const m = createSelectionModel< string >( { order: () => order } );
		m.set( [ 'c' ] );
		order.splice( order.indexOf( 'c' ), 1 );
		m.prune();
		expect( m.anchor() ).toBeNull();
	} );

	test( 'subscribers fire only when membership actually changes', () => {
		const seen: string[][] = [];
		const m = createSelectionModel< string >( {
			order: () => ORDER.slice(),
			onChange: ( keys ) => seen.push( keys ),
		} );
		m.set( [ 'a' ] );
		m.set( [ 'a' ] ); // same membership — no notification
		m.add( 'a' ); // already there — no notification
		m.add( 'b' );
		expect( seen ).toEqual( [ [ 'a' ], [ 'a', 'b' ] ] );
	} );

	test( 'a throwing subscriber does not strand the gesture', () => {
		const spy = vi
			.spyOn( console, 'error' )
			.mockImplementation( () => undefined );
		const m = model();
		m.subscribe( () => {
			throw new Error( 'boom' );
		} );
		const other = vi.fn();
		m.subscribe( other );
		expect( () => m.set( [ 'a' ] ) ).not.toThrow();
		expect( other ).toHaveBeenCalled();
		spy.mockRestore();
	} );

	test( 'unsubscribe stops delivery', () => {
		const m = model();
		const cb = vi.fn();
		const off = m.subscribe( cb );
		m.set( [ 'a' ] );
		off();
		m.set( [ 'b' ] );
		expect( cb ).toHaveBeenCalledTimes( 1 );
	} );
} );
