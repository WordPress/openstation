/**
 * Unit tests for `src/agents-conversations.ts` — the persistence
 * primitive: create on first save, replace afterwards, never throw.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { agentsChatStore } from '../../src/agents-chat-store';
import {
	listConversations,
	persistAgentTranscript,
} from '../../src/agents-conversations';

const REST = {
	restRoot: 'https://example.test/wp-json/',
	restNonce: 'test-nonce',
};
const AGENT = {
	id: 5,
	name: 'Audit Agent',
	description: '',
	avatarUrl: 'https://example.test/bot.svg',
};

type FetchMock = ReturnType< typeof vi.fn >;

beforeEach( () => {
	agentsChatStore.state.activeAgent = null;
	agentsChatStore.state.transcripts = {};
	agentsChatStore.state.conversationIds = {};
	agentsChatStore.state.conversationsRev = 0;
} );

afterEach( () => {
	vi.restoreAllMocks();
} );

describe( 'persistAgentTranscript', () => {
	test( 'creates on first save, replaces on the next', async () => {
		const fetchMock: FetchMock = vi.fn( async ( input: unknown, init?: RequestInit ) => ( {
			ok: true,
			status: 200,
			json: async () =>
				init?.method === 'POST'
					? { id: 91, agentId: 5, messages: [] }
					: {},
		} ) as unknown as Response );
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fetchMock;

		agentsChatStore.state.transcripts[ 5 ] = [
			{ role: 'user', text: 'hi', at: 1 },
			{ role: 'agent', text: 'hello', at: 2 },
		];

		await persistAgentTranscript( AGENT, REST );
		expect( agentsChatStore.state.conversationIds[ 5 ] ).toBe( 91 );
		expect( agentsChatStore.state.conversationsRev ).toBe( 1 );
		const [ createUrl, createInit ] = fetchMock.mock.calls[ 0 ] as [
			string,
			RequestInit,
		];
		expect( createUrl ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/agents/conversations',
		);
		expect( createInit.method ).toBe( 'POST' );
		expect(
			JSON.parse( String( createInit.body ) ) as { agentId: number },
		).toMatchObject( { agentId: 5 } );

		agentsChatStore.state.transcripts[ 5 ].push( {
			role: 'user',
			text: 'more',
			at: 3,
		} );
		await persistAgentTranscript( AGENT, REST );
		const [ updateUrl, updateInit ] = fetchMock.mock.calls[ 1 ] as [
			string,
			RequestInit,
		];
		expect( updateUrl ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/agents/conversations/91',
		);
		expect( updateInit.method ).toBe( 'PUT' );
		expect( agentsChatStore.state.conversationsRev ).toBe( 2 );
	} );

	test( 'skips empty transcripts and pending-only rows', async () => {
		const fetchMock: FetchMock = vi.fn();
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fetchMock;

		agentsChatStore.state.transcripts[ 5 ] = [
			{ role: 'agent', text: 'Working…', at: 1, pending: true },
		];
		await persistAgentTranscript( AGENT, REST );
		expect( fetchMock ).not.toHaveBeenCalled();
	} );

	test( 'swallows save failures without touching the binding', async () => {
		const fetchMock: FetchMock = vi.fn( async () => ( {
			ok: false,
			status: 500,
			json: async () => ( { message: 'kaboom' } ),
		} ) as unknown as Response );
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fetchMock;
		const warn = vi
			.spyOn( console, 'warn' )
			.mockImplementation( () => undefined );

		agentsChatStore.state.transcripts[ 5 ] = [
			{ role: 'user', text: 'hi', at: 1 },
		];
		await persistAgentTranscript( AGENT, REST );
		expect( agentsChatStore.state.conversationIds[ 5 ] ).toBeUndefined();
		expect( agentsChatStore.state.conversationsRev ).toBe( 0 );
		expect( warn ).toHaveBeenCalled();
	} );
} );

describe( 'listConversations', () => {
	test( 'returns [] for a non-array response', async () => {
		( globalThis as unknown as { fetch: FetchMock } ).fetch = vi.fn(
			async () => ( {
				ok: true,
				status: 200,
				json: async () => ( { message: 'not a list' } ),
			} ) as unknown as Response,
		);
		expect( await listConversations( REST ) ).toEqual( [] );
	} );
} );
