import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession, type Session } from '../../src/app-runtime/session';
import type { AppConfig } from '../../src/app-runtime/types';
import '../../src/ui/components/os-button/os-button';
import '../../src/ui/components/os-grid/os-grid';
import '../../src/ui/components/os-display/os-display';
import app from './calculator.os';
import { initialState, press, keyFromEvent } from './parts/calculation';

function enter( keys: string[] ) {
	return keys.reduce( press, initialState() );
}

describe( 'basic calculations', () => {
	it.each( [
		[ [ '8', '+', '2', '=' ], '10' ],
		[ [ '8', '-', '2', '=' ], '6' ],
		[ [ '8', '*', '2', '=' ], '16' ],
		[ [ '8', '/', '2', '=' ], '4' ],
		[ [ '0', '.', '1', '+', '0', '.', '2', '=' ], '0.3' ],
		[ [ '2', '+', '3', '*', '4', '=' ], '20' ],
		[ [ '8', '+', '*', '2', '=' ], '16' ],
		[ [ '2', '+', '3', '=', '=' ], '8' ],
		[ [ '4', '+', '=' ], '8' ],
		[ [ '1', '2', 'backspace', '.', '.', '5' ], '1.5' ],
		[ [ '5', 'sign', '+', '2', '=' ], '-3' ],
		[ [ '5', '*', 'sign', '2', '=' ], '-10' ],
		[ [ '5', '0', '%' ], '0.5' ],
		[ [ '2', '0', '0', '+', '1', '0', '%', '=' ], '220' ],
		[ [ '2', '0', '0', '-', '1', '0', '%', '=' ], '180' ],
		[ [ '2', '0', '0', '*', '1', '0', '%', '=' ], '20' ],
	] )( 'evaluates %j as %s', ( keys, expected ) => {
		expect( enter( keys as string[] ).display ).toBe( expected );
	} );

	it( 'starts a new calculation after equals and clears repeat operands', () => {
		expect( enter( [ '2', '+', '3', '=', '7', '=' ] ).display ).toBe( '7' );
		expect( enter( [ '2', '+', '3', '=', '+', '4', '=' ] ).display ).toBe( '9' );
		expect( enter( [ '2', '+', '3', 'clear' ] ) ).toEqual( initialState() );
	} );

	it( 'handles division by zero and recovers on the next numeric input', () => {
		const failed = enter( [ '8', '/', '0', '=' ] );
		expect( failed.error ).toBe( true );
		expect( press( failed, '+' ) ).toEqual( failed );
		expect( press( failed, '7' ) ).toMatchObject( { display: '7', error: false } );
		expect( press( failed, '.' ) ).toMatchObject( { display: '0.', error: false } );
		expect( press( failed, 'clear' ) ).toEqual( initialState() );
	} );

	it( 'limits entry length, ignores unknown keys and keeps previous state immutable', () => {
		const original = initialState();
		press( original, '5' );
		expect( original ).toEqual( initialState() );
		expect( enter( '1234567890123'.split( '' ) ).display ).toBe( '123456789012' );
		expect( press( original, 'sqrt' ) ).toEqual( original );
		expect( enter( [ '0', '0', 'backspace' ] ).display ).toBe( '0' );
	} );

	it( 'leaves shortcuts and composition to the operating system', () => {
		expect( keyFromEvent( new KeyboardEvent( 'keydown', { key: 'Enter' } ) ) ).toBe( '=' );
		expect( keyFromEvent( new KeyboardEvent( 'keydown', { key: 'c', ctrlKey: true } ) ) ).toBeNull();
		expect( keyFromEvent( new KeyboardEvent( 'keydown', { key: '1', metaKey: true } ) ) ).toBeNull();
		expect( keyFromEvent( new KeyboardEvent( 'keydown', { key: '1', altKey: true } ) ) ).toBeNull();
		expect( keyFromEvent( new KeyboardEvent( 'keydown', { key: '1', isComposing: true } ) ) ).toBeNull();
		expect( keyFromEvent( new KeyboardEvent( 'keydown', { key: 'Escape' } ) ) ).toBeNull();
	} );

	it( 'keeps tiny computed values valid when beginning another entry', () => {
		const tiny = enter( [ '.', '0', '0', '0', '0', '0', '0', '0', '1', '%' ] );
		expect( tiny.display ).toBe( '1e-10' );
		expect( press( tiny, 'backspace' ).display ).toBe( '1e-10' );
		expect( press( tiny, '.' ).display ).toBe( '0.' );
		expect( press( tiny, '4' ).display ).toBe( '4' );
	} );
} );

const sessions: Session[] = [];

function mount() {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const config: AppConfig = {
		osApp: true,
		id: app.id,
		title: 'Calculator',
		endpoint: '/dispatch',
		state: initialState(),
		data: [],
		titleBarButtons: [],
		windowActions: [],
		appearance: {},
		extra: {},
		client: true,
	};
	const fetch = vi.fn();
	const session = createSession( { root, config, windowId: app.id, host: { fetch }, client: app } );
	sessions.push( session );
	expect( session.paintEagerly() ).toBe( true );
	return { root, session, fetch };
}

afterEach( () => {
	sessions.splice( 0 ).forEach( ( session ) => session.dispose() );
	document.body.replaceChildren();
} );

describe( 'native app interaction', () => {
	it( 'calculates from actual component clicks without an HTTP request', async () => {
		const { root, session, fetch } = mount();
		await Promise.resolve();
		for ( const key of [ '7', '*', '6', '=' ] ) {
			const button = root.querySelector( `[os-arg-key="${ key }"]` )!;
			( button.shadowRoot!.querySelector( 'button' ) as HTMLButtonElement ).click();
			await Promise.resolve();
		}
		expect( session.state.display ).toBe( '42' );
		expect( root.querySelector( 'os-display' )!.getAttribute( 'value' ) ).toBe( '42' );
		expect( root.querySelector( '.os-calculator__expression' )!.textContent ).toBe( '7 × 6 =' );
		expect( fetch ).not.toHaveBeenCalled();
	} );

	it( 'scopes keyboard input to the calculator and removes its listener on close', () => {
		const first = mount();
		const second = mount();
		const surface = first.root.querySelector< HTMLElement >( '.os-calculator' )!;
		surface.focus();
		expect( surface.ownerDocument.activeElement ).toBe( surface );
		for ( const key of [ '9', '-', '4', 'Enter' ] ) {
			surface.dispatchEvent( new KeyboardEvent( 'keydown', { key, bubbles: true, cancelable: true } ) );
		}
		expect( first.session.state.display ).toBe( '5' );
		expect( second.session.state.display ).toBe( '0' );
		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: '7', bubbles: true } ) );
		expect( first.session.state.display ).toBe( '5' );
		first.session.dispose();
		const event = new KeyboardEvent( 'keydown', { key: '8', bubbles: true, cancelable: true } );
		surface.dispatchEvent( event );
		expect( event.defaultPrevented ).toBe( false );
	} );

	it( 'lets Enter activate a focused keypad button through its native click behavior', async () => {
		const { root, session } = mount();
		await Promise.resolve();
		const host = root.querySelector( '[os-arg-key="7"]' )!;
		const button = host.shadowRoot!.querySelector< HTMLButtonElement >( 'button' )!;
		const event = new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true } );
		button.dispatchEvent( event );
		expect( event.defaultPrevented ).toBe( false );
		button.click();
		expect( session.state.display ).toBe( '7' );
	} );

	it( 'shows an error and resets with the clear button', () => {
		const { root, session } = mount();
		for ( const key of [ '1', '/', '0', '=' ] ) {
			session.local( 'press', { key } );
		}
		expect( root.querySelector( 'os-display' )!.getAttribute( 'value' ) ).toBe( 'Error' );
		( root.querySelector( '[aria-label="All clear"]' ) as HTMLElement ).click();
		expect( session.state ).toEqual( initialState() );
	} );
} );
