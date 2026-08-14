/**
 * Apps & Icons item listing — which things the placement picker offers
 * a row for, and what each row is allowed to be set to.
 *
 * The interesting case is **system tiles**: JS-owned shell affordances
 * attached straight to a rail. They are opt-in, because most of them
 * are load-bearing — OS Settings is how you reach the very screen that
 * would hide it — and they are dock-only, because there is no
 * server-side icon entry for the wallpaper grid to synthesize from.
 */
import { describe, expect, test } from 'vitest';
import {
	applyDockPlacement,
	listPlaceableItems,
	type PlaceableSystemTile,
} from '../../src/settings/item-placement';
import type { DockItem } from '../../src/dock';
import type { DesktopIconServerEntry } from '../../src/types';

function dockItem( over: Partial< DockItem > = {} ): DockItem {
	return {
		id: 'edit-php',
		title: 'Posts',
		icon: 'dashicons-admin-post',
		url: 'https://example.com/wp-admin/edit.php',
		...over,
	} as DockItem;
}

function icon(
	over: Partial< DesktopIconServerEntry > = {},
): DesktopIconServerEntry {
	return {
		id: 'jorvy',
		title: 'Jorvy',
		icon: 'dashicons-star-filled',
		...over,
	} as DesktopIconServerEntry;
}

function tile( over: Partial< PlaceableSystemTile > = {} ): PlaceableSystemTile {
	return {
		id: 'os-mio-toggle',
		title: 'Mio',
		icon: 'dashicons-superhero-alt',
		placeable: true,
		...over,
	};
}

describe( 'listPlaceableItems', () => {
	test( 'lists dock items and desktop icons, alphabetically', () => {
		const rows = listPlaceableItems( [ dockItem() ], [ icon() ], {} );
		expect( rows.map( ( r ) => r.title ) ).toEqual( [ 'Jorvy', 'Posts' ] );
		expect( rows.map( ( r ) => r.nativeRail ) ).toEqual( [
			'desktop',
			'dock',
		] );
	} );

	test( 'system tiles only appear when they opt in', () => {
		const optedOut = listPlaceableItems(
			[],
			[],
			{},
			[ tile( { placeable: false } ) ],
		);
		expect( optedOut ).toHaveLength( 0 );

		const optedIn = listPlaceableItems( [], [], {}, [ tile() ] );
		expect( optedIn.map( ( r ) => r.id ) ).toEqual( [
			'os-mio-toggle',
		] );
	} );

	test( 'a system tile row is dock-only', () => {
		// No server-side icon entry exists for the wallpaper grid to
		// synthesize from, so "on the desktop" would read as a
		// placement and behave as a disappearance.
		const [ row ] = listPlaceableItems( [], [], {}, [ tile() ] );
		expect( row.dockOnly ).toBe( true );
		expect( row.nativeRail ).toBe( 'dock' );
	} );

	test( 'ordinary rows are not dock-only', () => {
		const rows = listPlaceableItems( [ dockItem() ], [ icon() ], {} );
		for ( const row of rows ) {
			expect( row.dockOnly ).toBeUndefined();
		}
	} );

	test( 'a system tile defaults to visible and honours an override', () => {
		expect(
			listPlaceableItems( [], [], {}, [ tile() ] )[ 0 ].placement,
		).toBe( 'dock' );
		expect(
			listPlaceableItems(
				[],
				[],
				{ 'os-mio-toggle': 'hidden' },
				[ tile() ],
			)[ 0 ].placement,
		).toBe( 'hidden' );
	} );

	test( 'a dock-only row never resolves to a rail its picker omits', () => {
		// A window that used to register a desktop icon leaves that
		// icon's override behind. The picker offers dock and hidden, so
		// anything else has to read as dock rather than leave the row
		// showing a value it cannot display.
		for ( const stale of [ 'desktop', 'both' ] as const ) {
			expect(
				listPlaceableItems(
					[],
					[],
					{ 'os-mio-toggle': stale },
					[ tile() ],
				)[ 0 ].placement,
			).toBe( 'dock' );
		}
	} );

	test( 'an id shared with a system tile yields one row, the tile’s', () => {
		// System tiles are listed first, so the guard has to be the
		// `seen` set rather than registration order: whichever source
		// claims the id first keeps it, and the other is skipped rather
		// than appended as a duplicate row.
		const rows = listPlaceableItems(
			[ dockItem( { id: 'shared', title: 'From the dock' } ) ],
			[],
			{},
			[ tile( { id: 'shared', title: 'From a system tile' } ) ],
		);
		expect( rows ).toHaveLength( 1 );
		expect( rows[ 0 ].title ).toBe( 'From a system tile' );
	} );
} );

/*
 * A running app takes a dock tile for as long as its window is open,
 * whatever its resting place is: sending it to the desktop says where
 * its launcher lives, not that a live window should be unswitchable
 * while every other one has a tile.
 *
 * `'hidden'` is the exception, and the one worth a test. It means
 * suppressed from every shell surface, so it outranks the override —
 * the user asked for no tile, not for a tile whenever the app happens
 * to be running.
 */
describe( 'applyDockPlacement: running apps', () => {
	const explorer = icon( { id: 'wp-explorer', window: 'my-wordpress' } );
	const synth = ( items: ReturnType< typeof applyDockPlacement > ) =>
		items.find( ( i ) => i.id === 'dock:wp-explorer' ) ?? null;

	test( 'a desktop-only icon gains a tile while its window is open', () => {
		const settings = {
			itemVisibility: { 'wp-explorer': 'desktop' as const },
			dockOrder: [],
		};

		expect(
			synth( applyDockPlacement( [], [ explorer ], settings ) ),
		).toBeNull();
		expect(
			synth(
				applyDockPlacement(
					[],
					[ explorer ],
					settings,
					undefined,
					new Set( [ 'my-wordpress' ] ),
				),
			),
		).not.toBeNull();
	} );

	test( 'the tile lands in the plugin cluster, carrying its window id', () => {
		const item = synth(
			applyDockPlacement(
				[],
				[ explorer ],
				{
					itemVisibility: { 'wp-explorer': 'desktop' as const },
					dockOrder: [],
				},
				undefined,
				new Set( [ 'my-wordpress' ] ),
			),
		);

		// `isCore: false` is what puts it after the core→plugin seam,
		// and `windowId` is what lights its running indicator.
		expect( item?.isCore ).toBe( false );
		expect( item?.windowId ).toBe( 'my-wordpress' );
	} );

	test( 'a hidden icon stays hidden even while running', () => {
		expect(
			synth(
				applyDockPlacement(
					[],
					[ explorer ],
					{
						itemVisibility: { 'wp-explorer': 'hidden' as const },
						dockOrder: [],
					},
					undefined,
					new Set( [ 'my-wordpress' ] ),
				),
			),
		).toBeNull();
	} );
} );
