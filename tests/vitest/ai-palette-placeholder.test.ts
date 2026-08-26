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

	it( 'sweeps up a stray copy it does not own', () => {
		// e.g. one left behind by an earlier bundle version.
		const stray = document.createElement( 'div' );
		stray.id = ID;
		document.body.appendChild( stray );

		hidePalettePlaceholder();

		expect( document.getElementById( ID ) ).toBeNull();
	} );
} );
