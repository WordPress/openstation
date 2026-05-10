/**
 * Tests for the window switcher: cycleFocus rotates focus through the
 * active desktop's windows in stable DOM order, restoring minimized
 * targets along the way.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import {
	cycleFocus,
	isTextEntryFocus,
} from '../../src/window-manager/switcher';
import {
	clearHooksStub,
	installHooksStub,
	type FakeWpHooks,
} from './helpers/hooks-stub';

function openConfig( id: string ) {
	return {
		id,
		url: `http://example.test/wp-admin/${ id }.php`,
		title: id,
		icon: 'dashicons-admin-generic',
	};
}

describe( 'WindowManager — window switcher (cycleFocus)', () => {
	let hooks: FakeWpHooks;
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		hooks = installHooksStub();
		void hooks;
		desktop = document.createElement( 'div' );
		Object.defineProperty( desktop, 'clientWidth', {
			value: 1600,
			configurable: true,
		} );
		Object.defineProperty( desktop, 'clientHeight', {
			value: 900,
			configurable: true,
		} );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	test( 'no-op with fewer than two windows', () => {
		cycleFocus( manager, 'next' );
		expect( manager.getFocused() ).toBeUndefined();

		const only = manager.open( openConfig( 'a' ) );
		cycleFocus( manager, 'next' );
		expect( manager.getFocused() ).toBe( only );
	} );

	test( 'next cycles forward through DOM order and wraps', () => {
		const a = manager.open( openConfig( 'a' ) );
		const b = manager.open( openConfig( 'b' ) );
		const c = manager.open( openConfig( 'c' ) );
		expect( manager.getFocused() ).toBe( c );

		cycleFocus( manager, 'next' );
		expect( manager.getFocused() ).toBe( a );

		cycleFocus( manager, 'next' );
		expect( manager.getFocused() ).toBe( b );

		cycleFocus( manager, 'next' );
		expect( manager.getFocused() ).toBe( c );
	} );

	test( 'prev cycles backward through DOM order and wraps', () => {
		const a = manager.open( openConfig( 'a' ) );
		const b = manager.open( openConfig( 'b' ) );
		const c = manager.open( openConfig( 'c' ) );
		expect( manager.getFocused() ).toBe( c );

		cycleFocus( manager, 'prev' );
		expect( manager.getFocused() ).toBe( b );

		cycleFocus( manager, 'prev' );
		expect( manager.getFocused() ).toBe( a );

		cycleFocus( manager, 'prev' );
		expect( manager.getFocused() ).toBe( c );
	} );

	test( 'restores a minimized target on the way in', () => {
		const a = manager.open( openConfig( 'a' ) );
		manager.open( openConfig( 'b' ) );
		a.minimize();
		expect( a.state ).toBe( 'minimized' );

		cycleFocus( manager, 'next' );

		expect( a.state ).toBe( 'normal' );
		expect( manager.getFocused() ).toBe( a );
	} );

	test( 'no-op while overview mode is active', () => {
		const a = manager.open( openConfig( 'a' ) );
		const b = manager.open( openConfig( 'b' ) );
		expect( manager.getFocused() ).toBe( b );

		manager._overviewActive = true;
		cycleFocus( manager, 'next' );
		expect( manager.getFocused() ).toBe( b );

		manager._overviewActive = false;
		cycleFocus( manager, 'next' );
		expect( manager.getFocused() ).toBe( a );
	} );

	describe( 'isTextEntryFocus gate', () => {
		let transient: HTMLElement[] = [];

		function mount<T extends HTMLElement>( el: T ): T {
			document.body.appendChild( el );
			transient.push( el );
			return el;
		}

		afterEach( () => {
			for ( const el of transient ) {
				el.remove();
			}
			transient = [];
		} );

		test( 'returns true when a nested iframe is focused (Gutenberg case)', () => {
			const iframe = mount( document.createElement( 'iframe' ) );
			iframe.tabIndex = 0;
			iframe.focus();
			expect( document.activeElement ).toBe( iframe );
			expect( isTextEntryFocus( document ) ).toBe( true );
		} );

		test( 'returns true when a TEXTAREA is focused', () => {
			const ta = mount( document.createElement( 'textarea' ) );
			ta.focus();
			expect( isTextEntryFocus( document ) ).toBe( true );
		} );

		test( 'returns true when a text INPUT is focused', () => {
			const input = mount( document.createElement( 'input' ) );
			input.type = 'text';
			input.focus();
			expect( isTextEntryFocus( document ) ).toBe( true );
		} );

		test( 'returns false when a button INPUT is focused', () => {
			const input = mount( document.createElement( 'input' ) );
			input.type = 'button';
			input.focus();
			expect( isTextEntryFocus( document ) ).toBe( false );
		} );

		test( 'returns true when a contenteditable DIV is focused', () => {
			const div = mount( document.createElement( 'div' ) );
			div.setAttribute( 'contenteditable', 'true' );
			div.tabIndex = 0;
			div.focus();
			expect( isTextEntryFocus( document ) ).toBe( true );
		} );

		test( 'returns false when a plain button is focused', () => {
			const btn = mount( document.createElement( 'button' ) );
			btn.focus();
			expect( isTextEntryFocus( document ) ).toBe( false );
		} );
	} );
} );
