/**
 * Unit tests for `src/desktop-files/agent-drop-targets.ts` — the
 * wallpaper agent-tile payload handlers: gating from the inlined
 * `agentDragKinds`, and the invoke URL built from the shell's
 * `restUrl` (NOT the files layer's `baseUrl`, which already ends in
 * `desktop-mode/v1/files` — the double-prefix 404 regression).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	installAgentTileDropHandlers,
	__resetAgentTileDropHandlersForTests,
} from '../../src/desktop-files/agent-drop-targets';
import {
	tilePayloadAccepts,
	tilePayloadAcceptLabel,
	tilePayloadDrop,
	__resetTilePayloadHandlersForTests,
} from '../../src/desktop-files/tile-payloads';
import { agentsChatStore } from '../../src/agents-chat-store';
import type { RestPlacementShape } from '../../src/desktop-files/rest';

type FetchMock = ReturnType< typeof vi.fn >;

function agentPlacement(
	overrides: Record< string, unknown > = {},
): { placement: RestPlacementShape } {
	return {
		placement: {
			id: 82,
			file: {
				type: 'user',
				ref: '9',
				title: 'Remove background',
				icon: 'dashicons-admin-users',
				previewUrl: 'https://example.test/avatar.svg',
				exists: true,
				isAgent: true,
				agentDragKinds: [ 'media' ],
				...overrides,
			},
		} as unknown as RestPlacementShape,
	};
}

const MEDIA_PAYLOAD = {
	type: 'shortcut',
	source: document.createElement( 'div' ),
	data: { kind: 'attachment', ref: '44', title: 'Hornet' },
};

beforeEach( () => {
	__resetTilePayloadHandlersForTests();
	__resetAgentTileDropHandlersForTests();
	installAgentTileDropHandlers();
	agentsChatStore.state.activeAgent = null;
	agentsChatStore.state.transcripts = {};
	( window as unknown as Record< string, unknown > ).openStationConfig = {
		restUrl: 'https://example.test/wp-json/',
		restNonce: 'shell-nonce',
	};
	( window as unknown as Record< string, unknown > ).wp = {
		os: { openWindow: vi.fn( () => true ) },
	};
} );

afterEach( () => {
	vi.restoreAllMocks();
	__resetTilePayloadHandlersForTests();
	__resetAgentTileDropHandlersForTests();
	delete ( window as unknown as Record< string, unknown > )
		.openStationConfig;
	delete ( window as unknown as Record< string, unknown > ).wp;
} );

describe( 'agent tile payload handlers', () => {
	test( 'accepts payloads per the inlined drag kinds, with the chip label', () => {
		const ctx = agentPlacement();
		expect( tilePayloadAccepts( MEDIA_PAYLOAD, ctx ) ).toBe( true );
		expect( tilePayloadAcceptLabel( 'shortcut', ctx ) ).toBe(
			'Send to agent',
		);
		expect(
			tilePayloadAccepts(
				{
					...MEDIA_PAYLOAD,
					data: { kind: 'post', ref: '7', title: 'Draft' },
				},
				ctx,
			),
		).toBe( false );
	} );

	test( 'rejects non-agent tiles and agents without a drag trigger', () => {
		expect(
			tilePayloadAccepts(
				MEDIA_PAYLOAD,
				agentPlacement( { isAgent: undefined } ),
			),
		).toBe( false );
		expect(
			tilePayloadAccepts(
				MEDIA_PAYLOAD,
				agentPlacement( { agentDragKinds: null } ),
			),
		).toBe( false );
		expect(
			tilePayloadAccepts(
				MEDIA_PAYLOAD,
				agentPlacement( { agentDragKinds: [] } ),
			),
		).toBe( true );
	} );

	test( 'desktop-file payloads gate through placement.file', () => {
		const payload = {
			type: 'desktop-file',
			source: document.createElement( 'div' ),
			data: {
				placement: {
					file: { type: 'attachment', ref: '44', title: 'Hornet' },
				},
			},
		};
		expect( tilePayloadAccepts( payload, agentPlacement() ) ).toBe( true );
	} );

	test( 'onDrop posts to the shell restUrl root, never the files base', async () => {
		const fetchMock: FetchMock = vi.fn( async () => ( {
			ok: true,
			status: 200,
			json: async () => ( { text: 'done', toolCalls: [], turns: 1 } ),
		} ) as unknown as Response );
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fetchMock;

		const handled = tilePayloadDrop(
			{
				payload: MEDIA_PAYLOAD,
				isFinished: () => true,
				cancel: () => void 0,
			} as never,
			{ clientX: 0, clientY: 0 },
			agentPlacement(),
		);
		expect( handled ).toBe( true );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		const [ url, init ] = fetchMock.mock.calls[ 0 ] as [
			string,
			RequestInit,
		];
		expect( url ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/agents/9/invoke',
		);
		expect( url ).not.toContain( '/files/' );
		expect(
			( init.headers as Record< string, string > )[ 'X-WP-Nonce' ],
		).toBe( 'shell-nonce' );
		expect(
			( JSON.parse( String( init.body ) ) as { source: string } ).source,
		).toBe( 'drag' );

		expect( agentsChatStore.state.activeAgent?.id ).toBe( 9 );
		expect(
			agentsChatStore.state.transcripts[ 9 ][ 1 ].text,
		).toBe( 'done' );
	} );
} );
