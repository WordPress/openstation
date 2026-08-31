/**
 * App Framework runtime — DOM morph.
 *
 * The morph is what lets a server-rendered window feel live: nodes
 * survive a re-render, so custom elements keep their shadow roots,
 * focus stays put, and scroll positions don't jump.
 */
import { describe, expect, it } from 'vitest';
import { morphChildren } from '../../src/app-runtime/morph';

function mount( html: string ): HTMLElement {
	const root = document.createElement( 'div' );
	root.innerHTML = html.trim();
	document.body.appendChild( root );
	return root;
}

describe( 'morphChildren', () => {
	it( 'syncs attributes and text in place without replacing the node', () => {
		const root = mount( '<p class="a" data-x="1">old</p>' );
		const p = root.firstElementChild as HTMLElement;
		morphChildren( root, '<p class="b" title="t">new</p>' );
		expect( root.firstElementChild ).toBe( p );
		expect( p.className ).toBe( 'b' );
		expect( p.getAttribute( 'title' ) ).toBe( 't' );
		expect( p.hasAttribute( 'data-x' ) ).toBe( false );
		expect( p.textContent ).toBe( 'new' );
	} );

	it( 'reorders keyed children by identity instead of rebuilding them', () => {
		const root = mount( '<ul><li os-key="a">A</li><li os-key="b">B</li><li os-key="c">C</li></ul>' );
		const ul = root.firstElementChild as HTMLElement;
		const [ a, b, c ] = Array.from( ul.children );
		morphChildren( root, '<ul><li os-key="c">C2</li><li os-key="a">A</li></ul>' );
		expect( Array.from( ul.children ) ).toEqual( [ c, a ] );
		expect( c.textContent ).toBe( 'C2' );
		expect( b.isConnected ).toBe( false );
	} );

	it( 'inserts, appends and removes unkeyed children positionally', () => {
		const root = mount( '<span>1</span><span>2</span><span>3</span>' );
		const first = root.children[ 0 ];
		morphChildren( root, '<span>1</span><em>x</em><span>3</span><span>4</span>' );
		expect( root.children[ 0 ] ).toBe( first );
		expect( Array.from( root.children ).map( ( c ) => c.tagName + c.textContent ) ).toEqual( [
			'SPAN1',
			'EMx',
			'SPAN3',
			'SPAN4',
		] );
		morphChildren( root, '<span>1</span>' );
		expect( root.children ).toHaveLength( 1 );
	} );

	it( 'leaves an os-preserve subtree alone', () => {
		const root = mount( '<div os-preserve class="mine"><b>kept</b></div>' );
		const kept = root.querySelector( 'b' );
		morphChildren( root, '<div os-preserve class="theirs"><i>replaced</i></div>' );
		expect( root.querySelector( 'b' ) ).toBe( kept );
		expect( root.firstElementChild?.className ).toBe( 'mine' );
	} );

	it( 'does not rewind the value of the focused control', () => {
		const root = mount( '<input value="typed">' );
		const input = root.firstElementChild as HTMLInputElement;
		input.value = 'typed more';
		input.focus();
		expect( document.activeElement ).toBe( input );
		morphChildren( root, '<input value="stale">' );
		expect( input.value ).toBe( 'typed more' );
		expect( input.getAttribute( 'value' ) ).toBe( 'typed' );
		input.blur();
		morphChildren( root, '<input value="fresh">' );
		expect( input.value ).toBe( 'fresh' );
	} );

	it( 'keeps a custom element instance and routes attribute changes through it', () => {
		const seen: string[] = [];
		class OsProbe extends HTMLElement {
			static get observedAttributes() {
				return [ 'value' ];
			}
			attributeChangedCallback( _name: string, _old: string | null, value: string | null ) {
				seen.push( String( value ) );
			}
		}
		customElements.define( 'os-probe-morph', OsProbe );
		const root = mount( '<os-probe-morph value="1"></os-probe-morph>' );
		const probe = root.firstElementChild;
		morphChildren( root, '<os-probe-morph value="2"></os-probe-morph>' );
		expect( root.firstElementChild ).toBe( probe );
		expect( seen ).toEqual( [ '1', '2' ] );
	} );
} );
