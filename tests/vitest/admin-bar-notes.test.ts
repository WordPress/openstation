/**
 * The WordPress.com / Jetpack notifications bell, given a dock tile
 * while the admin bar is hidden.
 *
 * The fixture is the markup Jetpack's `Jetpack_Notifications::admin_bar_menu()`
 * prints, plus a stand-in for its script: a click on the bell toggles
 * the panel's inline `display`, and a press outside the node closes it.
 * That outside-press handler is what the tile has to work around,
 * since a press on the tile is a press outside the bell.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	installAdminBarNotes,
	NOTES_TILE_ID,
	type AdminBarNotesController,
} from '../../src/admin-bar-notes';
import type { SystemDockItem } from '../../src/dock';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

const NOTES_MARKUP = `
<div id="wpadminbar"><ul id="wp-admin-bar-top-secondary">
	<li id="wp-admin-bar-notes" class="menupop">
		<a class="ab-item" href="https://wordpress.com/reader/notifications">
			<span id="wpnt-notes-unread-count" class="wpnt-loading wpn-read"></span>
			<span class="noticon noticon-bell ab-icon"></span>
		</a>
		<div id="wpnt-notes-panel2" style="display:none"></div>
	</li>
</ul></div>
<div id="tile"></div>`;

function panel(): HTMLElement {
	return document.getElementById( 'wpnt-notes-panel2' ) as HTMLElement;
}

/** Jetpack's half: the bell toggles, a press elsewhere closes. */
function installJetpackStandIn(): () => void {
	const bell = document.querySelector( '#wp-admin-bar-notes > .ab-item' ) as HTMLElement;
	const onBell = ( e: Event ): void => {
		e.preventDefault();
		panel().style.display = panel().style.display === 'none' ? 'block' : 'none';
	};
	const onOutside = ( e: Event ): void => {
		if ( ! ( e.target as Element ).closest( '#wp-admin-bar-notes' ) ) {
			panel().style.display = 'none';
		}
	};
	bell.addEventListener( 'click', onBell );
	document.addEventListener( 'mousedown', onOutside );
	return () => document.removeEventListener( 'mousedown', onOutside );
}

/** A real press-then-click on the tile, the way a pointer delivers it. */
async function clickTile( item: SystemDockItem ): Promise< void > {
	const tile = document.getElementById( 'tile' ) as HTMLElement;
	tile.dispatchEvent( new Event( 'pointerdown', { bubbles: true } ) );
	tile.dispatchEvent( new MouseEvent( 'mousedown', { bubbles: true } ) );
	item.onOpen( new MouseEvent( 'click', { detail: 1 } ) );
	await vi.runAllTimersAsync();
}

/** Let the MutationObservers deliver. */
const flush = (): Promise< void > => new Promise( ( r ) => queueMicrotask( r ) );

let controller: AdminBarNotesController | null = null;
let teardownJetpack: () => void = () => undefined;
let tiles: Map< string, SystemDockItem >;
let badges: Map< string, number >;

function install(): void {
	controller = installAdminBarNotes( {
		appendSystemTile: ( item ) => tiles.set( item.id, item ),
		removeSystemTile: ( id ) => tiles.delete( id ),
		setBadge: ( id, count ) => badges.set( id, count ),
	} );
}

beforeEach( () => {
	installHooksStub();
	vi.useFakeTimers();
	tiles = new Map();
	badges = new Map();
	document.body.className = 'os-active os-admin-bar-hidden';
	document.body.innerHTML = NOTES_MARKUP;
	teardownJetpack = installJetpackStandIn();
} );

afterEach( () => {
	controller?.destroy();
	controller = null;
	teardownJetpack();
	vi.useRealTimers();
	clearHooksStub();
	document.body.innerHTML = '';
	document.body.className = '';
} );

describe( 'admin-bar notes tile', () => {
	test( 'no tile on a site without the bell', () => {
		document.getElementById( 'wp-admin-bar-notes' )?.remove();
		install();
		expect( tiles.size ).toBe( 0 );
	} );

	test( 'the tile exists only while the bar is hidden', async () => {
		install();
		expect( tiles.has( NOTES_TILE_ID ) ).toBe( true );

		document.body.className = 'os-active os-admin-bar-static';
		await flush();
		expect( tiles.has( NOTES_TILE_ID ) ).toBe( false );

		document.body.className = 'os-active os-admin-bar-hidden';
		await flush();
		expect( tiles.has( NOTES_TILE_ID ) ).toBe( true );
	} );

	test( 'the badge follows the bell’s unread count', async () => {
		install();
		expect( badges.get( NOTES_TILE_ID ) ).toBe( 0 );

		const count = document.getElementById( 'wpnt-notes-unread-count' ) as HTMLElement;
		count.className = 'wpn-unread';
		count.textContent = '7';
		await flush();
		expect( badges.get( NOTES_TILE_ID ) ).toBe( 7 );

		count.className = 'wpn-read';
		count.textContent = '0';
		await flush();
		expect( badges.get( NOTES_TILE_ID ) ).toBe( 0 );
	} );

	test( 'the tile opens the panel, and closes it again', async () => {
		install();
		const item = tiles.get( NOTES_TILE_ID ) as SystemDockItem;

		await clickTile( item );
		expect( panel().style.display ).toBe( 'block' );
		expect( item.isOpen?.() ).toBe( true );

		// The press already closed it (outside the bell); the click
		// must not open it straight back up.
		await clickTile( item );
		expect( panel().style.display ).toBe( 'none' );
		expect( item.isOpen?.() ).toBe( false );
	} );

	test( 'keyboard activation ignores an earlier pointer press', async () => {
		install();
		const item = tiles.get( NOTES_TILE_ID ) as SystemDockItem;

		// Opened by pointer, then Enter on the focused tile moments
		// later: the press belonged to the first click, not this one.
		await clickTile( item );
		item.onOpen( new MouseEvent( 'click', { detail: 0 } ) );
		await vi.runAllTimersAsync();
		expect( panel().style.display ).toBe( 'none' );

		item.onOpen();
		await vi.runAllTimersAsync();
		expect( panel().style.display ).toBe( 'block' );
	} );
} );
