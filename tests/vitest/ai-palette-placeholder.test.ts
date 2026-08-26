/**
 * The first ⌘K of a session waits on three things at once — the impl
 * bundle, its deferred stylesheet, and the Core palette runtime — and
 * used to show nothing at all while they loaded. These pin the
 * placeholder that covers that gap.
 */

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
		// A `role="dialog"` here would pull focus away from wherever
		// the real panel is about to claim it.
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

	it( 'is inert to the pointer, so it cannot eat the click that follows', () => {
		showPalettePlaceholder();

		const el = document.getElementById( ID ) as HTMLElement;
		expect( el.style.pointerEvents ).toBe( 'none' );
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
		// Nothing else is listening for Escape during this window: the
		// panel binds its handler to an element that does not exist
		// yet, and the palette cycle never listens for Escape at all.
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
		// e.g. one left behind by an earlier bundle version.
		const stray = document.createElement( 'div' );
		stray.id = ID;
		document.body.appendChild( stray );

		hidePalettePlaceholder();

		expect( document.getElementById( ID ) ).toBeNull();
	} );
} );
