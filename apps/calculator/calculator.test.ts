import { afterEach, describe, expect, test, vi } from 'vitest';
import { createSession, type Session } from '../../src/app-runtime/session';
import app from './calculator.os';
import { initialState, keyboardKey, press } from './parts/arithmetic';

const enter = ( ...keys: string[] ) => keys.reduce( press, initialState() );

let session: Session | undefined;

afterEach( () => {
	session?.dispose();
	session = undefined;
	document.body.innerHTML = '';
} );

describe( 'Calculator arithmetic', () => {
	test.each( [
		[ [ '1', '2', '+', '3', '=' ], '15' ],
		[ [ '9', '-', '2', '=' ], '7' ],
		[ [ '6', '*', '7', '=' ], '42' ],
		[ [ '8', '/', '4', '=' ], '2' ],
		[ [ '0', '.', '1', '+', '0', '.', '2', '=' ], '0.3' ],
	] )( 'calculates %j', ( keys, expected ) => {
		expect( enter( ...keys ).display ).toBe( expected );
	} );

	test( 'chains immediately, replaces a pending operator, and repeats equals', () => {
		expect( enter( '2', '+', '3', '*', '4', '=' ).display ).toBe( '20' );
		expect( enter( '8', '+', '*', '2', '=', '=' ).display ).toBe( '32' );
	} );

	test( 'applies percent relative to the left operand for addition and subtraction', () => {
		expect( enter( '2', '0', '0', '+', '1', '0', 'percent', '=' ).display ).toBe( '220' );
		expect( enter( '2', '0', '0', '-', '1', '0', 'percent', '=' ).display ).toBe( '180' );
		expect( enter( '2', '0', '0', '*', '1', '0', 'percent', '=' ).display ).toBe( '20' );
		expect( enter( '5', '0', 'percent' ).display ).toBe( '0.5' );
	} );

	test( 'enters negative operands and continues from a result', () => {
		expect( enter( '2', '*', 'sign', '3', '=' ).display ).toBe( '-6' );
		expect( enter( '2', '+', '3', '=', '-', '1', '=' ).display ).toBe( '4' );
		expect( enter( '2', '+', '3', '=', '7' ).display ).toBe( '7' );
	} );

	test( 'edits digits without accepting duplicate decimal points or unlimited input', () => {
		expect( enter( '1', '.', '.', '2', 'backspace', '3' ).display ).toBe( '1.3' );
		expect( enter( 'sign', '2', 'backspace' ).display ).toBe( '0' );
		expect( enter( ...'123456789012345'.split( '' ) ).display ).toBe( '123456789012' );
	} );

	test( 'recovers from division by zero with a new entry or clear', () => {
		const error = enter( '8', '/', '0', '=' );
		expect( error.error ).toBe( true );
		expect( press( error, '+' ).error ).toBe( true );
		expect( press( error, '4' ).display ).toBe( '4' );
		expect( press( error, '4' ).error ).toBe( false );
		expect( press( error, 'clear' ) ).toEqual( initialState() );
	} );

	test( 'keeps tiny results valid when editing after a percent', () => {
		const tiny = enter( '0', '.', '0', '0', '0', '0', '0', '1', 'percent' );
		expect( tiny.display ).toBe( '1e-8' );
		expect( press( tiny, 'backspace' ).display ).toBe( '1e-8' );
		expect( press( tiny, '2' ).display ).toBe( '2' );
	} );

	test( 'ignores unrelated keys and system shortcuts', () => {
		expect( press( initialState(), 'sin' ) ).toEqual( initialState() );
		expect( keyboardKey( new KeyboardEvent( 'keydown', { key: 'Enter' } ) ) ).toBe( '=' );
		expect( keyboardKey( new KeyboardEvent( 'keydown', { key: '1', metaKey: true } ) ) ).toBeNull();
		expect( keyboardKey( new KeyboardEvent( 'keydown', { key: 'Tab' } ) ) ).toBeNull();
	} );
} );

test( 'the native keypad and keyboard update locally and dispose their listeners', () => {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const fetch = vi.fn();
	session = createSession( {
		root, windowId: app.id, client: app, host: { fetch },
		config: {
			osApp: true, id: app.id, title: 'Calculator', endpoint: '/dispatch',
			state: initialState(), data: [], client: true, actions: [],
			titleBarButtons: [], windowActions: [], appearance: {}, extra: {},
		},
	} );
	session.paintEagerly();
	const keypad = root.querySelector( '[os-arg-key="7"]' ) as HTMLElement;
	keypad.click();
	const calculator = root.querySelector( '.os-calculator' ) as HTMLElement;
	for ( const key of [ '+', '5', 'Enter' ] ) {
		calculator.dispatchEvent( new KeyboardEvent( 'keydown', { key, bubbles: true, cancelable: true } ) );
	}
	expect( root.querySelector( 'output' )?.textContent ).toBe( '12' );
	expect( fetch ).not.toHaveBeenCalled();
	session.dispose();
	calculator.dispatchEvent( new KeyboardEvent( 'keydown', { key: '9', bubbles: true, cancelable: true } ) );
	expect( root.querySelector( 'output' )?.textContent ).toBe( '12' );
} );
