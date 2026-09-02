/**
 * App Framework runtime — every kit component is reachable from PHP.
 *
 * Two guarantees: `os-on="<event>"` works for every event a component
 * emits (the runtime listens for all of them), and `os-prop-*` feeds
 * property-driven components (os-table columns/data, os-log entries)
 * from plain markup.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	COMPONENT_EVENTS,
	LISTENED_EVENTS,
	applyProps,
	eventArgs,
	propName,
} from '../../src/app-runtime/bindings';

function walk( dir: string, out: string[] = [] ): string[] {
	for ( const name of readdirSync( dir ) ) {
		const full = join( dir, name );
		if ( statSync( full ).isDirectory() ) {
			walk( full, out );
		} else if ( full.endsWith( '.ts' ) && ! full.endsWith( '.test.ts' ) ) {
			out.push( full );
		}
	}
	return out;
}

describe( 'component events', () => {
	it( 'lists every event a kit component emits', () => {
		const emitted = new Set< string >();
		for ( const file of walk( join( __dirname, '../../src/ui/components' ) ) ) {
			const source = readFileSync( file, 'utf8' );
			for ( const match of source.matchAll( /this\.emit\(\s*'([a-z-]+)'/g ) ) {
				emitted.add( match[ 1 ] );
			}
			for ( const match of source.matchAll( /new CustomEvent\(\s*'(os-[a-z-]+)'/g ) ) {
				emitted.add( match[ 1 ] );
			}
		}
		expect( emitted.size ).toBeGreaterThan( 40 );
		const missing = Array.from( emitted ).filter( ( name ) => ! COMPONENT_EVENTS.includes( name ) );
		expect( missing, 'add these to COMPONENT_EVENTS in src/app-runtime/bindings.ts' ).toEqual( [] );
		for ( const name of COMPONENT_EVENTS ) {
			expect( LISTENED_EVENTS ).toContain( name );
		}
	} );
} );

describe( 'eventArgs', () => {
	it( 'reports keys and modifiers for keyboard events', () => {
		const el = document.createElement( 'div' );
		const args = eventArgs( new KeyboardEvent( 'keydown', { key: 'Enter', code: 'Enter', metaKey: true } ), el );
		expect( args ).toEqual( { key: 'Enter', code: 'Enter', alt: false, ctrl: false, meta: true, shift: false } );
	} );

	it( 'collects a native form into values', () => {
		const form = document.createElement( 'form' );
		form.innerHTML = '<input name="title" value="Hi"><input name="tag" value="a"><input name="tag" value="b">';
		expect( eventArgs( new Event( 'submit' ), form ) ).toEqual( { values: { title: 'Hi', tag: [ 'a', 'b' ] } } );
	} );

	it( 'drops functions and nodes from a component detail', () => {
		const el = document.createElement( 'os-form' );
		const args = eventArgs(
			new CustomEvent( 'os-form-submit', { detail: { values: { a: 1 }, form: el, reset: () => undefined } } ),
			el,
		);
		expect( args ).toEqual( { values: { a: 1 } } );
	} );
} );

describe( 'os-prop-*', () => {
	it( 'camel-cases the property name', () => {
		expect( propName( 'os-prop-data' ) ).toBe( 'data' );
		expect( propName( 'os-prop-row-height' ) ).toBe( 'rowHeight' );
	} );

	it( 'assigns parsed JSON as properties and skips unchanged values', () => {
		const root = document.createElement( 'div' );
		root.innerHTML =
			'<os-table os-prop-columns=\'[{"key":"a","label":"A"}]\' os-prop-data=\'[{"a":1}]\' os-prop-empty="Nothing"></os-table>';
		const table = root.firstElementChild as HTMLElement & { columns?: unknown; data?: unknown; empty?: unknown };
		const seen = new WeakMap< Element, Record< string, string > >();

		expect( applyProps( root, seen ) ).toBe( 3 );
		expect( table.columns ).toEqual( [ { key: 'a', label: 'A' } ] );
		expect( table.data ).toEqual( [ { a: 1 } ] );
		expect( table.empty ).toBe( 'Nothing' );

		expect( applyProps( root, seen ) ).toBe( 0 );
		table.setAttribute( 'os-prop-data', '[{"a":2}]' );
		expect( applyProps( root, seen ) ).toBe( 1 );
		expect( table.data ).toEqual( [ { a: 2 } ] );
	} );
} );
