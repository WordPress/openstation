/**
 * The `html` tag inside tables. The HTML parser foster-parents stray
 * text out of `<table>`, `<tbody>` and `<tr>`; a text marker between
 * two `<td>`s therefore landed AFTER the table and every cell rendered
 * there with it. Child-position slots are marked with comments now,
 * which the parser leaves where they are. Attribute and raw-text
 * slots keep their text markers.
 */
import { describe, expect, it } from 'vitest';
import { html, render } from './html';

describe( 'html — slots in table context', () => {
	it( 'keeps an array of cell templates inside the row', () => {
		const root = document.createElement( 'div' );
		const cell = ( c: string ) => html`<td class=${ c }>${ 'x' + c }</td>`;
		render( html`<table><tbody><tr class="r">${ [ 'a', 'b' ].map( cell ) }</tr></tbody></table>`, root );
		expect( root.querySelectorAll( 'tr.r > td' ) ).toHaveLength( 2 );
		expect( root.querySelector( 'tr.r > td.b' )?.textContent ).toBe( 'xb' );
		// Nothing escaped the table.
		expect( root.children ).toHaveLength( 1 );
		expect( root.firstElementChild?.tagName ).toBe( 'TABLE' );
	} );

	it( 'keeps row templates inside the body and re-renders them in place', () => {
		const root = document.createElement( 'div' );
		const rows = ( ids: number[] ) => html`
			<table><tbody>${ ids.map( ( id ) => html`<tr data-id=${ String( id ) }><td>${ id }</td></tr>` ) }</tbody></table>
		`;
		render( rows( [ 1, 2 ] ), root );
		expect( Array.from( root.querySelectorAll( 'tbody > tr' ), ( tr ) => tr.getAttribute( 'data-id' ) ) ).toEqual( [ '1', '2' ] );
		const first = root.querySelector( 'tr[data-id="1"]' );
		render( rows( [ 1, 2, 3 ] ), root );
		expect( root.querySelectorAll( 'tbody > tr' ) ).toHaveLength( 3 );
		// The same node survives the re-render — the diff kept it.
		expect( root.querySelector( 'tr[data-id="1"]' ) ).toBe( first );
		render( rows( [] ), root );
		expect( root.querySelectorAll( 'tbody > tr' ) ).toHaveLength( 0 );
	} );

	it( 'still binds attributes, events and properties on table elements', () => {
		const root = document.createElement( 'div' );
		let clicked = 0;
		render(
			html`<table><thead><tr><th class=${ 'h' } aria-sort=${ 'none' } @click=${ () => clicked++ }>ID</th></tr></thead></table>`,
			root,
		);
		const th = root.querySelector< HTMLElement >( 'th.h' )!;
		expect( th.getAttribute( 'aria-sort' ) ).toBe( 'none' );
		th.click();
		expect( clicked ).toBe( 1 );
	} );

	it( 'treats a slot inside a raw-text element and inside a comment as text, not a child part', () => {
		const root = document.createElement( 'div' );
		render( html`<div><!-- ${ 'ignored' } --><textarea>${ 'typed' }</textarea><style>${ '.x{color:red}' }</style></div>`, root );
		expect( root.querySelector( 'textarea' )?.textContent ).toBe( 'typed' );
		expect( root.querySelector( 'style' )?.textContent ).toBe( '.x{color:red}' );
		// The comment kept its marker text verbatim — no part was built for it.
		expect( root.innerHTML ).toContain( '<!-- $$wpd$$0$$ -->' );
	} );

	it( 'a stray < in text does not open a tag', () => {
		const root = document.createElement( 'div' );
		render( html`<p>a < b ${ 'and' } c</p>`, root );
		expect( root.querySelector( 'p' )?.textContent ).toBe( 'a < b and c' );
	} );
} );
