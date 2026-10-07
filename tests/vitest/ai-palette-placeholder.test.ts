import { beforeEach, describe, expect, it } from 'vitest';
import {
	hidePalettePlaceholder,
	showPalettePlaceholder,
} from '../../src/ai-assistant/loading-placeholder';

const ID = 'os-ai-loading';

describe( 'command-palette loading placeholder', () => {
	beforeEach( () => {
		hidePalettePlaceholder();
		document.body.innerHTML = '';
		document.head.innerHTML = '';
	} );

	it( 'paints a placeholder into the document', () => {
		showPalettePlaceholder();

		const el = document.getElementById( ID );
		expect( el ).not.toBeNull();
		expect( el?.textContent ).toContain( 'command palette' );
	} );

	it( 'announces politely rather than posing as a dialog', () => {

		showPalettePlaceholder();

		const el = document.getElementById( ID );
		expect( el?.getAttribute( 'role' ) ).toBe( 'status' );
		expect( el?.getAttribute( 'aria-live' ) ).toBe( 'polite' );
	} );

	it( 'never stacks a second copy when ⌘K is pressed again', () => {
		showPalettePlaceholder();
		showPalettePlaceholder();

		expect( document.querySelectorAll( `#${ ID }` ) ).toHaveLength( 1 );
	} );

	it( 'a click on the dimmed area cancels, a click on the card does not', () => {

		let cancelled = 0;
		showPalettePlaceholder( () => {
			cancelled += 1;
		} );
		const el = document.getElementById( ID ) as HTMLElement;

		( el.lastElementChild as HTMLElement ).click();
		expect( cancelled ).toBe( 0 );
		( el.firstElementChild as HTMLElement ).click();

		expect( cancelled ).toBe( 1 );
		expect( document.getElementById( ID ) ).toBeNull();
	} );

	it( 'a second handoff does not cut the first one short', () => {

		showPalettePlaceholder();
		hidePalettePlaceholder( true );
		hidePalettePlaceholder( true );

		expect( document.getElementById( ID ) ).not.toBeNull();
	} );

	it( 'removes cleanly', () => {
		showPalettePlaceholder();
		hidePalettePlaceholder();

		expect( document.getElementById( ID ) ).toBeNull();
	} );

	it( 'hiding without showing is a no-op, not a throw', () => {
		expect( () => hidePalettePlaceholder() ).not.toThrow();
	} );

	it( 'Escape takes it down and reports the cancel', () => {

		let cancelled = 0;
		showPalettePlaceholder( () => {
			cancelled += 1;
		} );

		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape' } ),
		);

		expect( cancelled ).toBe( 1 );
		expect( document.getElementById( ID ) ).toBeNull();
	} );

	it( 'ignores keys that are not Escape', () => {
		let cancelled = 0;
		showPalettePlaceholder( () => {
			cancelled += 1;
		} );

		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'a' } ) );

		expect( cancelled ).toBe( 0 );
		expect( document.getElementById( ID ) ).not.toBeNull();
	} );

	it( 'stops listening once hidden, so a later Escape is not swallowed', () => {
		let cancelled = 0;
		showPalettePlaceholder( () => {
			cancelled += 1;
		} );
		hidePalettePlaceholder();

		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape' } ),
		);

		expect( cancelled ).toBe( 0 );
	} );

	it( 'sweeps up a stray copy it does not own', () => {

		const stray = document.createElement( 'div' );
		stray.id = ID;
		document.body.appendChild( stray );

		hidePalettePlaceholder();

		expect( document.getElementById( ID ) ).toBeNull();
	} );
} );
