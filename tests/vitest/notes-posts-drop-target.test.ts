/**
 * Regression test for the "convert note to post" DOCK drop target.
 *
 * The bug this guards: the dock tile's `data-menu-slug` for the core
 * Posts menu is `menu-posts` (WP's `$menu[5][5]`), NOT `edit.php` — the
 * first selector never matched, so the target never registered and a
 * note dragged onto the Posts icon fell through to "Can't pin here".
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import type { DropTarget } from '../../src/drag';
import {
	installNotesPostsDropTarget,
	__resetNotesPostsDropTargetForTests,
} from '../../src/notes/posts-drop-target';
import {
	tilePayloadAccepts,
	tilePayloadAcceptLabel,
	tilePayloadDrop,
} from '../../src/desktop-files/tile-payloads';
import type { Note } from '../../src/notes/types';

const NOTE: Note = {
	id: 7,
	text: 'draft me',
	color: 'sky',
	x: 0.2,
	y: 0.3,
	z: 4,
	public: false,
	seed: 77,
	ownerId: 1,
	ownerName: 'Ana',
	ownerAvatar: '',
	canEdit: true,
	updatedAtMs: 1000,
};

function noteSession( data: Partial< Note & { noteId: number } > = {} ) {
	return {
		payload: {
			type: 'note',
			source: document.createElement( 'div' ),
			data: { noteId: 7, canEdit: true, updatedAtMs: 1000, ...data },
		},
	} as never;
}

describe( 'notes → posts dock drop target', () => {
	let targets: DropTarget[];
	let convertNote: ReturnType< typeof vi.fn >;
	let layer: { canCreatePosts: boolean; get: ( id: number ) => unknown; convertNote: typeof convertNote };

	function fakeDragManager() {
		return {
			registerDropTarget: ( t: DropTarget ) => {
				targets.push( t );
				return () => {
					const i = targets.indexOf( t );
					if ( i >= 0 ) {
						targets.splice( i, 1 );
					}
				};
			},
			debug: () => ( { listTargets: () => targets } ),
		};
	}

	function makeTile( slug: string ): HTMLElement {
		const tile = document.createElement( 'div' );
		tile.className = 'desktop-mode-dock__item';
		tile.setAttribute( 'data-menu-slug', slug );
		document.body.appendChild( tile );
		return tile;
	}

	beforeEach( () => {
		installHooksStub();
		__resetNotesPostsDropTargetForTests();
		targets = [];
		convertNote = vi.fn();
		layer = {
			canCreatePosts: true,
			get: ( id: number ) => ( id === 7 ? { note: NOTE } : undefined ),
			convertNote,
		};
		// `installHooksStub()` mounted `window.wp.hooks`; add `desktop`
		// alongside it rather than clobbering the whole `wp` object.
		( window as unknown as { wp: { desktop?: unknown } } ).wp.desktop = {
			dragManager: fakeDragManager(),
		};
	} );

	afterEach( () => {
		__resetNotesPostsDropTargetForTests();
		document.body.innerHTML = '';
		delete ( window as unknown as { wp: { desktop?: unknown } } ).wp.desktop;
		clearHooksStub();
	} );

	test( 'registers a drop target on the core Posts tile (menu-posts)', () => {
		const tile = makeTile( 'menu-posts' );
		installNotesPostsDropTarget( layer as never );
		expect( targets ).toHaveLength( 1 );
		expect( targets[ 0 ].element ).toBe( tile );
	} );

	test( 'also matches the sanitized-slug fallback (editphp)', () => {
		const tile = makeTile( 'editphp' );
		installNotesPostsDropTarget( layer as never );
		expect( targets ).toHaveLength( 1 );
		expect( targets[ 0 ].element ).toBe( tile );
	} );

	test( 'does NOT match the raw edit.php slug (the original bug)', () => {
		makeTile( 'edit.php' );
		installNotesPostsDropTarget( layer as never );
		expect( targets ).toHaveLength( 0 );
	} );

	test( 'accepts an editable note payload and rejects others', () => {
		makeTile( 'menu-posts' );
		installNotesPostsDropTarget( layer as never );
		const t = targets[ 0 ];
		expect( t.accept( noteSession().payload ) ).toBe( true );
		expect( t.accept( noteSession( { canEdit: false } ).payload ) ).toBe( false );
		expect(
			t.accept( { type: 'desktop-file', source: document.createElement( 'div' ), data: {} } ),
		).toBe( false );
	} );

	test( 'onDrop converts the dragged note; enter/leave toggle the highlight', () => {
		const tile = makeTile( 'menu-posts' );
		installNotesPostsDropTarget( layer as never );
		const t = targets[ 0 ];

		t.onEnter?.( noteSession() );
		expect( tile.hasAttribute( 'data-desktop-mode-posts-drop-active' ) ).toBe( true );

		t.onDrop( noteSession(), new MouseEvent( 'mouseup' ) as never );
		expect( convertNote ).toHaveBeenCalledWith( NOTE );
		expect( tile.hasAttribute( 'data-desktop-mode-posts-drop-active' ) ).toBe( false );
	} );

	test( 'no-op when the user cannot author posts', () => {
		makeTile( 'menu-posts' );
		installNotesPostsDropTarget( { ...layer, canCreatePosts: false } as never );
		expect( targets ).toHaveLength( 0 );
	} );

	// Surface 3: the Spatial-layout Posts shortcut file-tile, handled via
	// the files-layer tile-payload seam (the tile is claimed by the files
	// layer, so we can't register our own DropTarget there).
	test( 'registers a tile-payload handler scoped to the Posts shortcut', () => {
		makeTile( 'menu-posts' );
		installNotesPostsDropTarget( layer as never );

		const shortcut = ( url: string ) => ( {
			placement: {
				id: 1,
				parentId: 0,
				x: 0,
				y: 0,
				sortOrder: 0,
				updatedAtMs: 1,
				meta: null,
				file: {
					type: 'shortcut',
					ref: 'dock-promoted:menu-posts',
					title: 'Posts',
					icon: '',
					previewUrl: '',
					exists: true,
					shortcutUrl: url,
				},
			},
		} as never );

		const notePayload = {
			type: 'note',
			source: document.body,
			data: { noteId: 7, canEdit: true },
		};

		// Posts list → claimed + accepted; Pages / Media → not claimed.
		expect( tilePayloadAcceptLabel( 'note', shortcut( '/wp-admin/edit.php' ) ) ).toBe(
			'Convert to post',
		);
		expect( tilePayloadAccepts( notePayload, shortcut( '/wp-admin/edit.php' ) ) ).toBe( true );
		expect(
			tilePayloadAccepts( notePayload, shortcut( '/wp-admin/edit.php?post_type=page' ) ),
		).toBe( false );
		expect( tilePayloadAcceptLabel( 'note', shortcut( '/wp-admin/upload.php' ) ) ).toBeUndefined();

		// Drop over the Posts shortcut converts the dragged note.
		tilePayloadDrop(
			{ payload: notePayload } as never,
			{ clientX: 0, clientY: 0 },
			shortcut( '/wp-admin/edit.php' ),
		);
		expect( convertNote ).toHaveBeenCalledWith( NOTE );
	} );
} );
