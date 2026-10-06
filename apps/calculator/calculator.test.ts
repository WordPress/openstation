import { afterEach, describe, expect, it, vi } from 'vitest';
import calculator from './calculator.os';
import { initialState, keyboardKey, pressKey } from './parts/engine';
import { createSession } from '../../src/app-runtime/session';
import type { AppConfig } from '../../src/app-runtime/types';
import '../../src/ui/components/os-button/os-button';

const run = ( ...keys: string[] ) => keys.reduce( pressKey, initialState() );

afterEach( () => {
	document.body.innerHTML = '';
} );

describe( 'calculator arithmetic', () => {
	it.each( [
		[ [ '8', '+', '2', '=' ], '10' ],
		[ [ '8', '-', '2', '=' ], '6' ],
		[ [ '8', '*', '2', '=' ], '16' ],
		[ [ '8', '/', '2', '=' ], '4' ],
	] )( 'calculates %j', ( keys, display ) => {
		expect( run( ...keys ).display ).toBe( display );
	} );

	it( 'chains operations immediately and replaces an unused operator', () => {
		expect( run( '2', '+', '3', '*', '4', '=' ).display ).toBe( '20' );
		expect( run( '9', '+', '-', '2', '=' ).display ).toBe( '7' );
	} );

	it( 'rounds binary decimal noise and rejects duplicate decimal points', () => {
		expect( run( '.', '1', '+', '.', '2', '=' ).display ).toBe( '0.3' );
		expect( run( '1', '.', '.', '2' ).display ).toBe( '1.2' );
	} );

	it( 'repeats equals and starts a new calculation on a digit', () => {
		expect( run( '5', '+', '2', '=', '=' ).display ).toBe( '9' );
		expect( run( '5', '+', '2', '=', '3', '=' ).display ).toBe( '3' );
		expect( run( '5', '+', '=' ).display ).toBe( '10' );
	} );

	it( 'uses relative percentages for addition and subtraction', () => {
		expect( run( '2', '0', '0', '+', '1', '0', '%', '=' ).display ).toBe( '220' );
		expect( run( '2', '0', '0', '-', '1', '0', '%', '=' ).display ).toBe( '180' );
		expect( run( '2', '0', '0', '*', '1', '0', '%', '=' ).display ).toBe( '20' );
		expect( run( '5', '0', '%' ).display ).toBe( '0.5' );
		expect( run( '5', '0', '%', '2' ).display ).toBe( '2' );
	} );

	it( 'changes sign without losing a typed decimal and edits a negative number', () => {
		expect( run( '1', '.', 'sign', '2' ).display ).toBe( '-1.2' );
		expect( run( '2', '+', '3', 'sign', '=' ).display ).toBe( '-1' );
		expect( run( '1', 'sign', 'backspace' ).display ).toBe( '0' );
		expect( run( '1', '2', 'backspace' ).display ).toBe( '1' );
		expect( run( '2', '*', '4', '=', 'sign', '3' ).display ).toBe( '3' );
	} );

	it( 'recovers from division by zero with a digit or clear', () => {
		expect( run( '8', '/', '0', '=' ).error ).toBe( true );
		expect( run( '8', '/', '0', '=', '2', '+', '3', '=' ).display ).toBe( '5' );
		expect( run( '8', '/', '0', '=', 'clear' ) ).toEqual( initialState() );
	} );

	it( 'limits digit entry and leaves the previous state untouched', () => {
		const state = initialState();
		expect( pressKey( state, '7' ).display ).toBe( '7' );
		expect( state.display ).toBe( '0' );
		expect( run( ...'1234567890123' ).display ).toBe( '123456789012' );
		expect( run( ...'999999999999', '*', ...'999999999999', '=', 'sign', 'backspace', '2' ).display ).toBe( '2' );
	} );
} );

describe( 'calculator input', () => {
	it( 'maps keyboard aliases and ignores unrelated keys', () => {
		expect( keyboardKey( ',' ) ).toBe( '.' );
		expect( keyboardKey( 'Enter' ) ).toBe( '=' );
		expect( keyboardKey( 'Escape' ) ).toBe( 'clear' );
		expect( keyboardKey( 'Tab' ) ).toBeNull();
	} );

	it( 'runs buttons and scoped keyboard input through the real app session without requests', async () => {
		const root = document.createElement( 'div' );
		document.body.appendChild( root );
		const fetch = vi.fn();
		const config: AppConfig = {
			osApp: true, id: 'openstation-calculator', title: 'Calculator', endpoint: '/dispatch',
			state: initialState(), data: [], titleBarButtons: [], windowActions: [],
			appearance: {}, extra: {}, actions: [], client: true,
		};
		const session = createSession( { root, config, windowId: config.id, host: { fetch }, client: calculator } );
		expect( session.paintEagerly() ).toBe( true );
		await Promise.resolve();
		root.querySelector< HTMLElement >( '[os-arg-key="7"]' )!.click();
		for ( const key of [ '+', '5', 'Enter' ] ) {
			root.dispatchEvent( new KeyboardEvent( 'keydown', { key, bubbles: true, cancelable: true } ) );
		}
		expect( root.querySelector( 'output' )?.textContent ).toBe( '12' );
		expect( fetch ).not.toHaveBeenCalled();
		document.body.dispatchEvent( new KeyboardEvent( 'keydown', { key: '9', bubbles: true } ) );
		expect( session.state.display ).toBe( '12' );
		root.dispatchEvent( new KeyboardEvent( 'keydown', { key: '9', metaKey: true, bubbles: true } ) );
		expect( session.state.display ).toBe( '12' );
		const button = root.querySelector< HTMLElement >( '[os-arg-key="+"]' )!.shadowRoot!.querySelector( 'button' )!;
		const enter = new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true } );
		button.dispatchEvent( enter );
		expect( enter.defaultPrevented ).toBe( false );
		expect( session.state.display ).toBe( '12' );
		session.dispose();
		root.dispatchEvent( new KeyboardEvent( 'keydown', { key: '2', bubbles: true } ) );
		expect( session.state.display ).toBe( '12' );
	} );
} );
