import { describe, expect, it, vi } from 'vitest';
import { makeRowActionButton } from './row-action-button';

function glyph(): HTMLElement {
	const g = document.createElement( 'span' );
	g.className = 'glyph';
	return g;
}

describe( 'makeRowActionButton', () => {
	it( 'is a labelled, row-click-exempt button carrying the glyph', () => {
		const btn = makeRowActionButton( { label: 'Restore', glyph: glyph(), onClick: () => undefined } );
		expect( btn.tagName ).toBe( 'BUTTON' );
		expect( ( btn as HTMLButtonElement ).type ).toBe( 'button' );
		expect( btn.hasAttribute( 'data-noclick' ) ).toBe( true );
		expect( btn.getAttribute( 'aria-label' ) ).toBe( 'Restore' );
		expect( btn.title ).toBe( 'Restore' );
		expect( btn.querySelector( '.glyph' ) ).not.toBeNull();
		expect( btn.textContent?.trim() ).toBe( '' );
	} );

	it( 'rests on the surface token with muted text, never on an inherited colour', () => {
		const btn = makeRowActionButton( { label: 'Reset', glyph: glyph(), onClick: () => undefined } );
		expect( btn.style.background ).toContain( '--os-ui-surface' );
		expect( btn.style.color ).toContain( '--os-ui-fg-muted' );
		expect( btn.style.border ).toContain( '--os-ui-border' );
		expect( btn.style.color ).not.toBe( 'inherit' );
		expect( btn.style.cssText ).not.toContain( '--os-ui-btn-bg' );
	} );

	it( 'keeps the pre-brand literals as fallbacks', () => {
		const btn = makeRowActionButton( { label: 'Reset', glyph: glyph(), onClick: () => undefined } );
		expect( btn.style.background ).toContain( '#fff' );
		expect( btn.style.color ).toContain( '#50575e' );
	} );

	it( 'swaps to the hover wash under the pointer and on focus, and back', () => {
		const btn = makeRowActionButton( { label: 'Reset', glyph: glyph(), onClick: () => undefined } );
		btn.dispatchEvent( new Event( 'mouseenter' ) );
		expect( btn.style.background ).toContain( '--os-ui-hover' );
		expect( btn.style.color ).toContain( '--os-ui-fg' );
		expect( btn.style.borderColor ).toContain( '--os-ui-border-strong' );
		btn.dispatchEvent( new Event( 'mouseleave' ) );
		expect( btn.style.background ).toContain( '--os-ui-surface' );
		expect( btn.style.color ).toContain( '--os-ui-fg-muted' );
		btn.dispatchEvent( new Event( 'focus' ) );
		expect( btn.style.background ).toContain( '--os-ui-hover' );
		btn.dispatchEvent( new Event( 'blur' ) );
		expect( btn.style.background ).toContain( '--os-ui-surface' );
	} );

	it( 'paints the danger face through the danger token, filled on hover', () => {
		const btn = makeRowActionButton( { label: 'Delete', glyph: glyph(), onClick: () => undefined, variant: 'danger' } );
		expect( btn.style.color ).toContain( '--os-ui-danger' );
		expect( btn.style.border ).toContain( '--os-ui-danger' );
		btn.dispatchEvent( new Event( 'mouseenter' ) );
		expect( btn.style.background ).toContain( '--os-ui-danger' );
		expect( btn.style.color ).toContain( '--os-ui-fg-on-accent' );
	} );

	it( 'prints the label beside the glyph when labelled', () => {
		const btn = makeRowActionButton( { label: 'Restore', glyph: glyph(), onClick: () => undefined, labelled: true } );
		expect( btn.textContent?.trim() ).toBe( 'Restore' );
		expect( btn.style.width ).toBe( 'auto' );
	} );

	it( 'runs the handler on click without letting the row see it', () => {
		const onClick = vi.fn();
		const row = document.createElement( 'div' );
		const seen = vi.fn();
		row.addEventListener( 'click', seen );
		const btn = makeRowActionButton( { label: 'Reset', glyph: glyph(), onClick } );
		row.appendChild( btn );
		btn.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		expect( onClick ).toHaveBeenCalledTimes( 1 );
		expect( seen ).not.toHaveBeenCalled();
	} );
} );
