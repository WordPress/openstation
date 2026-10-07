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

		a.minimize();
		manager.focus( b );
		expect( b.isFocused() ).toBe( true );
		expect( a.state ).toBe( 'minimized' );

		b.close();

		expect( a.isFocused() ).toBe( false );
		expect( a.state ).toBe( 'minimized' );
	} );

	test( 'skips a minimized window in favour of a visible one', async () => {
		const a = await manager.open( cfg( 'a' ) );
		const b = await manager.open( cfg( 'b' ) );
		const c = await manager.open( cfg( 'c' ) );
		b.minimize();
		manager.focus( c );
		expect( c.isFocused() ).toBe( true );

		c.close();

		expect( a.isFocused() ).toBe( true );
		expect( b.isFocused() ).toBe( false );
	} );

	test( 'does not focus a window on another virtual desktop', async () => {
		const onOther = await manager.open( cfg( 'other', { desktopId: 'desktop-2' } ) );
		const onActive = await manager.open( cfg( 'active' ) );
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
		expect( onActive.isFocused() ).toBe( true );

		onActive.close();

		expect( onOther.isFocused() ).toBe( false );
	} );
} );
