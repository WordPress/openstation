import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	clearKeyedList,
	renderKeyedList,
} from '../../src/ui/util/keyed-list';

interface Item {
	id: number;
	label: string;
}

function buildHost(): HTMLElement {
	return document.createElement( 'div' );
}

function build( item: Item ): HTMLElement {
	const li = document.createElement( 'li' );
	li.dataset.id = String( item.id );
	li.textContent = item.label;
	return li;
}

afterEach( () => {
	document.body.innerHTML = '';
} );

describe( 'renderKeyedList', () => {
	test( 'reuses the SAME element across renders for the same key', () => {
		const host = buildHost();
		document.body.appendChild( host );

		renderKeyedList( host, [ { id: 1, label: 'a' } ], {
			keyOf: ( i ) => i.id,
			buildItem: build,
		} );
		const original = host.firstElementChild;
		expect( original?.textContent ).toBe( 'a' );

		renderKeyedList( host, [ { id: 1, label: 'a' } ], {
			keyOf: ( i ) => i.id,
			buildItem: build,
		} );
		expect( host.firstElementChild ).toBe( original );
	} );

	test( 'event listeners on a reused row survive the re-render', () => {
		const host = buildHost();
		document.body.appendChild( host );
		const onClick = vi.fn();

		renderKeyedList( host, [ { id: 1, label: 'a' } ], {
			keyOf: ( i ) => i.id,
			buildItem: ( item ) => {
				const el = build( item );
				el.addEventListener( 'click', onClick );
				return el;
			},
		} );

		const li = host.firstElementChild as HTMLElement;
		li.click();
		expect( onClick ).toHaveBeenCalledTimes( 1 );

		renderKeyedList( host, [ { id: 1, label: 'a' } ], {
			keyOf: ( i ) => i.id,
			buildItem: ( item ) => {
				const el = build( item );
				el.addEventListener( 'click', onClick );
				return el;
			},
		} );

		( host.firstElementChild as HTMLElement ).click();
		expect( onClick ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'updateItem refreshes data on reused rows without rebuilding', () => {
		const host = buildHost();
		const buildSpy = vi.fn( build );
		const updateSpy = vi.fn( ( el: HTMLElement, item: Item ) => {
			el.textContent = item.label;
		} );

		renderKeyedList( host, [ { id: 1, label: 'a' } ], {
			keyOf: ( i ) => i.id,
			buildItem: buildSpy,
			updateItem: updateSpy,
		} );
		expect( buildSpy ).toHaveBeenCalledTimes( 1 );
		expect( updateSpy ).toHaveBeenCalledTimes( 0 );

		renderKeyedList( host, [ { id: 1, label: 'b' } ], {
			keyOf: ( i ) => i.id,
			buildItem: buildSpy,
			updateItem: updateSpy,
		} );
		expect( buildSpy ).toHaveBeenCalledTimes( 1 );
		expect( updateSpy ).toHaveBeenCalledTimes( 1 );
		expect( host.firstElementChild?.textContent ).toBe( 'b' );
	} );

	test( 'removes elements whose key drops out of the list', () => {
		const host = buildHost();
		renderKeyedList(
			host,
			[ { id: 1, label: 'a' }, { id: 2, label: 'b' } ],
			{ keyOf: ( i ) => i.id, buildItem: build },
		);
		expect( host.children ).toHaveLength( 2 );

		renderKeyedList( host, [ { id: 2, label: 'b' } ], {
			keyOf: ( i ) => i.id,
			buildItem: build,
		} );
		expect( host.children ).toHaveLength( 1 );
		expect( host.firstElementChild?.textContent ).toBe( 'b' );
	} );

	test( 'reorders rows in place without touching unchanged neighbours', () => {
		const host = buildHost();
		document.body.appendChild( host );
		renderKeyedList(
			host,
			[
				{ id: 1, label: 'a' },
				{ id: 2, label: 'b' },
				{ id: 3, label: 'c' },
			],
			{ keyOf: ( i ) => i.id, buildItem: build },
		);
		const [ liA, liB, liC ] = Array.from( host.children );

		renderKeyedList(
			host,
			[
				{ id: 2, label: 'b' },
				{ id: 1, label: 'a' },
				{ id: 3, label: 'c' },
			],
			{ keyOf: ( i ) => i.id, buildItem: build },
		);
		expect( host.children[ 0 ] ).toBe( liB );
		expect( host.children[ 1 ] ).toBe( liA );
		expect( host.children[ 2 ] ).toBe( liC );
	} );

	test( 'clearKeyedList wipes state + DOM children', () => {
		const host = buildHost();
		renderKeyedList( host, [ { id: 1, label: 'a' } ], {
			keyOf: ( i ) => i.id,
			buildItem: build,
		} );
		expect( host.children ).toHaveLength( 1 );
		clearKeyedList( host );
		expect( host.children ).toHaveLength( 0 );

		renderKeyedList( host, [ { id: 1, label: 'a' } ], {
			keyOf: ( i ) => i.id,
			buildItem: build,
		} );
		expect( host.children ).toHaveLength( 1 );
	} );
} );
