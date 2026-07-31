/**
 * Unit tests for `src/agents-dispatch.ts` — drag payload → entity
 * normalization, the drop-gating rule, and the full drop dispatch
 * against a stubbed `/invoke`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	agentAcceptsDrop,
	composeDropMessage,
	describeDragEntity,
	dispatchAgentDrop,
	dragKindsFromTriggers,
	invokeAgentIntoTranscript,
} from '../../src/agents-dispatch';
import { agentsChatStore } from '../../src/agents-chat-store';

type FetchMock = ReturnType< typeof vi.fn >;

const AGENT = {
	id: 9,
	name: 'Remove BG',
	description: 'Removes backgrounds.',
	avatarUrl: '',
};

function shortcutPayload(
	kind: string,
	ref: string,
	extra: Record< string, unknown > = {},
): { type: string; data: Record< string, unknown > } {
	return {
		type: 'shortcut',
		data: { kind, ref, title: 'Some title', ...extra },
	};
}

beforeEach( () => {
	agentsChatStore.state.activeAgent = null;
	agentsChatStore.state.transcripts = {};
} );

afterEach( () => {
	vi.restoreAllMocks();
	delete ( window as unknown as Record< string, unknown > ).wp;
} );

describe( 'describeDragEntity', () => {
	test( 'maps shortcut kinds, including attachment → media', () => {
		expect( describeDragEntity( shortcutPayload( 'post', '7' ) ) ).toEqual( {
			kind: 'post',
			id: 7,
			title: 'Some title',
		} );
		expect(
			describeDragEntity( shortcutPayload( 'attachment', '12' ) )?.kind,
		).toBe( 'media' );
		expect( describeDragEntity( shortcutPayload( 'user', '3' ) )?.kind ).toBe(
			'user',
		);
	} );

	test( 'detects pages via the bridge payload postType', () => {
		const entity = describeDragEntity(
			shortcutPayload( 'post', '7', {
				bridgePayload: { postType: 'page' },
			} ),
		);
		expect( entity?.kind ).toBe( 'page' );
	} );

	test( 'maps desktop-file placements through placement.file', () => {
		const entity = describeDragEntity( {
			type: 'desktop-file',
			data: {
				placement: {
					file: { type: 'attachment', ref: '44', title: 'Hornet' },
				},
			},
		} );
		expect( entity ).toEqual( { kind: 'media', id: 44, title: 'Hornet' } );
	} );

	test( 'returns null for unknown types, kinds, and bad refs', () => {
		expect( describeDragEntity( { type: 'note', data: {} } ) ).toBeNull();
		expect(
			describeDragEntity( shortcutPayload( 'folder', '7' ) ),
		).toBeNull();
		expect(
			describeDragEntity( shortcutPayload( 'post', 'not-a-number' ) ),
		).toBeNull();
	} );
} );

describe( 'drop gating', () => {
	test( 'dragKindsFromTriggers distinguishes absent / unfiltered / filtered', () => {
		expect( dragKindsFromTriggers( [] ) ).toBeNull();
		expect(
			dragKindsFromTriggers( [ { kind: 'chat', config: {} } ] ),
		).toBeNull();
		expect(
			dragKindsFromTriggers( [ { kind: 'drag', config: {} } ] ),
		).toEqual( [] );
		expect(
			dragKindsFromTriggers( [
				{ kind: 'drag', config: { entityKinds: [ 'media', 'post' ] } },
			] ),
		).toEqual( [ 'media', 'post' ] );
	} );

	test( 'agentAcceptsDrop enforces the trigger rule', () => {
		const media = { kind: 'media' as const, id: 44, title: 'Hornet' };
		expect( agentAcceptsDrop( null, media ) ).toBe( false );
		expect( agentAcceptsDrop( [], media ) ).toBe( true );
		expect( agentAcceptsDrop( [ 'media' ], media ) ).toBe( true );
		expect( agentAcceptsDrop( [ 'post' ], media ) ).toBe( false );
		expect( agentAcceptsDrop( [ 'media' ], null ) ).toBe( false );
	} );

	test( 'an agent never accepts its own user tile', () => {
		const self = { kind: 'user' as const, id: 9, title: 'Remove BG' };
		expect( agentAcceptsDrop( [], self, 9 ) ).toBe( false );
		expect( agentAcceptsDrop( [], self, 8 ) ).toBe( true );
	} );
} );

function installOpenWindowStub(): ReturnType< typeof vi.fn > {
	const openWindow = vi.fn( () => true );
	( window as unknown as Record< string, unknown > ).wp = {
		desktop: { openWindow },
	};
	return openWindow;
}

describe( 'dispatchAgentDrop', () => {
	test( 'seeds the transcript, opens the window, and posts source=drag', async () => {
		const openWindow = installOpenWindowStub();
		const fetchMock: FetchMock = vi.fn( async () => ( {
			ok: true,
			status: 200,
			json: async () => ( {
				text: 'Done, new attachment 99.',
				toolCalls: [],
				turns: 2,
			} ),
		} ) as unknown as Response );
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fetchMock;

		const entity = { kind: 'media' as const, id: 44, title: 'Hornet' };
		await dispatchAgentDrop( AGENT, entity, {
			restRoot: 'https://example.test/wp-json/',
			restNonce: 'nonce',
		} );

		expect( openWindow ).toHaveBeenCalledWith(
			'desktop-mode-agent-run',
			expect.objectContaining( { source: 'agents-drop' } ),
		);

		const [ url, init ] = fetchMock.mock.calls[ 0 ] as [
			string,
			RequestInit,
		];
		expect( url ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/agents/9/invoke',
		);
		const body = JSON.parse( String( init.body ) ) as {
			message: string;
			source: string;
		};
		expect( body.source ).toBe( 'drag' );
		expect( body.message ).toBe( composeDropMessage( entity ) );
		expect( body.message ).toContain( 'Hornet' );
		expect( body.message ).toContain( '44' );

		const transcript = agentsChatStore.state.transcripts[ 9 ];
		expect( transcript ).toHaveLength( 2 );
		expect( transcript[ 0 ].role ).toBe( 'user' );
		// The dropped object rides the row so the chat can render it as
		// a card the user can open — the runner still gets the prose.
		expect( transcript[ 0 ].attachment ).toEqual( {
			kind: 'media',
			id: 44,
			title: 'Hornet',
		} );
		expect( transcript[ 1 ].role ).toBe( 'agent' );
		expect( transcript[ 1 ].text ).toBe( 'Done, new attachment 99.' );
		expect( transcript[ 1 ].pending ).toBe( false );
		expect( agentsChatStore.state.activeAgent?.id ).toBe( 9 );
	} );

	test( 'replays the prior conversation, excluding pending and error rows', async () => {
		installOpenWindowStub();
		const fetchMock: FetchMock = vi.fn( async () => ( {
			ok: true,
			status: 200,
			json: async () => ( { text: 'done', toolCalls: [], turns: 1 } ),
		} ) as unknown as Response );
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fetchMock;

		agentsChatStore.state.transcripts[ 9 ] = [
			{ role: 'user', text: 'Summarize post 973.', at: 1 },
			{ role: 'agent', text: 'Proposal for post 973 — approve?', at: 2 },
			{ role: 'error', text: 'Rate limited.', at: 3 },
			{ role: 'agent', text: 'Working…', at: 4, pending: true },
		];

		await invokeAgentIntoTranscript(
			AGENT,
			'Yes, please',
			{ restRoot: 'https://example.test/wp-json/', restNonce: 'n' },
			'chat',
		);

		const [ , init ] = fetchMock.mock.calls[ 0 ] as [ string, RequestInit ];
		const body = JSON.parse( String( init.body ) ) as {
			message: string;
			history: Array< { role: string; text: string } >;
		};
		expect( body.message ).toBe( 'Yes, please' );
		expect( body.history ).toEqual( [
			{ role: 'user', text: 'Summarize post 973.' },
			{ role: 'agent', text: 'Proposal for post 973 — approve?' },
		] );
	} );

	test( 'the first message of a conversation replays no history', async () => {
		installOpenWindowStub();
		const fetchMock: FetchMock = vi.fn( async () => ( {
			ok: true,
			status: 200,
			json: async () => ( { text: 'hi', toolCalls: [], turns: 1 } ),
		} ) as unknown as Response );
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fetchMock;

		await dispatchAgentDrop(
			AGENT,
			{ kind: 'media', id: 44, title: 'Hornet' },
			{ restRoot: 'https://example.test/wp-json/', restNonce: 'n' },
		);

		const [ , init ] = fetchMock.mock.calls[ 0 ] as [ string, RequestInit ];
		expect(
			( JSON.parse( String( init.body ) ) as { history: unknown[] } ).history,
		).toEqual( [] );
	} );

	test( 'invocation failures land as error rows', async () => {
		installOpenWindowStub();
		const fetchMock: FetchMock = vi.fn( async () => ( {
			ok: false,
			status: 429,
			json: async () => ( { message: 'Rate limited.' } ),
		} ) as unknown as Response );
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fetchMock;

		await dispatchAgentDrop(
			AGENT,
			{ kind: 'post', id: 7, title: 'Draft' },
			{ restRoot: 'https://example.test/wp-json/', restNonce: 'n' },
		);

		const transcript = agentsChatStore.state.transcripts[ 9 ];
		expect( transcript[ 1 ].role ).toBe( 'error' );
		expect( transcript[ 1 ].text ).toBe( 'Rate limited.' );
	} );
} );
