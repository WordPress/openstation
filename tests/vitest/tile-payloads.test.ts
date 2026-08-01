/**
 * The files-layer tile-payload seam: a feature opts a payload type into
 * a non-folder tile the files layer would otherwise hard-reject.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	registerTilePayloadHandler,
	tilePayloadAccepts,
	tilePayloadAcceptLabel,
	tilePayloadDrop,
	__resetTilePayloadHandlersForTests,
	type TilePayloadContext,
} from '../../src/desktop-files/tile-payloads';
import type { RestPlacementShape } from '../../src/desktop-files/rest';

function placement( shortcutUrl: string ): RestPlacementShape {
	return {
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
			icon: 'dashicons-admin-post',
			previewUrl: '',
			exists: true,
			shortcutUrl,
		},
	};
}

const session = ( type: string ) =>
	( { payload: { type, source: document.createElement( 'div' ), data: { noteId: 5 } } } as never );

afterEach( () => __resetTilePayloadHandlersForTests() );

describe( 'tile-payload seam', () => {
	test( 'accepts only the registered type on tiles the handler claims', () => {
		const onDrop = vi.fn();
		registerTilePayloadHandler( 'note', {
			appliesTo: ( ctx ) => ctx.placement.file.ref === 'dock-promoted:menu-posts',
			acceptLabel: 'Convert to post',
			accept: ( data ) => ( data as { canEdit?: boolean } ).canEdit === true,
			onDrop,
		} );

		const ctx: TilePayloadContext = { placement: placement( '/wp-admin/edit.php' ) };
		const notePayload = { type: 'note', source: document.body, data: { canEdit: true } };
		const filePayload = { type: 'desktop-file', source: document.body, data: {} };

		expect( tilePayloadAccepts( notePayload, ctx ) ).toBe( true );
		expect( tilePayloadAccepts( filePayload, ctx ) ).toBe( false );
		expect( tilePayloadAcceptLabel( 'note', ctx ) ).toBe( 'Convert to post' );
		// Keyed by payload type: a type with no handler has no label,
		// even on a tile another handler claims.
		expect( tilePayloadAcceptLabel( 'desktop-file', ctx ) ).toBeUndefined();
	} );

	test( 'rejects on tiles the handler does not claim (appliesTo false)', () => {
		registerTilePayloadHandler( 'note', {
			appliesTo: ( ctx ) => ctx.placement.file.ref === 'dock-promoted:menu-posts',
			acceptLabel: 'Convert to post',
			accept: () => true,
			onDrop: vi.fn(),
		} );
		const otherTile: TilePayloadContext = {
			placement: { ...placement( '' ), file: { ...placement( '' ).file, ref: 'dock-promoted:menu-media' } },
		};
		const notePayload = { type: 'note', source: document.body, data: { canEdit: true } };
		expect( tilePayloadAccepts( notePayload, otherTile ) ).toBe( false );
		expect( tilePayloadAcceptLabel( 'note', otherTile ) ).toBeUndefined();
	} );

	test( 'label is payload-type-aware when two handlers claim the same tile', () => {
		registerTilePayloadHandler( 'note', {
			appliesTo: () => true,
			acceptLabel: 'Convert to post',
			accept: () => true,
			onDrop: vi.fn(),
		} );
		registerTilePayloadHandler( 'widget', {
			appliesTo: () => true,
			acceptLabel: 'Add as widget',
			accept: () => true,
			onDrop: vi.fn(),
		} );
		const ctx: TilePayloadContext = { placement: placement( '/wp-admin/edit.php' ) };
		expect( tilePayloadAcceptLabel( 'note', ctx ) ).toBe( 'Convert to post' );
		expect( tilePayloadAcceptLabel( 'widget', ctx ) ).toBe( 'Add as widget' );
	} );

	test( 'drop dispatches to the handler; returns false when unhandled', () => {
		const onDrop = vi.fn();
		registerTilePayloadHandler( 'note', {
			appliesTo: () => true,
			acceptLabel: 'x',
			accept: () => true,
			onDrop,
		} );
		const ctx: TilePayloadContext = { placement: placement( '/wp-admin/edit.php' ) };
		expect( tilePayloadDrop( session( 'note' ), { clientX: 0, clientY: 0 }, ctx ) ).toBe( true );
		expect( onDrop ).toHaveBeenCalledTimes( 1 );
		expect( tilePayloadDrop( session( 'shortcut' ), { clientX: 0, clientY: 0 }, ctx ) ).toBe( false );
	} );

	test( 'deregister removes the handler', () => {
		const off = registerTilePayloadHandler( 'note', {
			appliesTo: () => true,
			acceptLabel: 'x',
			accept: () => true,
			onDrop: vi.fn(),
		} );
		const ctx: TilePayloadContext = { placement: placement( '' ) };
		off();
		expect( tilePayloadAccepts( { type: 'note', source: document.body, data: {} }, ctx ) ).toBe( false );
	} );

	describe( 'several handlers per payload type', () => {
		// Handlers are scoped to the tiles they recognize, so more
		// than one feature can want the same payload type on different
		// icons — `'shortcut'` alone is claimed by the agent drop
		// targets in-tree and by any plugin accepting files on its own
		// wallpaper icon. One handler per type meant the last
		// registration silently replaced the others.
		const forRef = ( ref: string, onDrop = vi.fn() ) => ( {
			appliesTo: ( ctx: TilePayloadContext ) =>
				ctx.placement.file.ref === ref,
			acceptLabel: `drop on ${ ref }`,
			accept: () => true,
			onDrop,
		} );

		const ctxFor = ( ref: string ): TilePayloadContext => {
			const p = placement( '' );
			p.file.ref = ref;
			return { placement: p };
		};

		test( 'a second handler does not displace the first', () => {
			const first = vi.fn();
			const second = vi.fn();
			registerTilePayloadHandler( 'shortcut', forRef( 'agent-1', first ) );
			registerTilePayloadHandler( 'shortcut', forRef( 'lienzo', second ) );

			expect(
				tilePayloadDrop(
					session( 'shortcut' ),
					{ clientX: 0, clientY: 0 },
					ctxFor( 'agent-1' ),
				),
			).toBe( true );
			expect( first ).toHaveBeenCalledTimes( 1 );
			expect( second ).not.toHaveBeenCalled();

			expect(
				tilePayloadDrop(
					session( 'shortcut' ),
					{ clientX: 0, clientY: 0 },
					ctxFor( 'lienzo' ),
				),
			).toBe( true );
			expect( second ).toHaveBeenCalledTimes( 1 );
		} );

		test( 'the hover chip comes from the handler that claims the tile', () => {
			registerTilePayloadHandler( 'shortcut', forRef( 'agent-1' ) );
			registerTilePayloadHandler( 'shortcut', forRef( 'lienzo' ) );

			expect(
				tilePayloadAcceptLabel( 'shortcut', ctxFor( 'lienzo' ) ),
			).toBe( 'drop on lienzo' );
			expect(
				tilePayloadAcceptLabel( 'shortcut', ctxFor( 'nobody' ) ),
			).toBeUndefined();
		} );

		test( 'deregistering one leaves the others registered', () => {
			const kept = vi.fn();
			const off = registerTilePayloadHandler(
				'shortcut',
				forRef( 'agent-1' ),
			);
			registerTilePayloadHandler( 'shortcut', forRef( 'lienzo', kept ) );

			off();

			expect(
				tilePayloadAccepts(
					{ type: 'shortcut', source: document.body, data: {} },
					ctxFor( 'agent-1' ),
				),
			).toBe( false );
			expect(
				tilePayloadDrop(
					session( 'shortcut' ),
					{ clientX: 0, clientY: 0 },
					ctxFor( 'lienzo' ),
				),
			).toBe( true );
			expect( kept ).toHaveBeenCalledTimes( 1 );
		} );
	} );
} );
