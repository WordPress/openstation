/**
 * Tests for the arrow-key virtual-desktop shortcuts:
 *
 *   ArrowLeft/Right → previous / next desktop (no wrap)
 *   ArrowUp         → toggle Overview
 *   ArrowDown       → toggle Show Desktop
 *
 * The action helpers are exercised directly; the keydown installer
 * gate is covered separately via a small integration block at the
 * bottom so we don't double up on `installDesktopArrowShortcuts`
 * idempotency.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import {
	exitOverviewIfActive,
	exitShowDesktopIfActive,
	switchToAdjacentDesktop,
	toggleOverview,
	toggleShowDesktop,
} from '../../src/window-manager/desktop-shortcuts';
import {
	clearHooksStub,
	installHooksStub,
	type FakeWpHooks,
} from './helpers/hooks-stub';

function openConfig( id: string ) {
	return {
		id,
		url: `http://example.test/wp-admin/${ id }.php`,
		title: id,
		icon: 'dashicons-admin-generic',
	};
}

describe( 'WindowManager — arrow-key desktop shortcuts', async () => {
	let hooks: FakeWpHooks;
	let desktopArea: HTMLElement;
	let manager: WindowManager;

	beforeEach( async () => {
		hooks = installHooksStub();
		void hooks;
		desktopArea = document.createElement( 'div' );
		Object.defineProperty( desktopArea, 'getBoundingClientRect', {
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
		Object.defineProperty( desktopArea, 'clientWidth', {
			value: 1600,
			configurable: true,
		} );
		Object.defineProperty( desktopArea, 'clientHeight', {
			value: 900,
			configurable: true,
		} );
		document.body.appendChild( desktopArea );
		manager = new WindowManager( desktopArea );
	} );

	afterEach( async () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktopArea.remove();
		clearHooksStub();
	} );

	describe( 'switchToAdjacentDesktop', async () => {
		test( 'no-op with a single desktop', async () => {
			expect( switchToAdjacentDesktop( manager, 'next' ) ).toBe( false );
			expect( switchToAdjacentDesktop( manager, 'prev' ) ).toBe( false );
			expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
		} );

		test( 'next moves to the desktop immediately to the right', async () => {
			const second = manager.createDesktop();
			expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );

			expect( switchToAdjacentDesktop( manager, 'next' ) ).toBe( true );
			expect( manager.getActiveDesktopId() ).toBe( second.id );
		} );

		test( 'prev moves to the desktop immediately to the left', async () => {
			const second = manager.createDesktop();
			manager.switchDesktop( second.id );

			expect( switchToAdjacentDesktop( manager, 'prev' ) ).toBe( true );
			expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
		} );

		test( 'wraps from the rightmost desktop back to the first', async () => {
			const second = manager.createDesktop();
			manager.switchDesktop( second.id );

			expect( switchToAdjacentDesktop( manager, 'next' ) ).toBe( true );
			expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
		} );

		test( 'wraps from the leftmost desktop back to the last', async () => {
			const second = manager.createDesktop();
			expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );

			expect( switchToAdjacentDesktop( manager, 'prev' ) ).toBe( true );
			expect( manager.getActiveDesktopId() ).toBe( second.id );
		} );

		test( 'next arrow press tags the desktop area with the right-to-left slide class', async () => {
			manager.createDesktop();

			switchToAdjacentDesktop( manager, 'next' );

			expect(
				desktopArea.classList.contains(
					'desktop-mode-area--sliding-from-right',
				),
			).toBe( true );
			expect(
				desktopArea.classList.contains(
					'desktop-mode-area--sliding-from-left',
				),
			).toBe( false );
		} );

		test( 'prev arrow press tags the desktop area with the left-to-right slide class', async () => {
			const second = manager.createDesktop();
			manager.switchDesktop( second.id );

			switchToAdjacentDesktop( manager, 'prev' );

			expect(
				desktopArea.classList.contains(
					'desktop-mode-area--sliding-from-left',
				),
			).toBe( true );
			expect(
				desktopArea.classList.contains(
					'desktop-mode-area--sliding-from-right',
				),
			).toBe( false );
		} );

		test( 'wrap-around forward press still uses the rightward slide direction', async () => {
			// User perceives "I pressed right again" — the visual cue
			// should match that, even though the index loops back to 0.
			const second = manager.createDesktop();
			manager.switchDesktop( second.id );

			switchToAdjacentDesktop( manager, 'next' );
			expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
			expect(
				desktopArea.classList.contains(
					'desktop-mode-area--sliding-from-right',
				),
			).toBe( true );
		} );

		test( 'mid-overview switch does not apply the slide class to the desktop area', async () => {
			manager.createDesktop();
			manager.enterOverview();

			switchToAdjacentDesktop( manager, 'next' );

			expect(
				desktopArea.classList.contains(
					'desktop-mode-area--sliding-from-right',
				),
			).toBe( false );
			expect(
				desktopArea.classList.contains(
					'desktop-mode-area--sliding-from-left',
				),
			).toBe( false );
		} );

		test( 'cycles through three desktops in order with successive next presses', async () => {
			const second = manager.createDesktop();
			const third = manager.createDesktop();
			expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );

			switchToAdjacentDesktop( manager, 'next' );
			expect( manager.getActiveDesktopId() ).toBe( second.id );
			switchToAdjacentDesktop( manager, 'next' );
			expect( manager.getActiveDesktopId() ).toBe( third.id );
			switchToAdjacentDesktop( manager, 'next' );
			expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
		} );
	} );

	describe( 'toggleOverview', async () => {
		test( 'enters overview when inactive', async () => {
			await manager.open( openConfig( 'a' ) );
			expect( manager._overviewActive ).toBe( false );

			expect( toggleOverview( manager ) ).toBe( true );
			expect( manager._overviewActive ).toBe( true );
		} );

		test( 'exits overview when active', async () => {
			await manager.open( openConfig( 'a' ) );
			manager.enterOverview();
			expect( manager._overviewActive ).toBe( true );

			expect( toggleOverview( manager ) ).toBe( true );
			expect( manager._overviewActive ).toBe( false );
		} );
	} );

	describe( 'toggleShowDesktop', async () => {
		test( 'minimizes every open window on the first call', async () => {
			const a = await manager.open( openConfig( 'a' ) );
			const b = await manager.open( openConfig( 'b' ) );
			expect( a.state ).not.toBe( 'minimized' );
			expect( b.state ).not.toBe( 'minimized' );

			expect( toggleShowDesktop( manager ) ).toBe( true );
			expect( a.state ).toBe( 'minimized' );
			expect( b.state ).toBe( 'minimized' );
		} );

		test( 'restores every minimized window on the second call', async () => {
			const a = await manager.open( openConfig( 'a' ) );
			const b = await manager.open( openConfig( 'b' ) );
			toggleShowDesktop( manager );

			expect( toggleShowDesktop( manager ) ).toBe( true );
			expect( a.state ).toBe( 'normal' );
			expect( b.state ).toBe( 'normal' );
		} );

		test( 'returns false when there are no windows to act on', async () => {
			expect( toggleShowDesktop( manager ) ).toBe( false );
		} );

		test( 'returns false (and is a no-op) while overview is active', async () => {
			const a = await manager.open( openConfig( 'a' ) );
			manager.enterOverview();
			expect( manager._overviewActive ).toBe( true );

			expect( toggleShowDesktop( manager ) ).toBe( false );
			expect( a.state ).not.toBe( 'minimized' );
		} );
	} );

	describe( 'exitShowDesktopIfActive', async () => {
		test( 'restores every window when all are minimized', async () => {
			const a = await manager.open( openConfig( 'a' ) );
			const b = await manager.open( openConfig( 'b' ) );
			a.minimize();
			b.minimize();
			expect( a.state ).toBe( 'minimized' );
			expect( b.state ).toBe( 'minimized' );

			expect( exitShowDesktopIfActive( manager ) ).toBe( true );

			expect( a.state ).toBe( 'normal' );
			expect( b.state ).toBe( 'normal' );
		} );

		test( 'no-op when at least one window is not minimized', async () => {
			const a = await manager.open( openConfig( 'a' ) );
			const b = await manager.open( openConfig( 'b' ) );
			a.minimize();
			// `b` stays in 'normal' — not a Show Desktop state.

			expect( exitShowDesktopIfActive( manager ) ).toBe( false );
			expect( a.state ).toBe( 'minimized' );
			expect( b.state ).not.toBe( 'minimized' );
		} );

		test( 'no-op when no windows exist', async () => {
			expect( exitShowDesktopIfActive( manager ) ).toBe( false );
		} );
	} );

	describe( 'exitOverviewIfActive', async () => {
		test( 'exits overview when it is active', async () => {
			await manager.open( openConfig( 'a' ) );
			manager.enterOverview();
			expect( manager._overviewActive ).toBe( true );

			expect( exitOverviewIfActive( manager ) ).toBe( true );
			expect( manager._overviewActive ).toBe( false );
		} );

		test( 'returns false when overview is not active', async () => {
			expect( exitOverviewIfActive( manager ) ).toBe( false );
		} );
	} );

	describe( 'mid-overview desktop switching', async () => {
		test( 'arrow-switching desktops mid-overview re-lays out the grid for the new active desktop', async () => {
			const a = await manager.open( openConfig( 'a' ) );
			const second = manager.createDesktop();
			manager.switchDesktop( second.id );
			const b = await manager.open( openConfig( 'b' ) );
			manager.switchDesktop( 'desktop-1' );

			manager.enterOverview();
			expect(
				a.element.classList.contains( 'desktop-mode-window--overview' ),
			).toBe( true );
			expect( b.element.style.display ).toBe( 'none' );

			expect( switchToAdjacentDesktop( manager, 'next' ) ).toBe( true );
			expect( manager.getActiveDesktopId() ).toBe( second.id );

			// New active desktop's window has the overview class; the
			// previous one has been cleared and hidden.
			expect(
				b.element.classList.contains( 'desktop-mode-window--overview' ),
			).toBe( true );
			expect( a.element.style.display ).toBe( 'none' );
			expect(
				a.element.classList.contains( 'desktop-mode-window--overview' ),
			).toBe( false );
		} );

		test( 'mid-overview switch refreshes the top-bar active-tile highlight', async () => {
			manager.createDesktop();
			manager.enterOverview();

			const bar = manager._overviewTopBar!;
			expect( bar ).not.toBeNull();
			const activeBefore = bar.querySelector< HTMLElement >(
				'.desktop-mode-overview-top-bar__tile--active',
			);
			expect( activeBefore?.dataset.desktopId ).toBe( 'desktop-1' );

			switchToAdjacentDesktop( manager, 'next' );

			// Bar was re-rendered in place — fetch the new node.
			const refreshed = manager._overviewTopBar!;
			const activeAfter = refreshed.querySelector< HTMLElement >(
				'.desktop-mode-overview-top-bar__tile--active',
			);
			expect( activeAfter?.dataset.desktopId ).toBe( 'desktop-2' );
		} );
	} );
} );
