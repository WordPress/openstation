/**
 * Focus-transfer-on-close tests for {@link WindowManager}.
 *
 * Closing the focused window must hand focus to the next window the
 * user can actually *see* take it — the topmost non-minimized window
 * on the active desktop — not blindly the top of the stack (which
 * spans every virtual desktop and includes minimized windows). With
 * an unfocus effect active, focusing an invisible window would leave
 * every visible window darkened with nothing bright.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

function cfg(
	id: string,
	overrides: Partial< { desktopId: string } > = {},
) {
	return {
		id,
		url: `http://example.test/${ id }.php`,
		title: id,
		icon: 'dashicons-admin-generic',
		desktopId: overrides.desktopId,
	};
}

function makeDesktop(): HTMLElement {
	const desktop = document.createElement( 'div' );
	desktop.id = 'desktop-mode-area';
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

describe( 'WindowManager — focus transfer on close', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		installHooksStub();
		desktop = makeDesktop();
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		for ( const w of manager.getAll() ) {
			w.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	test( 'closing the focused window focuses the remaining one', async () => {
		const a = await manager.open( cfg( 'a' ) );
		const b = await manager.open( cfg( 'b' ) );
		expect( b.isFocused() ).toBe( true );

		b.close();

		expect( manager.getAll().map( ( w ) => w.id ) ).toEqual( [ 'a' ] );
		expect( a.isFocused() ).toBe( true );
	} );

	test( 'with N windows, closing the focused one focuses the next topmost', async () => {
		await manager.open( cfg( 'a' ) );
		const b = await manager.open( cfg( 'b' ) );
		const c = await manager.open( cfg( 'c' ) );
		expect( c.isFocused() ).toBe( true );

		c.close();

		expect( b.isFocused() ).toBe( true );
		expect( manager.getAll().some( ( w ) => w.isFocused() ) ).toBe( true );
	} );

	test( 'skips a minimized sibling and focuses the visible window', async () => {
		const a = await manager.open( cfg( 'a' ) );
		const b = await manager.open( cfg( 'b' ) );
		// Minimize A, then re-focus B so the focused window (B) sits
		// above a minimized window (A) in the stack.
		a.minimize();
		manager.focus( b );
		expect( b.isFocused() ).toBe( true );
		expect( a.state ).toBe( 'minimized' );

		b.close();

		// A is the only remaining window but it's minimized — it must
		// NOT be force-focused (the user can't see it take focus).
		expect( a.isFocused() ).toBe( false );
		expect( a.state ).toBe( 'minimized' );
	} );

	test( 'skips a minimized window in favour of a visible one', async () => {
		const a = await manager.open( cfg( 'a' ) ); // visible
		const b = await manager.open( cfg( 'b' ) ); // will minimize
		const c = await manager.open( cfg( 'c' ) ); // focused
		b.minimize();
		manager.focus( c );
		expect( c.isFocused() ).toBe( true );

		c.close();

		// Topmost FOCUSABLE remaining window is A (B is minimized).
		expect( a.isFocused() ).toBe( true );
		expect( b.isFocused() ).toBe( false );
	} );

	test( 'does not focus a window on another virtual desktop', async () => {
		const onOther = await manager.open( cfg( 'other', { desktopId: 'desktop-2' } ) );
		const onActive = await manager.open( cfg( 'active' ) );
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
		expect( onActive.isFocused() ).toBe( true );

		onActive.close();

		// The only remaining window lives on desktop-2 — invisible from
		// the active desktop, so it must not be focused.
		expect( onOther.isFocused() ).toBe( false );
	} );
} );
