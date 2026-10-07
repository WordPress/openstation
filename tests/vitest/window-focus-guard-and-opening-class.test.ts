import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

function cfg( id: string ) {
	return {
		id,
		url: `http://example.test/${ id }.php`,
		title: id,
		icon: 'dashicons-admin-generic',
	};
}

function makeDesktop(): HTMLElement {
	const desktop = document.createElement( 'div' );
	desktop.id = 'os-area';
	Object.defineProperty( desktop, 'getBoundingClientRect', {
		value: () =>
			( {
				left: 0,
				top: 0,
				right: 1600,
				bottom: 900,
				width: 1600,
				height: 900,
				x: 0,
				y: 0,
				toJSON: () => ( {} ),
			} ) as DOMRect,
	} );
	Object.defineProperty( desktop, 'clientWidth', {
		value: 1600,
		configurable: true,
	} );
	Object.defineProperty( desktop, 'clientHeight', {
		value: 900,
		configurable: true,
	} );
	return desktop;
}

function animationEvent(
	type: 'animationend' | 'animationcancel',
	animationName: string,
	bubbles = false,
): Event {
	const event = new Event( type, { bubbles } );
	Object.defineProperty( event, 'animationName', {
		value: animationName,
		configurable: true,
	} );
	return event;
}

function setHidden( hidden: boolean ): void {
	Object.defineProperty( document, 'hidden', {
		value: hidden,
		configurable: true,
	} );
}

describe( 'WindowManager.focus() — argument guard', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;
	let warn: ReturnType< typeof vi.spyOn >;

	beforeEach( () => {
		installHooksStub();
		setHidden( false );
		desktop = makeDesktop();
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
		warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
	} );

	afterEach( () => {
		warn.mockRestore();
		for ( const w of manager.getAll() ) {
			w.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	test( 'focuses by window id', async () => {
		const a = await manager.open( cfg( 'a' ) );
		const b = await manager.open( cfg( 'b' ) );
		expect( b.isFocused() ).toBe( true );

		manager.focus( 'a' );

		expect( a.isFocused() ).toBe( true );
		expect( b.isFocused() ).toBe( false );
	} );

	test( 'an unknown id is a silent no-op and leaves focus intact', async () => {
		const a = await manager.open( cfg( 'a' ) );
		const b = await manager.open( cfg( 'b' ) );

		expect( () => manager.focus( 'nope' ) ).not.toThrow();

		expect( b.isFocused() ).toBe( true );
		expect( a.isFocused() ).toBe( false );

		expect( warn ).not.toHaveBeenCalled();
	} );

	test( 'a bad argument does not poison the stack for later focus calls', async () => {
		const a = await manager.open( cfg( 'a' ) );
		const b = await manager.open( cfg( 'b' ) );

		expect( () =>

			manager.focus( { id: 'fake' } as any ),
		).not.toThrow();

		expect( manager.getAll().map( ( w ) => w.id ) ).toEqual( [ 'a', 'b' ] );

		expect( () => manager.focus( a ) ).not.toThrow();
		expect( a.isFocused() ).toBe( true );
		expect( () => manager.focus( b ) ).not.toThrow();
		expect( b.isFocused() ).toBe( true );
		expect( warn ).toHaveBeenCalled();
	} );

	test( 'unknown ids stay no-ops for raise() too', async () => {
		await manager.open( cfg( 'a' ) );
		const b = await manager.open( cfg( 'b' ) );

		expect( () => manager.raise( 'nope' ) ).not.toThrow();

		expect( manager.getAll().map( ( w ) => w.id ) ).toEqual( [ 'a', 'b' ] );
		expect( b.isFocused() ).toBe( true );
	} );
} );

describe( 'Window — the opening class always comes off', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		installHooksStub();
		setHidden( false );
		vi.useFakeTimers();
		desktop = makeDesktop();
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		vi.useRealTimers();
		for ( const w of manager.getAll() ) {
			w.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	test( 'the animation clears it', async () => {
		const win = await manager.open( cfg( 'a' ) );
		expect( win.element.classList.contains( 'os-window--opening' ) ).toBe(
			true,
		);

		win.element.dispatchEvent(
			animationEvent( 'animationend', 'os-window-open' ),
		);

		expect( win.element.classList.contains( 'os-window--opening' ) ).toBe(
			false,
		);
	} );

	test( 'a bubbling animation from the content does not claim the listener', async () => {
		const win = await manager.open( cfg( 'a' ) );
		const body = win.element.querySelector(
			'.os-window__body',
		) as HTMLElement;
		expect( body ).toBeTruthy();

		body.dispatchEvent(
			animationEvent( 'animationend', 'os-spinner-rotate', true ),
		);

		expect( win.element.classList.contains( 'os-window--opening' ) ).toBe(
			true,
		);

		win.element.dispatchEvent(
			animationEvent( 'animationend', 'os-window-open' ),
		);
		expect( win.element.classList.contains( 'os-window--opening' ) ).toBe(
			false,
		);
	} );

	test( 'animationcancel clears it', async () => {
		const win = await manager.open( cfg( 'a' ) );

		win.element.dispatchEvent(
			animationEvent( 'animationcancel', 'os-window-open' ),
		);

		expect( win.element.classList.contains( 'os-window--opening' ) ).toBe(
			false,
		);
	} );

	test( 'the timer clears it when no animation event ever arrives', async () => {
		const win = await manager.open( cfg( 'a' ) );
		expect( win.element.classList.contains( 'os-window--opening' ) ).toBe(
			true,
		);

		vi.advanceTimersByTime( 1000 );

		expect( win.element.classList.contains( 'os-window--opening' ) ).toBe(
			false,
		);
	} );

	test( 'the deadline never reaches for `window` when it is the one firing', async () => {
		await manager.open( cfg( 'a' ) );
		const clearSpy = vi.spyOn( window, 'clearTimeout' );

		vi.advanceTimersByTime( 1000 );

		expect( clearSpy ).not.toHaveBeenCalled();
		clearSpy.mockRestore();
	} );

	test( 'destroying the window cancels the pending deadline', async () => {

		const setSpy = vi.spyOn( window, 'setTimeout' );
		const win = await manager.open( cfg( 'a' ) );
		const deadlineIds = setSpy.mock.results
			.filter( ( _r, i ) => setSpy.mock.calls[ i ][ 1 ] === 300 )
			.map( ( r ) => r.value );
		setSpy.mockRestore();
		expect( deadlineIds ).toHaveLength( 1 );

		const clearSpy = vi.spyOn( window, 'clearTimeout' );
		win.destroy();

		expect( clearSpy ).toHaveBeenCalledWith( deadlineIds[ 0 ] );
		clearSpy.mockRestore();
		expect( () => vi.advanceTimersByTime( 1000 ) ).not.toThrow();
	} );

	test( 'a window opened in a hidden document never gets the class', async () => {
		setHidden( true );

		const win = await manager.open( cfg( 'a' ) );

		expect( win.element.classList.contains( 'os-window--opening' ) ).toBe(
			false,
		);
	} );
} );
