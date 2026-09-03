/**
 * The list-window furniture every list app shares — `statusControl`,
 * `pager` and `mountMenuCheckboxes` from `@openstation/app`.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { render } from '../../src/ui/core/html';
import { mountMenuCheckboxes, pager, statusControl } from '../../src/app-runtime/list-ui';

const segments = [
	{ value: '', label: 'All' },
	{ value: 'publish', label: 'Published' },
	{ value: 'draft', label: 'Drafts' },
];

afterEach( () => {
	document.body.innerHTML = '';
	document.documentElement.removeAttribute( 'data-os-mode' );
} );

describe( 'statusControl', () => {
	test( 'a desk gets a segmented pill bar bound to the state key and the re-query action', () => {
		const host = document.createElement( 'div' );
		render(
			statusControl( { segments, value: 'draft', bind: 'status', action: 'filter', label: 'Status', phone: false } ),
			host,
		);
		const control = host.querySelector( 'os-segmented' );
		expect( control ).not.toBeNull();
		expect( control?.getAttribute( 'os-bind' ) ).toBe( 'status' );
		expect( control?.getAttribute( 'os-action' ) ).toBe( 'filter' );
		expect( control?.getAttribute( 'value' ) ).toBe( 'draft' );
		expect( control?.classList.contains( 'os-app-list__status' ) ).toBe( true );
		const pills = Array.from( host.querySelectorAll( 'os-segment' ) );
		expect( pills.map( ( p ) => p.getAttribute( 'value' ) ) ).toEqual( [ null, 'publish', 'draft' ] );
		expect( pills.map( ( p ) => p.textContent ) ).toEqual( [ 'All', 'Published', 'Drafts' ] );
	} );

	test( 'a phone gets a picker with the same contract', () => {
		const host = document.createElement( 'div' );
		render(
			statusControl( { segments, value: 'publish', bind: 'status', action: 'filter', label: 'Status', phone: true } ),
			host,
		);
		expect( host.querySelector( 'os-segmented' ) ).toBeNull();
		const control = host.querySelector( 'os-select' );
		expect( control?.getAttribute( 'os-bind' ) ).toBe( 'status' );
		expect( control?.getAttribute( 'os-action' ) ).toBe( 'filter' );
		expect( control?.getAttribute( 'aria-label' ) ).toBe( 'Status' );
		expect( host.querySelectorAll( 'os-option' ).length ).toBe( 3 );
	} );

	test( 'the shell mode stamp decides when the caller does not', () => {
		document.documentElement.setAttribute( 'data-os-mode', 'mobile' );
		const host = document.createElement( 'div' );
		render( statusControl( { segments, value: '', bind: 'status', action: 'filter', label: 'Status' } ), host );
		expect( host.querySelector( 'os-select' ) ).not.toBeNull();
	} );
} );

describe( 'pager', () => {
	const labels = { previous: 'Previous', next: 'Next', perPage: 'Per page' };

	test( 'Previous and Next dispatch the page action with the neighbouring page', () => {
		const host = document.createElement( 'div' );
		render( pager( { page: 2, pages: 5, perPage: 20, summary: 'Page 2 of 5 · 90 posts', labels } ), host );
		const buttons = Array.from( host.querySelectorAll( 'os-button' ) );
		expect( buttons.length ).toBe( 2 );
		expect( buttons[ 0 ].getAttribute( 'os-action' ) ).toBe( 'page' );
		expect( buttons[ 0 ].getAttribute( 'os-arg-page' ) ).toBe( '1' );
		expect( buttons[ 1 ].getAttribute( 'os-arg-page' ) ).toBe( '3' );
		expect( buttons[ 0 ].hasAttribute( 'disabled' ) ).toBe( false );
		expect( buttons[ 1 ].hasAttribute( 'disabled' ) ).toBe( false );
		expect( host.querySelector( '.os-app-list__pager-meta' )?.textContent?.trim() ).toBe( 'Page 2 of 5 · 90 posts' );
	} );

	test( 'the edges disable their button, and no pages disables both', () => {
		const host = document.createElement( 'div' );
		render( pager( { page: 1, pages: 1, perPage: 20, summary: '', labels } ), host );
		const buttons = Array.from( host.querySelectorAll( 'os-button' ) );
		expect( buttons[ 0 ].hasAttribute( 'disabled' ) ).toBe( true );
		expect( buttons[ 1 ].hasAttribute( 'disabled' ) ).toBe( true );
		render( pager( { page: 1, pages: 0, perPage: 20, summary: 'No posts', labels } ), host );
		expect( buttons[ 1 ].hasAttribute( 'disabled' ) ).toBe( true );
	} );

	test( 'the per-page select binds its state key, dispatches the re-query action and reflects the current size', () => {
		const host = document.createElement( 'div' );
		render( pager( { page: 1, pages: 3, perPage: 50, summary: '', labels, perPageAction: 'requery' } ), host );
		const select = host.querySelector< HTMLSelectElement >( 'select' );
		expect( select?.getAttribute( 'os-bind' ) ).toBe( 'perPage' );
		expect( select?.getAttribute( 'os-action' ) ).toBe( 'requery' );
		expect( select?.value ).toBe( '50' );
		expect( Array.from( select?.options ?? [] ).map( ( o ) => o.value ) ).toEqual( [ '10', '20', '50', '100' ] );
	} );
} );

describe( 'mountMenuCheckboxes', () => {
	function windowWithMenu(): HTMLElement {
		const win = document.createElement( 'div' );
		win.className = 'os-window';
		const panel = document.createElement( 'div' );
		panel.className = 'os-window__menu-panel';
		win.appendChild( panel );
		const root = document.createElement( 'div' );
		win.appendChild( root );
		document.body.appendChild( win );
		return root;
	}

	test( 'appends a labelled section of checkbox rows and answers a click through onToggle', () => {
		const root = windowWithMenu();
		const hidden = new Set< string >( [ 'date' ] );
		const onToggle = vi.fn( ( key: string ) => {
			if ( hidden.has( key ) ) {
				hidden.delete( key );
			} else {
				hidden.add( key );
			}
		} );
		const handle = mountMenuCheckboxes( root, {
			section: 'Show columns',
			prefix: 'posts',
			items: [
				{ key: 'author', label: 'Author' },
				{ key: 'date', label: 'Date' },
			],
			isChecked: ( key ) => ! hidden.has( key ),
			onToggle,
		} );
		expect( handle ).not.toBeNull();
		const panel = document.querySelector( '.os-window__menu-panel' ) as HTMLElement;
		expect( panel.querySelector( '.os-app__menu-section' )?.textContent ).toBe( 'Show columns' );
		const items = Array.from( panel.querySelectorAll( 'os-menu-item' ) );
		expect( items.map( ( i ) => i.getAttribute( 'value' ) ) ).toEqual( [ 'posts:author', 'posts:date' ] );
		expect( items[ 0 ].hasAttribute( 'checked' ) ).toBe( true );
		expect( items[ 1 ].hasAttribute( 'checked' ) ).toBe( false );

		panel.dispatchEvent(
			new CustomEvent( 'os-menu-item-click', { detail: { value: 'posts:date' } } ),
		);
		expect( onToggle ).toHaveBeenCalledWith( 'date' );
		expect( items[ 1 ].hasAttribute( 'checked' ) ).toBe( true );

		// Another app's rows in the same panel are not ours.
		panel.dispatchEvent(
			new CustomEvent( 'os-menu-item-click', { detail: { value: 'users:date' } } ),
		);
		expect( onToggle ).toHaveBeenCalledTimes( 1 );

		handle?.dispose();
		expect( panel.querySelectorAll( 'os-menu-item' ).length ).toBe( 0 );
		expect( panel.querySelector( '.os-app__menu-section' ) ).toBeNull();
	} );

	test( 'mounting twice under one prefix replaces the first section', () => {
		const root = windowWithMenu();
		const opts = {
			section: 'Show columns',
			prefix: 'posts',
			items: [ { key: 'author', label: 'Author' } ],
			isChecked: () => true,
			onToggle: () => undefined,
		};
		mountMenuCheckboxes( root, opts );
		mountMenuCheckboxes( root, opts );
		const panel = document.querySelector( '.os-window__menu-panel' ) as HTMLElement;
		expect( panel.querySelectorAll( '.os-app__menu-section' ).length ).toBe( 1 );
		expect( panel.querySelectorAll( 'os-menu-item' ).length ).toBe( 1 );
	} );

	test( 'no menu panel, or nothing to toggle, yields null', () => {
		const loose = document.createElement( 'div' );
		document.body.appendChild( loose );
		expect(
			mountMenuCheckboxes( loose, {
				section: 'x',
				prefix: 'p',
				items: [ { key: 'a', label: 'A' } ],
				isChecked: () => true,
				onToggle: () => undefined,
			} ),
		).toBeNull();
		const root = windowWithMenu();
		expect(
			mountMenuCheckboxes( root, { section: 'x', prefix: 'p', items: [], isChecked: () => true, onToggle: () => undefined } ),
		).toBeNull();
	} );
} );
