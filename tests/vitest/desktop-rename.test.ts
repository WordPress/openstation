import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Dock, type SystemDockItem } from '../../src/dock';
import { WindowManager } from '../../src/window-manager';
import {
	DESKTOP_LABEL_MAX_LENGTH,
	renameDesktop,
} from '../../src/window-manager/desktops';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

const tokens = readFileSync(
	resolve( __dirname, '../..', 'assets/css/variables.css' ),
	'utf8',
);

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

		const overview: SystemDockItem = {
			id: 'os-overview',
			title: 'Workspaces',
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

	const part = < T extends HTMLElement >( name: string ): T | null =>
		manager._overviewTopBar!.querySelector< T >(
			`.os-overview-top-bar__tile-${ name }`,
		);
	const renameButton = () => part( 'edit' )!;
	const labelEl = () => part( 'label' )!;
	const editing = (): boolean => labelEl().hasAttribute( 'contenteditable' );
	const press = ( key: string ): void => {
		labelEl().dispatchEvent(
			new KeyboardEvent( 'keydown', { key, bubbles: true } ),
		);
	};

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

		expect( manager._overviewActive ).toBe( true );

		renameButton().click();
		labelEl().textContent = 'Discarded';
		press( 'Escape' );

		expect( manager.getDesktops()[ 0 ].label ).toBe( 'Writing' );
		expect( labelEl().textContent ).toBe( 'Writing' );
		expect( manager._overviewActive ).toBe( true );
	} );

	test( 'a click synthesised while editing does not switch desktop', () => {
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		manager.enterOverview();

		const firstTile = (): HTMLElement =>
			manager._overviewTopBar!.querySelector< HTMLElement >(
				'.os-overview-top-bar__tile',
			)!;
		renameButton().click();
		expect( editing() ).toBe( true );

		expect( manager.getActiveDesktopId() ).toBe( second.id );

		firstTile().click();

		expect( manager._overviewActive ).toBe( true );
		expect( manager.getActiveDesktopId() ).toBe( second.id );

		press( 'Escape' );
		firstTile().click();
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
	} );

	test( 'double-clicking the name edits it instead of switching desks', () => {
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		manager.enterOverview();

		const mouse = ( type: string ): void => {
			labelEl().dispatchEvent( new MouseEvent( type, { bubbles: true } ) );
		};
		mouse( 'click' );
		mouse( 'dblclick' );

		expect( editing() ).toBe( true );
		expect( manager._overviewActive ).toBe( true );
		expect( manager.getActiveDesktopId() ).toBe( second.id );

		labelEl().textContent = 'Writing';
		press( 'Enter' );
		expect( manager.getDesktops()[ 0 ].label ).toBe( 'Writing' );
	} );

	test( 'a lone click on the name switches once the pair times out', () => {
		vi.useFakeTimers();
		try {
			const second = manager.createDesktop();
			manager.switchDesktop( second.id );
			manager.enterOverview();

			labelEl().dispatchEvent(
				new MouseEvent( 'click', { bubbles: true } ),
			);
			expect( manager.getActiveDesktopId() ).toBe( second.id );

			vi.advanceTimersByTime( 300 );
			expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
			expect( manager._overviewActive ).toBe( false );
		} finally {
			vi.useRealTimers();
		}
	} );

	test( 'the caption names the desk, but not from overview', () => {
		const second = manager.createDesktop();
		renameDesktop( manager, second.id, 'Writing' );
		const hud = (): HTMLElement | null =>
			desktopArea.querySelector( '.os-desktop-name-hud' );

		manager.switchDesktop( second.id );
		expect( hud()?.textContent ).toBe( 'Writing' );

		const layer = ( name: string ): number =>
			Number( new RegExp( `--${ name }:\\s*(\\d+)` ).exec( tokens )![ 1 ] );
		expect( layer( 'os-z-desktop-name' ) ).toBeGreaterThan(
			layer( 'os-z-base' ),
		);

		expect( layer( 'os-z-desktop-name' ) ).toBeLessThan(
			layer( 'os-z-dock' ),
		);

		hud()!.remove();
		manager.enterOverview();
		manager.switchDesktop( 'desktop-1' );

		expect( hud() ).toBeNull();
	} );

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
