/**
 * Painting plugin-registered rows into a window's ⋯ menu.
 *
 * The registry decides *what* exists; this is the pass that turns that
 * into DOM. Two things matter here that the registry tests cannot see:
 * the rows are direct children of the `role="menu"` panel (an
 * intermediate element would break the ARIA relationship), and the pass
 * is a full rebuild — which is what lets a row's label change with the
 * state it describes.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	closeActionsMenu,
	openActionsMenu,
	paintWindowActions,
} from '../../src/window/menus';
import { HOOKS, addAction } from '../../src/hooks';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import {
	listWindowActions,
	registerWindowAction,
	unregisterWindowAction,
} from '../../src/window-actions/registry';
import type { Window as DesktopWindow } from '../../src/window';

/**
 * Build the minimum DOM the paint pass and its click handler touch: a
 * window element holding the ⋯ button and its panel.
 */
function harness() {
	const element = document.createElement( 'div' );
	const btn = document.createElement( 'button' );
	btn.className = 'os-window__menu-btn';
	const panel = document.createElement( 'div' );
	panel.className = 'os-window__menu-panel';
	panel.setAttribute( 'role', 'menu' );

	// A built-in row, so the test can prove plugin rows land after it
	// and that a repaint does not disturb it.
	const builtIn = document.createElement( 'os-menu-item' );
	builtIn.className = 'os-window__menu-item os-window__menu-item--reload';
	builtIn.textContent = 'Reload';
	panel.appendChild( builtIn );

	element.append( btn, panel );
	document.body.appendChild( element );

	const win = {
		id: 'edit-php',
		config: { native: false },
		element,
	} as unknown as DesktopWindow;

	return { win, panel, builtIn };
}

/** @return The plugin-registered rows currently in the panel. */
function rows( panel: HTMLElement ): HTMLElement[] {
	return Array.from(
		panel.querySelectorAll< HTMLElement >( '.os-window__menu-item--action' ),
	);
}

afterEach( () => {
	for ( const entry of listWindowActions() ) {
		unregisterWindowAction( entry.id );
	}
	document.body.innerHTML = '';
} );

describe( 'paintWindowActions', () => {
	test( 'paints nothing when no plugin registered anything', () => {
		const { win, panel } = harness();
		paintWindowActions( win, panel );
		expect( rows( panel ) ).toHaveLength( 0 );
	} );

	test( 'appends a row after the built-in items', () => {
		const { win, panel, builtIn } = harness();
		registerWindowAction( {
			id: 'my/act',
			label: 'Do it',
			icon: 'dashicons-desktop',
			onSelect: () => {},
		} );

		paintWindowActions( win, panel );

		const painted = rows( panel );
		expect( painted ).toHaveLength( 1 );
		expect( painted[ 0 ].textContent ).toBe( 'Do it' );
		expect( painted[ 0 ].getAttribute( 'icon' ) ).toBe( 'dashicons-desktop' );
		expect( painted[ 0 ].getAttribute( 'value' ) ).toBe( 'my/act' );
		expect( painted[ 0 ].getAttribute( 'data-action-id' ) ).toBe( 'my/act' );
		// Built-ins keep their place.
		expect( panel.firstElementChild ).toBe( builtIn );
	} );

	test( 'rows are direct children of the role="menu" panel', () => {
		// An intermediate element between role="menu" and role="menuitem"
		// breaks the relationship for assistive technology.
		const { win, panel } = harness();
		registerWindowAction( { id: 'my/act', label: 'Do it', onSelect: () => {} } );

		paintWindowActions( win, panel );

		expect( rows( panel )[ 0 ].parentElement ).toBe( panel );
		expect( rows( panel )[ 0 ].getAttribute( 'role' ) ).toBe( 'menuitem' );
	} );

	test( 'skips a row whose predicate says no', () => {
		const { win, panel } = harness();
		registerWindowAction( {
			id: 'my/native-only',
			label: 'Native only',
			isVisible: ( w ) => !! w.config.native,
			onSelect: () => {},
		} );

		paintWindowActions( win, panel );

		expect( rows( panel ) ).toHaveLength( 0 );
	} );

	test( 'skips a row that resolves to an empty label', () => {
		const { win, panel } = harness();
		registerWindowAction( {
			id: 'my/silent',
			label: () => '',
			onSelect: () => {},
		} );

		paintWindowActions( win, panel );

		expect( rows( panel ) ).toHaveLength( 0 );
	} );

	test( 'repaints from scratch so a label can follow its state', () => {
		// This is why the pass is a rebuild rather than a sync: one row
		// expressing a toggle has to re-read its label every open.
		const { win, panel } = harness();
		let freed = false;
		registerWindowAction( {
			id: 'my/toggle',
			label: () => ( freed ? 'Bring it back' : 'Send it away' ),
			onSelect: () => {},
		} );

		paintWindowActions( win, panel );
		expect( rows( panel )[ 0 ].textContent ).toBe( 'Send it away' );

		freed = true;
		paintWindowActions( win, panel );

		expect( rows( panel ) ).toHaveLength( 1 );
		expect( rows( panel )[ 0 ].textContent ).toBe( 'Bring it back' );
	} );

	test( 'a second paint does not duplicate rows', () => {
		const { win, panel } = harness();
		registerWindowAction( { id: 'my/act', label: 'Do it', onSelect: () => {} } );

		paintWindowActions( win, panel );
		paintWindowActions( win, panel );

		expect( rows( panel ) ).toHaveLength( 1 );
	} );

	test( 'orders rows by `order`', () => {
		const { win, panel } = harness();
		registerWindowAction( { id: 'my/late', label: 'Late', order: 200, onSelect: () => {} } );
		registerWindowAction( { id: 'my/early', label: 'Early', order: 10, onSelect: () => {} } );

		paintWindowActions( win, panel );

		expect( rows( panel ).map( ( r ) => r.textContent ) ).toEqual( [
			'Early',
			'Late',
		] );
	} );

	test( 'clicking a row calls its handler with the window', () => {
		const { win, panel } = harness();
		const onSelect = vi.fn();
		registerWindowAction( { id: 'my/act', label: 'Do it', onSelect } );

		paintWindowActions( win, panel );
		rows( panel )[ 0 ].dispatchEvent(
			new CustomEvent( 'os-menu-item-click', { bubbles: true } ),
		);

		expect( onSelect ).toHaveBeenCalledWith( win );
	} );

	test( 'a throwing handler does not escape into the menu', () => {
		// The ⋯ menu is shared surface — one plugin's bug must not cost
		// the user their "Reload".
		const { win, panel } = harness();
		registerWindowAction( {
			id: 'my/bad',
			label: 'Boom',
			onSelect: () => {
				throw new Error( 'boom' );
			},
		} );
		const spy = vi.spyOn( console, 'error' ).mockImplementation( () => {} );

		paintWindowActions( win, panel );
		expect( () =>
			rows( panel )[ 0 ].dispatchEvent(
				new CustomEvent( 'os-menu-item-click', { bubbles: true } ),
			),
		).not.toThrow();

		expect( spy ).toHaveBeenCalled();
		spy.mockRestore();
	} );

	test( 'a row unregistered between opens disappears', () => {
		const { win, panel } = harness();
		registerWindowAction( { id: 'my/act', label: 'Do it', onSelect: () => {} } );
		paintWindowActions( win, panel );
		expect( rows( panel ) ).toHaveLength( 1 );

		unregisterWindowAction( 'my/act' );
		paintWindowActions( win, panel );

		expect( rows( panel ) ).toHaveLength( 0 );
	} );
} );

describe( 'an open menu', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => clearHooksStub() );

	test( 'announces itself so a plugin can look something up', () => {
		const { win, panel } = harness();
		const seen: Array< { windowId?: string } > = [];
		addAction( HOOKS.WINDOW_MENU_OPENED, 'test/probe', ( p ) => seen.push( p ) );

		openActionsMenu( win );

		expect( seen ).toHaveLength( 1 );
		expect( seen[ 0 ].windowId ).toBe( 'edit-php' );
		closeActionsMenu( win );
		void panel;
	} );

	test( 'picks up a row registered while it is open', () => {
		// This is what lets an async probe — "has the desktop app
		// started since this page loaded?" — put its row under the
		// user's pointer instead of on the next open.
		const { win, panel } = harness();

		openActionsMenu( win );
		expect( rows( panel ) ).toHaveLength( 0 );

		registerWindowAction( {
			id: 'my/late',
			label: 'Arrived late',
			onSelect: () => {},
		} );

		expect( rows( panel ).map( ( r ) => r.textContent ) ).toEqual( [
			'Arrived late',
		] );
		closeActionsMenu( win );
	} );

	test( 'a row registered from the open hook lands immediately', () => {
		const { win, panel } = harness();
		addAction( HOOKS.WINDOW_MENU_OPENED, 'test/register', () => {
			registerWindowAction( {
				id: 'my/on-open',
				label: 'Send to your Mac',
				onSelect: () => {},
			} );
		} );

		openActionsMenu( win );

		expect( rows( panel ).map( ( r ) => r.textContent ) ).toEqual( [
			'Send to your Mac',
		] );
		closeActionsMenu( win );
	} );

	test( 'stops repainting once closed', () => {
		// A menu nobody is looking at must not keep doing work on every
		// registry change for the rest of the session.
		const { win, panel } = harness();
		openActionsMenu( win );
		closeActionsMenu( win );

		registerWindowAction( {
			id: 'my/after-close',
			label: 'Too late',
			onSelect: () => {},
		} );

		expect( rows( panel ) ).toHaveLength( 0 );
	} );
} );
