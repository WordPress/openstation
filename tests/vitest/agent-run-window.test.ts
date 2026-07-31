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
import {
	agentEditorTarget,
	clearAgentEditorTarget,
} from '../../src/agents-editor-target';

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
	agentsChatStore.state.conversationIds = {};
	agentsChatStore.state.conversationsRev = 0;
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

		const invoke = fetchMock.mock.calls.find( ( c ) =>
			String( c[ 0 ] ).includes( '/invoke' ),
		) as [ string, RequestInit ];
		expect( invoke[ 0 ] ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/agents/5/invoke',
		);
		expect( JSON.parse( String( invoke[ 1 ].body ) ) ).toEqual( {
			message: 'Audit post 1',
			source: 'chat',
			// First message of the conversation — nothing to replay yet.
			history: [],
		} );

		expect( body.textContent ).toContain( 'Audit post 1' );
		expect( body.textContent ).toContain( 'Here is the audit.' );
		expect( body.textContent ).toContain( 'Tool calls' );

		if ( typeof cleanup === 'function' ) {
			cleanup();
		}
	} );

	test( 'rows carry avatars, agent markdown renders, and New chat resets', async () => {
		const body = makeBody();
		const cleanup = getRender()( body );
		openAgentChat( {
			id: 5,
			name: 'TLDR Editor',
			description: '',
			avatarUrl: 'https://example.test/agent.svg',
		} );
		agentsChatStore.state.transcripts[ 5 ] = [
			{ role: 'user', text: 'Summarize it', at: 1 },
			{ role: 'agent', text: '**Done** with `code`', at: 2 },
		];
		agentsChatStore.notify();

		// WhatsApp-style: agent avatar left row, viewer avatar from the
		// window config on the user row. `<wpd-avatar>` rather than a
		// bare `<img>` so a Gravatar-less viewer gets initials instead
		// of the mystery-person silhouette — the URL lands on the
		// element once the resolver's probe settles.
		await flush();
		const agentAvatar = body.querySelector(
			'.dm-agent-chat__line--agent .dm-agent-chat__msg-avatar',
		) as HTMLElement;
		expect( agentAvatar?.tagName.toLowerCase() ).toBe( 'wpd-avatar' );
		expect( agentAvatar?.getAttribute( 'src' ) ).toBe(
			'https://example.test/agent.svg',
		);
		expect(
			body.querySelector(
				'.dm-agent-chat__line--user .dm-agent-chat__msg-avatar',
			),
		).toBeNull(); // config in this suite has no currentUser

		// Agent markdown is rendered, not shown literally.
		const agentText = body.querySelector(
			'.dm-agent-chat__line--agent .dm-agent-chat__msg-text',
		) as HTMLElement;
		expect( agentText.innerHTML ).toContain( '<strong>Done</strong>' );
		expect( agentText.innerHTML ).toContain( '<code>code</code>' );

		// New chat (sidebar) clears the transcript and detaches it from
		// its persisted conversation.
		agentsChatStore.state.conversationIds[ 5 ] = 42;
		(
			body.querySelector( '.dm-agent-chat__new' ) as HTMLElement
		 ).click();
		expect( agentsChatStore.state.transcripts[ 5 ] ).toEqual( [] );
		expect( agentsChatStore.state.conversationIds[ 5 ] ).toBeNull();
		expect( body.querySelector( '.dm-agent-chat__line' ) ).toBeNull();

		if ( typeof cleanup === 'function' ) {
			cleanup();
		}
	} );

	test( 'a follow-up message replays the conversation so far', async () => {
		const fetchMock: FetchMock = vi.fn( async () => ( {
			ok: true,
			status: 200,
			json: async () => ( {
				text: 'Written.',
				toolCalls: [],
				turns: 1,
			} ),
		} ) as unknown as Response );
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fetchMock;

		const body = makeBody();
		const cleanup = getRender()( body );
		openAgentChat( {
			id: 5,
			name: 'TL;DR Agent',
			description: '',
			avatarUrl: 'data:image/svg+xml;base64,x',
		} );
		agentsChatStore.state.transcripts[ 5 ] = [
			{ role: 'user', text: 'Summarize post 973.', at: 1 },
			{ role: 'agent', text: 'Proposal for post 973 — approve?', at: 2 },
		];
		agentsChatStore.notify();

		const input = body.querySelector( 'wpd-textarea' ) as HTMLElement & {
			value: string;
		};
		input.value = 'Yes, please';
		(
			body.querySelector(
				'.dm-agent-chat__composer wpd-button',
			) as HTMLElement
		 ).click();
		await flush();

		const invoke = fetchMock.mock.calls.find( ( c ) =>
			String( c[ 0 ] ).includes( '/invoke' ),
		) as [ string, RequestInit ];
		const sent = JSON.parse( String( invoke[ 1 ].body ) ) as {
			message: string;
			history: Array< { role: string; text: string } >;
		};
		expect( sent.message ).toBe( 'Yes, please' );
		expect( sent.history ).toEqual( [
			{ role: 'user', text: 'Summarize post 973.' },
			{ role: 'agent', text: 'Proposal for post 973 — approve?' },
		] );

		if ( typeof cleanup === 'function' ) {
			cleanup();
		}
	} );

	test( 'the open conversation accepts entity drops for the active agent', async () => {
		interface StubTarget {
			id: string;
			element: HTMLElement;
			accept( payload: {
				type: string;
				data: Record< string, unknown >;
			} ): boolean;
			onDrop( session: {
				payload: { type: string; data: Record< string, unknown > };
			} ): void;
		}
		const targets: StubTarget[] = [];
		const openWindow = vi.fn( () => true );
		( window as unknown as Record< string, unknown > ).wp = {
			desktop: {
				openWindow,
				dragManager: {
					registerDropTarget: ( target: StubTarget ) => {
						targets.push( target );
						return () => void 0;
					},
				},
			},
		};
		const fetchMock: FetchMock = vi.fn( async () => ( {
			ok: true,
			status: 200,
			json: async () => ( {
				text: 'Handled the drop.',
				toolCalls: [],
				turns: 1,
			} ),
		} ) as unknown as Response );
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fetchMock;

		try {
			const body = makeBody();
			const cleanup = getRender()( body );
			expect( targets ).toHaveLength( 1 );

			const payload = {
				type: 'shortcut',
				data: { kind: 'attachment', ref: '44', title: 'Hornet' },
			};
			// No active agent yet — reject.
			expect( targets[ 0 ].accept( payload ) ).toBe( false );

			openAgentChat( {
				id: 5,
				name: 'Audit Agent',
				description: '',
				avatarUrl: 'data:image/svg+xml;base64,x',
			} );
			expect( targets[ 0 ].accept( payload ) ).toBe( true );
			// Its own user tile is never accepted.
			expect(
				targets[ 0 ].accept( {
					type: 'shortcut',
					data: { kind: 'user', ref: '5', title: 'Audit Agent' },
				} ),
			).toBe( false );

			targets[ 0 ].onDrop( { payload } );
			await flush();

			const invoke = fetchMock.mock.calls.find( ( c ) =>
				String( c[ 0 ] ).includes( '/invoke' ),
			) as [ string, RequestInit ];
			expect( invoke[ 0 ] ).toBe(
				'https://example.test/wp-json/desktop-mode/v1/agents/5/invoke',
			);
			const sent = JSON.parse( String( invoke[ 1 ].body ) ) as {
				message: string;
				source: string;
			};
			expect( sent.source ).toBe( 'drag' );
			expect( sent.message ).toContain( 'Hornet' );
			expect( body.textContent ).toContain( 'Handled the drop.' );

			if ( typeof cleanup === 'function' ) {
				cleanup();
			}
		} finally {
			delete ( window as unknown as Record< string, unknown > ).wp;
		}
	} );

	test( 'call-to-action answers render buttons and pressing one replies', async () => {
		const fetchMock: FetchMock = vi.fn( async ( input: unknown, init?: RequestInit ) => {
			const url = String( input );
			if ( url.includes( '/invoke' ) ) {
				const sent = JSON.parse( String( init?.body ) ) as {
					message: string;
				};
				if ( sent.message === 'Propose the update.' ) {
					return {
						ok: true,
						status: 200,
						json: async () => ( {
							text: 'Approve the TL;DR for post 188?',
							callToActions: [
								{
									id: 'approve',
									label: 'Accept',
									style: 'primary',
									reply: 'Approved. Apply the TL;DR to post 188.',
								},
								{
									id: 'cancel',
									label: 'Cancel',
									style: 'secondary',
									reply: 'Cancelled.',
								},
							],
							toolCalls: [],
							turns: 1,
						} ),
					} as unknown as Response;
				}
				return {
					ok: true,
					status: 200,
					json: async () => ( {
						text: 'Applied.',
						toolCalls: [],
						turns: 1,
					} ),
				} as unknown as Response;
			}
			return {
				ok: true,
				status: 200,
				json: async () => ( {} ),
			} as unknown as Response;
		} );
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fetchMock;

		const body = makeBody();
		const cleanup = getRender()( body );
		openAgentChat( {
			id: 5,
			name: 'TLDR Editor',
			description: '',
			avatarUrl: 'https://example.test/bot.svg',
		} );

		const input = body.querySelector( 'wpd-textarea' ) as HTMLElement & {
			value: string;
		};
		input.value = 'Propose the update.';
		(
			body.querySelector(
				'.dm-agent-chat__composer wpd-button',
			) as HTMLElement
		 ).click();
		await flush();

		// Buttons render under the agent's answer with their variants.
		const buttons = body.querySelectorAll< HTMLElement >(
			'.dm-agent-chat__ctas wpd-button',
		);
		expect( buttons ).toHaveLength( 2 );
		expect( buttons[ 0 ].textContent ).toBe( 'Accept' );
		expect( buttons[ 0 ].getAttribute( 'variant' ) ).toBe( 'primary' );
		expect( buttons[ 0 ].hasAttribute( 'disabled' ) ).toBe( false );

		// Pressing Accept sends the reply as a visible user turn.
		buttons[ 0 ].click();
		await flush();

		const replyCall = fetchMock.mock.calls.find( ( c ) => {
			if ( ! String( c[ 0 ] ).includes( '/invoke' ) ) {
				return false;
			}
			const sent = JSON.parse(
				String( ( c[ 1 ] as RequestInit ).body ),
			) as { message: string };
			return sent.message === 'Approved. Apply the TL;DR to post 188.';
		} );
		expect( replyCall ).toBeTruthy();
		expect( body.textContent ).toContain(
			'Approved. Apply the TL;DR to post 188.',
		);
		expect( body.textContent ).toContain( 'Applied.' );

		// The spent buttons persist but are disabled.
		const spent = body.querySelectorAll< HTMLElement >(
			'.dm-agent-chat__ctas wpd-button',
		);
		expect( spent[ 0 ].hasAttribute( 'disabled' ) ).toBe( true );
		expect(
			agentsChatStore.state.transcripts[ 5 ].some(
				( m ) => m.ctaUsed === true,
			),
		).toBe( true );

		if ( typeof cleanup === 'function' ) {
			cleanup();
		}
	} );

	test( 'the sidebar lists conversations and clicking one loads it', async () => {
		const summary = {
			id: 77,
			agentId: 9,
			agentName: 'Historian',
			agentDescription: 'Remembers things.',
			agentAvatarUrl: 'https://example.test/bot.svg',
			title: 'Summarize post 12',
			preview: '…and search relevance.',
			lastRole: 'agent',
			messageCount: 2,
			createdAt: '2026-07-30T10:00:00Z',
			updatedAt: '2026-07-30T10:05:00Z',
		};
		const fetchMock: FetchMock = vi.fn( async ( input: unknown ) => {
			const url = String( input );
			if ( url.endsWith( '/agents/conversations' ) ) {
				return {
					ok: true,
					status: 200,
					json: async () => [ summary ],
				} as unknown as Response;
			}
			if ( url.endsWith( '/agents/conversations/77' ) ) {
				return {
					ok: true,
					status: 200,
					json: async () => ( {
						...summary,
						messages: [
							{ role: 'user', text: 'Summarize post 12', at: 1 },
							{ role: 'agent', text: 'Done — here it is.', at: 2 },
						],
					} ),
				} as unknown as Response;
			}
			return {
				ok: true,
				status: 200,
				json: async () => ( {} ),
			} as unknown as Response;
		} );
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fetchMock;

		const body = makeBody();
		const cleanup = getRender()( body );
		await flush();

		// The list paints even with no active agent. Two lines: who the
		// conversation is with, and where it got to — NOT the title,
		// which repeats across every conversation that opens the same
		// way. The title stays as the row tooltip.
		const row = body.querySelector< HTMLElement >( '.dm-agent-chat__conv' );
		expect( row ).not.toBeNull();
		expect(
			row!.querySelector( '.dm-agent-chat__conv-name' )!.textContent,
		).toBe( 'Historian' );
		expect(
			row!.querySelector( '.dm-agent-chat__conv-preview' )!.textContent,
		).toBe( '…and search relevance.' );
		const time = row!.querySelector< HTMLTimeElement >(
			'.dm-agent-chat__conv-time',
		)!;
		expect( time.dateTime ).toBe( '2026-07-30T10:05:00Z' );
		expect( time.textContent ).not.toBe( '' );
		expect( row!.title ).toContain( 'Summarize post 12' );

		row!.click();
		await flush();

		// The conversation's agent became active with its transcript.
		expect( agentsChatStore.state.activeAgent?.id ).toBe( 9 );
		expect( agentsChatStore.state.conversationIds[ 9 ] ).toBe( 77 );
		expect( body.textContent ).toContain( 'Historian' );
		expect( body.textContent ).toContain( 'Done — here it is.' );

		if ( typeof cleanup === 'function' ) {
			cleanup();
		}
	} );

	test( 'clicking a conversation avatar opens the agent editor, not the conversation', async () => {
		const summary = {
			id: 77,
			agentId: 9,
			agentName: 'Historian',
			agentDescription: 'Remembers things.',
			agentAvatarUrl: 'https://example.test/bot.svg',
			title: 'Summarize post 12',
			preview: 'Done.',
			lastRole: 'agent',
			messageCount: 2,
			createdAt: '2026-07-30T10:00:00Z',
			updatedAt: '2026-07-30T10:05:00Z',
		};
		const fetchMock: FetchMock = vi.fn( async ( input: unknown ) => ( {
			ok: true,
			status: 200,
			json: async () =>
				String( input ).endsWith( '/agents/conversations' )
					? [ summary ]
					: {},
		} ) as unknown as Response );
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fetchMock;

		const openWindow = vi.fn( () => true );
		( window as unknown as Record< string, unknown > ).wp = {
			desktop: { openWindow },
		};

		try {
			const body = makeBody();
			const cleanup = getRender()( body );
			await flush();

			const avatar = body.querySelector< HTMLElement >(
				'.dm-agent-chat__conv-avatar',
			)!;
			expect( avatar.hasAttribute( 'clickable' ) ).toBe( true );
			avatar.click();
			await flush();

			expect( openWindow ).toHaveBeenCalledWith(
				'desktop-mode-my-wordpress',
				{ source: 'agents/editor' },
			);
			expect( agentEditorTarget.state.agentId ).toBe( 9 );
			// The row's own click handler must NOT have run — the
			// conversation stays closed.
			expect( agentsChatStore.state.activeAgent ).toBeNull();

			if ( typeof cleanup === 'function' ) {
				cleanup();
			}
		} finally {
			clearAgentEditorTarget();
			delete ( window as unknown as Record< string, unknown > ).wp;
		}
	} );

	test( 'a message attachment renders as a card that opens the object', () => {
		const open = vi.fn();
		( window as unknown as Record< string, unknown > ).wp = {
			desktop: {
				config: { adminUrl: 'https://example.test/wp-admin/' },
				deriveWindowId: () => 'post-php-188',
				windowManager: { open },
			},
		};

		try {
			const body = makeBody();
			const cleanup = getRender()( body );
			openAgentChat( {
				id: 5,
				name: 'Audit Agent',
				description: '',
				avatarUrl: 'data:image/svg+xml;base64,x',
			} );
			agentsChatStore.state.transcripts[ 5 ] = [
				{
					role: 'user',
					text: 'The user dropped the post "Hello world" (id 188) onto you.',
					at: 1,
					attachment: { kind: 'post', id: 188, title: 'Hello world' },
				},
			];
			agentsChatStore.notify();

			const card = body.querySelector< HTMLElement >(
				'.dm-agent-chat__attachment',
			)!;
			expect( card ).not.toBeNull();
			expect( card.textContent ).toContain( 'Hello world' );
			// The runner-facing sentence is replaced by the card.
			expect( body.textContent ).not.toContain( 'The user dropped' );

			card.click();
			expect( open ).toHaveBeenCalledWith(
				expect.objectContaining( {
					id: 'post-php-188',
					url: 'https://example.test/wp-admin/post.php?post=188&action=edit',
					title: 'Hello world',
				} ),
			);

			if ( typeof cleanup === 'function' ) {
				cleanup();
			}
		} finally {
			delete ( window as unknown as Record< string, unknown > ).wp;
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
