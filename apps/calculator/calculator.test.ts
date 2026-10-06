import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../../src/app-runtime/session';
import type { AppConfig, RuntimeHost } from '../../src/app-runtime/types';
import '../../src/ui/components/os-button/os-button';
import '../../src/ui/components/os-display/os-display';
import app, { initialState, pressKey } from './calculator.os';

function enter( ...keys: string[] ) {
	const state = initialState();
	for ( const key of keys ) {
		pressKey( state, key );
	}
	return state;
}

afterEach( () => document.body.replaceChildren() );

describe( 'calculator arithmetic', () => {
	it.each( [
		[ '+', '11' ], [ '-', '5' ], [ '*', '24' ], [ '/', '2.66666666667' ],
	] )( 'calculates %s', ( operator, result ) => {
		expect( enter( '8', operator, '3', '=' ).display ).toBe( result );
	} );

	it( 'uses immediate execution, replaces pending operators, and repeats equals', () => {
		expect( enter( '2', '+', '3', '*', '4', '=' ).display ).toBe( '20' );
		expect( enter( '9', '+', '/', '3', '=' ).display ).toBe( '3' );
		expect( enter( '2', '+', '3', '=', '=' ).display ).toBe( '8' );
		expect( enter( '5', '+', '=' ).display ).toBe( '10' );
	} );

	it( 'handles decimal input, rounding, sign changes, and backspace', () => {
		expect( enter( '.', '1', '.', '2' ).display ).toBe( '0.12' );
		expect( enter( '.', '1', '+', '.', '2', '=' ).display ).toBe( '0.3' );
		expect( enter( '8', '*', 'sign', '2', '=' ).display ).toBe( '-16' );
		expect( enter( 'sign', '4' ).display ).toBe( '-4' );
		expect( enter( 'sign', '4', 'backspace' ).display ).toBe( '0' );
		expect( enter( '1', '2', '3', 'backspace' ).display ).toBe( '12' );
	} );

	it( 'computes percentages relative to addition and subtraction and supports chaining', () => {
		expect( enter( '2', '0', '0', '+', '1', '0', 'percent', '=' ).display ).toBe( '220' );
		expect( enter( '2', '0', '0', '-', '1', '0', 'percent', '=' ).display ).toBe( '180' );
		expect( enter( '2', '0', '0', '*', '1', '0', 'percent', '=' ).display ).toBe( '20' );
		expect( enter( '5', '0', 'percent' ).display ).toBe( '0.5' );
		expect( enter( '2', '0', '0', '+', '1', '0', 'percent', '+', '1', '=' ).display ).toBe( '221' );
	} );

	it( 'starts a fresh number after a result and keeps signed exponential results valid', () => {
		expect( enter( '2', '+', '3', '=', '9' ).display ).toBe( '9' );
		expect( enter( '2', '+', '3', '=', 'sign', '9' ).display ).toBe( '9' );
		const state = enter( '9', '/', '9', '9', '9', '9', '9', '9', '9', '9', '9', '9', '9', '9', '=', 'sign' );
		expect( Number( state.display ) ).toBeLessThan( 0 );
		pressKey( state, '3' );
		expect( state.display ).toBe( '3' );
	} );

	it( 'recovers from division by zero with a digit or clear', () => {
		const state = enter( '5', '/', '0', '=' );
		expect( state.error ).toBe( true );
		pressKey( state, '+' );
		expect( state.error ).toBe( true );
		pressKey( state, '7' );
		expect( state ).toMatchObject( { display: '7', error: false, operator: '' } );
		pressKey( state, 'clear' );
		expect( state ).toEqual( initialState() );
	} );

	it( 'limits entered digits and reports arithmetic overflow', () => {
		expect( enter( ...'123456789012345' ).display ).toBe( '123456789012' );
		const state = { ...initialState(), display: '1e308' };
		pressKey( state, '*' );
		pressKey( state, '9' );
		pressKey( state, '=' );
		expect( state.error ).toBe( true );
	} );
} );

function mount() {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const fetch = vi.fn( async ( _input, init ) => ( {
		ok: true,
		json: async () => ( {
			ok: true,
			state: JSON.parse( String( init?.body ) ).state,
			data: [],
			html: '',
			effects: [],
		} ),
	} as Response ) );
	const config: AppConfig = {
		osApp: true, id: app.id, title: 'Calculator',
		endpoint: 'https://example.test/apps/calculator/dispatch', restNonce: 'nonce',
		state: initialState(), data: [], titleBarButtons: [], windowActions: [], appearance: {}, extra: {},
	};
	const host: RuntimeHost = { fetch, toast: vi.fn(), confirm: async () => true };
	const session = createSession( { root, config, windowId: app.id, host, client: app } );
	session.paintEagerly();
	return { root, fetch, session };
}

describe( 'calculator native app', () => {
	it( 'uses keypad clicks and the live readout without arithmetic requests', async () => {
		const { root, fetch, session } = mount();
		await session.dispatch( 'mount' );
		const press = ( key: string ) => root.querySelector< HTMLElement >( `os-button[os-arg-key="${ key }"]` )!.click();
		press( '7' ); press( '+' ); press( '8' ); press( '=' );
		expect( root.querySelector( 'os-display' )?.getAttribute( 'value' ) ).toBe( '15' );
		expect( root.querySelector( 'os-display' )?.getAttribute( 'aria-live' ) ).toBe( 'polite' );
		expect( root.querySelectorAll( 'os-button[fill-cell]' ) ).toHaveLength( 20 );
		expect( fetch ).toHaveBeenCalledTimes( 1 );
		press( '/' ); press( '0' ); press( '=' );
		expect( root.querySelector( 'os-display' )?.getAttribute( 'value' ) ).toBe( 'Error' );
		press( 'clear' );
		expect( root.querySelector( 'os-display' )?.getAttribute( 'value' ) ).toBe( '0' );
		session.dispose();
	} );

	it( 'scopes keyboard input to its root, respects shortcuts, and removes listeners on close', async () => {
		const { root, session } = mount();
		await session.dispatch( 'mount' );
		const keyboard = ( target: HTMLElement, key: string, options = {} ) => target.dispatchEvent(
			new KeyboardEvent( 'keydown', { key, bubbles: true, cancelable: true, ...options } ),
		);
		keyboard( document.body, '9' );
		keyboard( root, '9', { ctrlKey: true } );
		expect( session.state.display ).toBe( '0' );
		keyboard( root, '6' ); keyboard( root, '*' ); keyboard( root, '7' ); keyboard( root, 'Enter' );
		expect( session.state.display ).toBe( '42' );
		const button = root.querySelector< HTMLElement >( 'os-button[os-arg-key="1"]' )!;
		keyboard( button, 'Enter' );
		expect( session.state.display ).toBe( '42' );
		keyboard( root, 'Escape' );
		expect( session.state.display ).toBe( '0' );
		session.dispose();
		keyboard( root, '8' );
		expect( session.state.display ).toBe( '0' );
	} );

	it( 'keeps early input when the mount response arrives', async () => {
		const { session } = mount();
		const mounting = session.dispatch( 'mount' );
		session.local( 'press', { key: '7' } );
		await mounting;
		expect( session.state.display ).toBe( '7' );
		session.dispose();
	} );
} );
