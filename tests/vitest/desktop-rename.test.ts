/**
 * Overview's desktop tiles: renaming, the caption shown after a
 * switch, and the dock tile's active dot.
 *
 * @group desktops
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Dock, type SystemDockItem } from '../../src/dock';
import { WindowManager } from '../../src/window-manager';
import {
	DESKTOP_LABEL_MAX_LENGTH,
	renameDesktop,
} from '../../src/window-manager/desktops';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

describe( 'virtual desktops — overview tiles', () => {
	let desktopArea: HTMLElement;
	let dockEl: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		installHooksStub();
		desktopArea = document.createElement( 'div' );
		Object.defineProperty( desktopArea, 'getBoundingClientRect', {
			value: () => ( { top: 0, left: 0, width: 1600, height: 900 } ) as DOMRect,
		} );
		document.body.appendChild( desktopArea );
		manager = new WindowManager( desktopArea );

		dockEl = document.createElement( 'nav' );
		document.body.appendChild( dockEl );
		// Mirrors the Overview tile's registration in `desktop.ts`.
		const overview: SystemDockItem = {
			id: 'os-overview',
			title: 'Overview',
			icon: 'dashicons-screenoptions',
			navKind: 'control',
			isOpen: () => manager._overviewActive,
			onOpen: () =>
				manager._overviewActive
					? manager.exitOverview()
					: manager.enterOverview(),
		};
		new Dock( dockEl, manager, [], '/wp-admin/', 'bottom' ).appendSystemItem(
			overview,
		);
	} );

	afterEach( () => {
		manager.destroy();
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	/** First tile's `<part>` in the live top bar. */
	const part = < T extends HTMLElement >( name: string ): T | null =>
		manager._overviewTopBar!.querySelector< T >(
			`.os-overview-top-bar__tile-${ name }`,
		);
	const renameButton = () => part( 'rename' )!;
	const labelEl = () => part( 'label' )!;
	const editing = (): boolean => labelEl().hasAttribute( 'contenteditable' );
	const press = ( key: string ): void => {
		labelEl().dispatchEvent(
			new KeyboardEvent( 'keydown', { key, bubbles: true } ),
		);
	};

	// Capped client-side rather than left to the server: a name that
	// looked accepted and came back shortened on reload reads as data
	// loss. 64 mirrors `includes/session.php`.
	test( 'renameDesktop trims, caps, and rejects blank / unknown', () => {
		expect( renameDesktop( manager, 'desktop-1', '  Writing  ' ) ).toBe( true );
		expect( manager.getDesktops()[ 0 ].label ).toBe( 'Writing' );

		renameDesktop( manager, 'desktop-1', 'x'.repeat( 200 ) );
		expect( manager.getDesktops()[ 0 ].label ).toHaveLength(
			DESKTOP_LABEL_MAX_LENGTH,
		);

		expect( renameDesktop( manager, 'desktop-1', '  ' ) ).toBe( false );
		expect( renameDesktop( manager, 'nope', 'Writing' ) ).toBe( false );
	} );

	test( 'Enter commits, Escape reverts, and neither exits overview', () => {
		manager.enterOverview();

		renameButton().click();
		expect( editing() ).toBe( true );
		labelEl().textContent = 'Writing';
		press( 'Enter' );

		expect( manager.getDesktops()[ 0 ].label ).toBe( 'Writing' );
		expect( labelEl().textContent ).toBe( 'Writing' );
		expect( editing() ).toBe( false );
		// Overview's own document-level handler reads Enter as "commit
		// the cursor" and Escape as "leave overview"; both would tear
		// the surface down mid-edit.
		expect( manager._overviewActive ).toBe( true );

		renameButton().click();
		labelEl().textContent = 'Discarded';
		press( 'Escape' );

		// Rebuilt from data, so an abandoned edit leaves no trace.
		expect( manager.getDesktops()[ 0 ].label ).toBe( 'Writing' );
		expect( labelEl().textContent ).toBe( 'Writing' );
		expect( manager._overviewActive ).toBe( true );
	} );

	// Typing a space into the label activates the tile <button> — the
	// browser synthesises a click on it. That is a default action, not
	// a listener, so it survives every `stopPropagation` upstream and
	// used to switch desktop and close overview mid-rename.
	test( 'a click synthesised while editing does not switch desktop', () => {
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		manager.enterOverview();

		// Edit the FIRST tile's label; the space activates the button
		// that contains it, so the click lands on that same tile.
		const firstTile = (): HTMLElement =>
			manager._overviewTopBar!.querySelector< HTMLElement >(
				'.os-overview-top-bar__tile',
			)!;
		renameButton().click();
		expect( editing() ).toBe( true );
		// The pencil itself must not reach the tile beneath it either.
		expect( manager.getActiveDesktopId() ).toBe( second.id );

		firstTile().click();

		expect( manager._overviewActive ).toBe( true );
		expect( manager.getActiveDesktopId() ).toBe( second.id );

		// Still switches once the edit is over.
		press( 'Escape' );
		firstTile().click();
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
	} );

	test( 'the caption names the desk, but not from overview', () => {
		const second = manager.createDesktop();
		renameDesktop( manager, second.id, 'Writing' );
		const hud = (): HTMLElement | null =>
			desktopArea.querySelector( '.os-desktop-name-hud' );

		manager.switchDesktop( second.id );
		expect( hud()?.textContent ).toBe( 'Writing' );

		hud()!.remove();
		manager.enterOverview();
		manager.switchDesktop( 'desktop-1' );
		// The top bar already labels every desktop there.
		expect( hud() ).toBeNull();
	} );

	// The dock only repaints system-tile predicates when told to, and
	// overview enter / exit never told it — so the dot was dark while
	// overview was open, and latched ON after "+ add desktop", which
	// refreshes the dock from `switchDesktop` one step before the flag
	// drops.
	test( 'the dock tile lights while overview is open, clears on exit', () => {
		const tile = dockEl.querySelector< HTMLElement >(
			'[data-system-id="os-overview"]',
		)!;
		const dot = (): boolean =>
			tile.classList.contains( 'os-dock__item--active' );
		const clickDockTile = (): void =>
			tile.querySelector< HTMLElement >( 'button, a' )!.click();

		clickDockTile();
		expect( dot() ).toBe( true );

		clickDockTile();
		expect( dot() ).toBe( false );

		clickDockTile();
		document
			.querySelector< HTMLElement >( '.os-overview-top-bar__tile--add' )!
			.click();

		expect( manager.getDesktops() ).toHaveLength( 2 );
		expect( manager._overviewActive ).toBe( false );
		expect( dot() ).toBe( false );
	} );
} );
