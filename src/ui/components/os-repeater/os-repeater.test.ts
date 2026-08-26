/**
 * `<os-repeater>` — the contract is that it reports intent and never
 * mutates its own `keys`.
 *
 * The consumer owns the data the rows are a view of, so a component
 * that removed a row on its own would be right exactly until the
 * removal failed to persist. Every test here checks both halves: the
 * event carries the already-applied list, and `keys` is unchanged
 * until the consumer assigns it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import './os-repeater';
import type { OsRepeater } from './os-repeater';

const tick = (): Promise< void > => Promise.resolve();

describe( '<os-repeater>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => {
		host.remove();
	} );

	async function mount( attrs = '' ): Promise< OsRepeater > {
		host.innerHTML = `<os-repeater ${ attrs }></os-repeater>`;
		const el = host.querySelector( 'os-repeater' ) as OsRepeater;
		el.keys = [ 'a', 'b', 'c' ];
		await tick();
		return el;
	}

	function rows( el: OsRepeater ): HTMLElement[] {
		return Array.from(
			el.shadowRoot!.querySelectorAll< HTMLElement >( '.os-repeater__row' ),
		);
	}

	test( 'renders one keyed slot per row, in order', async () => {
		const el = await mount();
		const slots = rows( el ).map(
			( row ) => row.querySelector( 'slot' )!.getAttribute( 'name' ),
		);
		expect( slots ).toEqual( [ 'row-a', 'row-b', 'row-c' ] );
	} );

	test( 'remove reports the list with the row already dropped, and does not apply it', async () => {
		const el = await mount();
		const seen = vi.fn();
		el.addEventListener( 'os-repeater-remove', ( e ) =>
			seen( ( e as CustomEvent ).detail ),
		);

		(
			rows( el )[ 1 ].querySelector( '.os-repeater__remove' ) as HTMLButtonElement
		).click();

		expect( seen ).toHaveBeenCalledWith( {
			key: 'b',
			index: 1,
			keys: [ 'a', 'c' ],
		} );
		// The component is a view. Until the consumer assigns, nothing
		// has happened.
		expect( el.keys ).toEqual( [ 'a', 'b', 'c' ] );
	} );

	test( 'move reports the reordered list', async () => {
		const el = await mount( 'reorderable' );
		const seen = vi.fn();
		el.addEventListener( 'os-repeater-move', ( e ) =>
			seen( ( e as CustomEvent ).detail ),
		);

		const handles = rows( el )[ 2 ].querySelectorAll< HTMLButtonElement >(
			'.os-repeater__handle',
		);
		handles[ 0 ].click(); // up

		expect( seen ).toHaveBeenCalledWith( {
			key: 'c',
			from: 2,
			to: 1,
			keys: [ 'a', 'c', 'b' ],
		} );
		expect( el.keys ).toEqual( [ 'a', 'b', 'c' ] );
	} );

	test( 'the end rows cannot move past the ends', async () => {
		const el = await mount( 'reorderable' );
		const first = rows( el )[ 0 ].querySelectorAll< HTMLButtonElement >(
			'.os-repeater__handle',
		);
		const last = rows( el )[ 2 ].querySelectorAll< HTMLButtonElement >(
			'.os-repeater__handle',
		);
		expect( first[ 0 ].disabled ).toBe( true );
		expect( first[ 1 ].disabled ).toBe( false );
		expect( last[ 1 ].disabled ).toBe( true );
	} );

	test( 'alt+arrow moves the row the focus is inside', async () => {
		const el = await mount( 'reorderable' );
		el.innerHTML = `<div slot="row-b"><input /></div>`;
		await tick();
		const seen = vi.fn();
		el.addEventListener( 'os-repeater-move', ( e ) =>
			seen( ( e as CustomEvent ).detail ),
		);

		el.querySelector( 'input' )!.dispatchEvent(
			new KeyboardEvent( 'keydown', {
				key: 'ArrowUp',
				altKey: true,
				bubbles: true,
				composed: true,
			} ),
		);

		expect( seen ).toHaveBeenCalledWith(
			expect.objectContaining( { key: 'b', from: 1, to: 0 } ),
		);
	} );

	test( 'a bare arrow key is left to the caret', async () => {
		const el = await mount( 'reorderable' );
		el.innerHTML = `<div slot="row-b"><input /></div>`;
		await tick();
		const seen = vi.fn();
		el.addEventListener( 'os-repeater-move', seen );

		el.querySelector( 'input' )!.dispatchEvent(
			new KeyboardEvent( 'keydown', {
				key: 'ArrowUp',
				bubbles: true,
				composed: true,
			} ),
		);

		expect( seen ).not.toHaveBeenCalled();
	} );

	test( 'min disables remove at the floor', async () => {
		const el = await mount( 'min="3"' );
		const remove = rows( el )[ 0 ].querySelector< HTMLButtonElement >(
			'.os-repeater__remove',
		)!;
		expect( remove.disabled ).toBe( true );
	} );

	test( 'max disables add at the ceiling', async () => {
		const el = await mount( 'max="3"' );
		const add = el.shadowRoot!.querySelector( 'os-button' )!;
		expect( add.hasAttribute( 'disabled' ) ).toBe( true );
	} );

	test( 'empty text shows only when there are no rows', async () => {
		const el = await mount( 'empty-text="No choices yet"' );
		expect( el.shadowRoot!.querySelector( '.os-repeater__empty' ) ).toBeNull();

		el.keys = [];
		await tick();
		const empty = el.shadowRoot!.querySelector( '.os-repeater__empty' )!;
		expect( empty.textContent ).toContain( 'No choices yet' );
	} );

	test( 'disabled silences every control', async () => {
		const el = await mount( 'reorderable disabled' );
		const seen = vi.fn();
		el.addEventListener( 'os-repeater-remove', seen );
		el.addEventListener( 'os-repeater-add', seen );

		(
			rows( el )[ 0 ].querySelector( '.os-repeater__remove' ) as HTMLButtonElement
		).click();
		( el.shadowRoot!.querySelector( 'os-button' ) as HTMLElement ).click();

		expect( seen ).not.toHaveBeenCalled();
	} );

	test( 'add-label and row-label reach the DOM', async () => {
		const el = await mount( 'add-label="Add choice" row-label="choice"' );
		expect( el.shadowRoot!.querySelector( 'os-button' )!.textContent ).toContain(
			'Add choice',
		);
		expect(
			rows( el )[ 0 ]
				.querySelector( '.os-repeater__remove' )!
				.getAttribute( 'aria-label' ),
		).toBe( 'Remove choice' );
	} );
} );
