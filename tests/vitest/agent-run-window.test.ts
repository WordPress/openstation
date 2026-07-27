/**
 * Unit tests for `src/agent-run-window.ts` — render-callback
 * registration, the empty state, the seeded conversation paint, and
 * one full send round-trip against a stubbed `/invoke`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import '../../src/agent-run-window';
import {
	agentsChatStore,
	openAgentChat,
} from '../../src/agents-chat-store';

const WINDOW_ID = 'desktop-mode-agent-run';

type RenderCallback = (
	body: HTMLElement,
) => void | ( () => void );

type FetchMock = ReturnType< typeof vi.fn >;

function getRender(): RenderCallback {
	const bag = (
		window as unknown as {
			desktopModeNativeWindows?: Record< string, RenderCallback >;
		}
	 ).desktopModeNativeWindows;
	expect( bag?.[ WINDOW_ID ] ).toBeTypeOf( 'function' );
	return bag![ WINDOW_ID ];
}

function makeBody(): HTMLElement {
	const body = document.createElement( 'div' );
	const root = document.createElement( 'div' );
	root.setAttribute( 'data-desktop-mode-agent-run-root', '' );
	body.appendChild( root );
	document.body.appendChild( body );
	return body;
}

async function flush(): Promise< void > {
	await Promise.resolve();
	await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
}

beforeEach( () => {
	( window as unknown as Record< string, unknown > ).desktopModeWindowConfig = {
		[ WINDOW_ID ]: {
			restRoot: 'https://example.test/wp-json/',
			restNonce: 'test-nonce',
			canManage: true,
		},
	};
	agentsChatStore.state.activeAgent = null;
	agentsChatStore.state.transcripts = {};
} );

afterEach( () => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
	delete ( window as unknown as Record< string, unknown > )
		.desktopModeWindowConfig;
} );

describe( 'agent chat window', () => {
	test( 'registers its render callback on the global bag', () => {
		getRender();
	} );

	test( 'paints the empty state when no agent is seeded', () => {
		const body = makeBody();
		const cleanup = getRender()( body );

		expect( body.querySelector( 'wpd-empty-state' ) ).not.toBeNull();
		if ( typeof cleanup === 'function' ) {
			cleanup();
		}
	} );

	test( 'paints the conversation for the seeded agent', () => {
		const body = makeBody();
		const cleanup = getRender()( body );

		openAgentChat( {
			id: 5,
			name: 'Audit Agent',
			description: 'Audits drafts.',
			avatarUrl: 'data:image/svg+xml;base64,x',
		} );

		expect( body.textContent ).toContain( 'Audit Agent' );
		expect( body.querySelector( '.dm-agent-chat__composer' ) ).not.toBeNull();
		if ( typeof cleanup === 'function' ) {
			cleanup();
		}
	} );

	test( 'sending a message posts to /invoke and paints the answer', async () => {
		const fetchMock: FetchMock = vi.fn( async () => ( {
			ok: true,
			status: 200,
			json: async () => ( {
				text: 'Here is the audit.',
				toolCalls: [
					{
						callId: 'c1',
						name: 'desktop-mode/get-post',
						args: { post_id: 1 },
						output: { id: 1 },
						error: null,
					},
				],
				turns: 2,
			} ),
		} ) as unknown as Response );
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fetchMock;

		const body = makeBody();
		const cleanup = getRender()( body );
		openAgentChat( {
			id: 5,
			name: 'Audit Agent',
			description: '',
			avatarUrl: 'data:image/svg+xml;base64,x',
		} );

		const input = body.querySelector( 'wpd-textarea' ) as HTMLElement & {
			value: string;
		};
		input.value = 'Audit post 1';
		( body.querySelector( '.dm-agent-chat__composer wpd-button' ) as HTMLElement ).click();
		await flush();

		const [ url, init ] = fetchMock.mock.calls[ 0 ] as [
			string,
			RequestInit,
		];
		expect( url ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/agents/5/invoke',
		);
		expect( JSON.parse( String( init.body ) ) ).toEqual( {
			message: 'Audit post 1',
		} );

		expect( body.textContent ).toContain( 'Audit post 1' );
		expect( body.textContent ).toContain( 'Here is the audit.' );
		expect( body.textContent ).toContain( 'Tool calls' );

		if ( typeof cleanup === 'function' ) {
			cleanup();
		}
	} );

	test( 'invoke errors paint as error rows', async () => {
		const fetchMock: FetchMock = vi.fn( async () => ( {
			ok: false,
			status: 429,
			json: async () => ( {
				message: 'This agent reached its limit.',
			} ),
		} ) as unknown as Response );
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fetchMock;

		const body = makeBody();
		const cleanup = getRender()( body );
		openAgentChat( {
			id: 6,
			name: 'Limited',
			description: '',
			avatarUrl: 'data:image/svg+xml;base64,x',
		} );

		const input = body.querySelector( 'wpd-textarea' ) as HTMLElement & {
			value: string;
		};
		input.value = 'hi';
		( body.querySelector( '.dm-agent-chat__composer wpd-button' ) as HTMLElement ).click();
		await flush();

		expect(
			body.querySelector( '.dm-agent-chat__msg--error' ),
		).not.toBeNull();
		expect( body.textContent ).toContain( 'This agent reached its limit.' );

		if ( typeof cleanup === 'function' ) {
			cleanup();
		}
	} );
} );
