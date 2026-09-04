/**
 * `createListTableSync()` — the preserved-table dance every list
 * window used to write by hand.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createListTableSync, type ListTableLike } from '../../src/app-runtime/list-table';

interface Row extends Record< string, unknown > {
	id: number;
	modified: string;
}

function fakeTable(): ListTableLike< Row > & { cleared: number } {
	const el = document.createElement( 'div' ) as unknown as ListTableLike< Row > & { cleared: number };
	el.columns = [];
	el.data = [];
	el.selection = [];
	el.cleared = 0;
	el.clearSelection = () => {
		el.selection = [];
		el.cleared += 1;
	};
	return el;
}

const rows = ( ...ids: number[] ): Row[] => ids.map( ( id ) => ( { id, modified: 'm' } ) );
const fp = ( list: Row[] ): string => list.map( ( r ) => `${ r.id }:${ r.modified }` ).join( '|' );

afterEach( () => {
	document.documentElement.removeAttribute( 'data-os-mode' );
} );

describe( 'createListTableSync', () => {
	test( 'wires once, builds the desk columns once, and assigns data only when the fingerprint changes', () => {
		const table = fakeTable();
		const sync = createListTableSync< Row >();
		const wire = vi.fn();
		const columns = vi.fn( ( phone: boolean ) => [ { key: phone ? 'phone' : 'desk' } ] );
		const list = rows( 1, 2 );

		const first = sync.sync( { table, rows: list, listKey: 'a', fingerprint: fp( list ), columns, wire } );
		expect( first ).toEqual( { phone: false, columnsChanged: true, dataChanged: true, selectionChanged: false } );
		expect( table.columns ).toEqual( [ { key: 'desk' } ] );
		expect( table.data ).toBe( list );

		// A selection repaint: same query, same rows — nothing reassigned.
		const again = sync.sync( { table, rows: rows( 1, 2 ), listKey: 'a', fingerprint: fp( list ), columns, wire } );
		expect( again.dataChanged ).toBe( false );
		expect( again.columnsChanged ).toBe( false );
		expect( table.data ).toBe( list );
		expect( wire ).toHaveBeenCalledTimes( 1 );
		expect( columns ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a query change clears the selection; a data change prunes it to the visible rows', () => {
		const table = fakeTable();
		const sync = createListTableSync< Row >();
		const onSelection = vi.fn();
		const base = { table, columns: () => [], onSelection };
		const page1 = rows( 1, 2, 3 );
		sync.sync( { ...base, rows: page1, listKey: 'p1', fingerprint: fp( page1 ) } );
		table.selection = [ '2', '3' ];

		// Same query, a row left (deleted elsewhere): prune.
		const fewer = rows( 1, 2 );
		const pruned = sync.sync( { ...base, rows: fewer, listKey: 'p1', fingerprint: fp( fewer ) } );
		expect( pruned.selectionChanged ).toBe( true );
		expect( Array.from( table.selection ?? [] ) ).toEqual( [ '2' ] );
		expect( onSelection ).toHaveBeenLastCalledWith( [ '2' ] );

		// New query: cleared through the table's own method.
		const page2 = rows( 7, 8 );
		const next = sync.sync( { ...base, rows: page2, listKey: 'p2', fingerprint: fp( page2 ) } );
		expect( next.selectionChanged ).toBe( true );
		expect( table.cleared ).toBe( 1 );
		expect( onSelection ).toHaveBeenLastCalledWith( [] );
	} );

	test( 'a phone gets the card list and the phone columns; the desk gets them back', () => {
		const table = fakeTable();
		const sync = createListTableSync< Row >();
		const columns = vi.fn( ( phone: boolean ) => ( phone ? [ 'title' ] : [ 'title', 'author' ] ) );
		const list = rows( 1 );
		const base = { table, rows: list, listKey: 'x', fingerprint: fp( list ), columns };

		document.documentElement.setAttribute( 'data-os-mode', 'mobile' );
		expect( sync.sync( base ).phone ).toBe( true );
		expect( table.hasAttribute( 'stacked' ) ).toBe( true );
		expect( table.columns ).toEqual( [ 'title' ] );

		document.documentElement.removeAttribute( 'data-os-mode' );
		const desk = sync.sync( base );
		expect( desk.phone ).toBe( false );
		expect( desk.columnsChanged ).toBe( true );
		expect( table.hasAttribute( 'stacked' ) ).toBe( false );
		expect( table.columns ).toEqual( [ 'title', 'author' ] );
	} );

	test( 'invalidateColumns() and invalidateData() force the next sync', () => {
		const table = fakeTable();
		const sync = createListTableSync< Row >();
		const columns = vi.fn( () => [] );
		const list = rows( 1 );
		const base = { table, rows: list, listKey: 'x', fingerprint: fp( list ), columns };
		sync.sync( base );
		sync.invalidateColumns();
		sync.invalidateData();
		const forced = sync.sync( base );
		expect( forced.columnsChanged ).toBe( true );
		expect( forced.dataChanged ).toBe( true );
		expect( columns ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'a missing table is a no-op', () => {
		const sync = createListTableSync< Row >();
		expect( sync.sync( { table: null, rows: [], listKey: '', fingerprint: '', columns: () => [] } ) ).toEqual( {
			phone: false,
			columnsChanged: false,
			dataChanged: false,
			selectionChanged: false,
		} );
	} );
} );
