/**
 * Desktop / folder tiles — "Send to <agent>".
 *
 * The same agents WP Explorer's menus offer, on the tiles of the
 * wallpaper and of folders: one entry per agent whose `send-to`
 * trigger accepts the tile's entity kind, dispatching through the same
 * engine.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock( '../../src/agents-dispatch', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('../../src/agents-dispatch') >();
	return { ...actual, dispatchAgentSendTo: vi.fn( async () => undefined ) };
} );

import { dispatchAgentSendTo } from '../../src/agents-dispatch';
import {
	_setSendToTargets,
	agentMenuItems,
	entityForPlacement,
	type SendToTarget,
} from '../../src/desktop-files/agent-menu-items';
import type { RestPlacementShape } from '../../src/desktop-files/rest';

function placement( file: Record< string, unknown > ): RestPlacementShape {
	return { id: 1, region: 'desktop', file } as unknown as RestPlacementShape;
}

const editor: SendToTarget = { id: 11, name: 'Editor Bot', description: '', avatarUrl: '', entityKinds: [] };
const mediaOnly: SendToTarget = { id: 12, name: 'Alt Texter', description: '', avatarUrl: '', entityKinds: [ 'media' ] };

afterEach( () => {
	_setSendToTargets( [] );
	vi.mocked( dispatchAgentSendTo ).mockClear();
	delete ( window as unknown as { openStationConfig?: unknown } ).openStationConfig;
} );

describe( 'entityForPlacement', () => {
	test( 'maps desktop file types onto the agents’ entity kinds', () => {
		expect( entityForPlacement( placement( { type: 'post', ref: '5', title: 'Hello', postType: 'post' } ) ) )
			.toEqual( { kind: 'post', id: 5, title: 'Hello' } );
		expect( entityForPlacement( placement( { type: 'post', ref: '6', title: 'About', postType: 'page' } ) )?.kind )
			.toBe( 'page' );
		expect( entityForPlacement( placement( { type: 'attachment', ref: '7', title: 'cat.jpg' } ) )?.kind )
			.toBe( 'media' );
		expect( entityForPlacement( placement( { type: 'user', ref: '8', title: 'Ada' } ) )?.kind )
			.toBe( 'user' );
	} );

	test( 'a folder, an upload or an agent’s own tile is nothing to send', () => {
		expect( entityForPlacement( placement( { type: 'folder', ref: '9', title: 'Stuff' } ) ) ).toBeNull();
		expect( entityForPlacement( placement( { type: 'upload', ref: '10', title: 'a.pdf' } ) ) ).toBeNull();
		expect( entityForPlacement( placement( { type: 'user', ref: '11', title: 'Editor Bot', isAgent: true } ) ) ).toBeNull();
	} );
} );

describe( 'agentMenuItems', () => {
	test( 'offers every agent whose trigger accepts the tile’s kind', () => {
		_setSendToTargets( [ editor, mediaOnly ] );

		const onPost = agentMenuItems( [], placement( { type: 'post', ref: '5', title: 'Hello', postType: 'post' } ) );
		expect( onPost.map( ( i ) => i.label ) ).toEqual( [ 'Send to Editor Bot' ] );

		const onMedia = agentMenuItems( [], placement( { type: 'attachment', ref: '7', title: 'cat.jpg' } ) );
		expect( onMedia.map( ( i ) => i.label ) ).toEqual( [ 'Send to Editor Bot', 'Send to Alt Texter' ] );
	} );

	test( 'adds nothing without agents, or on a tile no agent can receive', () => {
		const existing = [ { id: 'open', label: 'Open', icon: 'dashicons-external', sort: 10, onClick: () => undefined } ];
		expect( agentMenuItems( [ ...existing ], placement( { type: 'post', ref: '5', title: 'Hello' } ) ) ).toHaveLength( 1 );

		_setSendToTargets( [ editor ] );
		expect( agentMenuItems( [ ...existing ], placement( { type: 'folder', ref: '9', title: 'Stuff' } ) ) ).toHaveLength( 1 );
	} );

	test( 'picking an entry hands the entity to that agent', () => {
		( window as unknown as { openStationConfig: unknown } ).openStationConfig = { restUrl: '/wp-json/', restNonce: 'n' };
		_setSendToTargets( [ editor ] );
		const [ item ] = agentMenuItems( [], placement( { type: 'post', ref: '5', title: 'Hello', postType: 'post' } ) );

		item.onClick?.();

		expect( dispatchAgentSendTo ).toHaveBeenCalledWith(
			expect.objectContaining( { id: 11, name: 'Editor Bot' } ),
			{ kind: 'post', id: 5, title: 'Hello' },
			{ restRoot: '/wp-json/', restNonce: 'n' },
		);
	} );
} );
