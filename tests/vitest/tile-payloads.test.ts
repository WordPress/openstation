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
		expect( tilePayloadAcceptLabel( ctx ) ).toBe( 'Convert to post' );
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
		expect( tilePayloadAcceptLabel( otherTile ) ).toBeUndefined();
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
} );
