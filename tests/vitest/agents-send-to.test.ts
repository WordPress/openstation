/**
 * Unit tests for `src/my-wordpress/agents-send-to.ts` — the "Send to
 * <agent>" tile-context-menu intake: kind mapping, entityKinds gating,
 * and the dispatch a pick performs.
 */
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import { applyFilters } from '../../src/hooks';
import { agentsChatStore } from '../../src/agents-chat-store';
import { installHooksStub } from './helpers/hooks-stub';

// The module registers its filter at import time, which requires a
// live `window.wp.hooks` bus — install the stub first, then import.
let sendTo: typeof import( '../../src/my-wordpress/agents-send-to' );

beforeAll( async () => {
	installHooksStub();
	sendTo = await import( '../../src/my-wordpress/agents-send-to' );
	sendTo.registerSendToMenuFilter();
} );

const FILTER = 'os.my-wordpress.tile-context-menu';

type FetchMock = ReturnType< typeof vi.fn >;

interface MenuOption {
	id: string;
	label: string;
	icon: string;
	onSelect?: ( () => void ) | null;
}

function agentRow( over: Record< string, unknown > ): Record< string, unknown > {
	return {
		id: 1,
		slug: 'agent',
		name: 'Agent',
		description: '',
		instructions: '',
		role: 'editor',
		abilities: [],
		triggers: [],
		model: '',
		rateLimit: 10,
		avatarUrl: 'https://example.test/bot.svg',
		...over,
	};
}

const AGENTS = [
	agentRow( {
		id: 11,
		name: 'Post Only',
		triggers: [ { kind: 'send-to', config: { entityKinds: [ 'post' ] } } ],
	} ),
	agentRow( {
		id: 12,
		name: 'Everything',
		triggers: [ { kind: 'send-to', config: { entityKinds: [] } } ],
	} ),
	agentRow( {
		id: 13,
		name: 'No Send To',
		triggers: [ { kind: 'drag', config: { entityKinds: [] } } ],
	} ),
];

function installConfig( overrides: Record< string, unknown > = {} ): void {
	// The intake reads the SHELL config (`wp.os.config`) for its REST
	// root + nonce; whether the agents routes exist arrives from the
	// explorer app's payload via `setSendToEnabled()`.
	const w = window as unknown as { wp?: { os?: Record< string, unknown > } };
	w.wp = w.wp ?? {};
	( w.wp as { os?: Record< string, unknown > } ).os = {
		...( ( w.wp as { os?: Record< string, unknown > } ).os ?? {} ),
		config: {
			restUrl: 'https://example.test/wp-json/',
			restNonce: 'test-nonce',
		},
	};
	sendTo.setSendToEnabled( overrides.enabled !== false );
}

function stubListFetch(): FetchMock {
	const fn = vi.fn( async ( input: unknown, init?: RequestInit ) => {
		const url = String( input );
		if ( url.includes( '/agents/' ) && init?.method === 'POST' ) {
			return {
				ok: true,
				status: 200,
				json: async () => ( { text: 'Done.', toolCalls: [], turns: 1 } ),
			} as unknown as Response;
		}
		return {
			ok: true,
			status: 200,
			headers: { get: () => String( AGENTS.length ) },
			json: async () => AGENTS,
		} as unknown as Response;
	} );
	( globalThis as unknown as { fetch: FetchMock } ).fetch = fn;
	return fn;
}

async function flush(): Promise< void > {
	await Promise.resolve();
	await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
}

function runFilter(
	ctx: { entityId: string; kind: string; item: Record< string, unknown > },
): MenuOption[] {
	const base: MenuOption[] = [
		{ id: 'open', label: 'Open in editor', icon: 'dashicons-edit' },
	];
	const out = applyFilters< MenuOption[], [ typeof ctx ] >(
		FILTER,
		base,
		ctx,
	);
	return Array.isArray( out ) ? out : base;
}

beforeEach( async () => {
	installConfig();
	stubListFetch();
	agentsChatStore.state.activeAgent = null;
	agentsChatStore.state.transcripts = {};
	sendTo.refreshSendToAgents();
	await sendTo.warmSendToAgents();
	await flush();
} );

afterEach( () => {
	vi.restoreAllMocks();
	delete ( window as unknown as Record< string, unknown > )
		.openStationWindowConfig;
} );

describe( 'agents send-to menu', () => {
	test( 'does not warm while the framework is off', async () => {
		// The section config now ships even with the `agents` extended
		// option off, so the tile stays visible — `enabled` is what
		// says the REST routes exist.
		installConfig( { enabled: false } );
		const fetchMock = stubListFetch();
		sendTo.refreshSendToAgents();
		await sendTo.warmSendToAgents();
		await flush();

		expect( fetchMock ).not.toHaveBeenCalled();
		expect( sendTo.sendToTargetsFor( 'post' ) ).toEqual( [] );
	} );

	test( 'maps menu contexts onto trigger entity kinds', () => {
		expect(
			sendTo.entityKindForMenuCtx( { entityId: 'posts', kind: 'post' } ),
		).toBe( 'post' );
		expect(
			sendTo.entityKindForMenuCtx( { entityId: 'pages', kind: 'post' } ),
		).toBe( 'page' );
		expect(
			sendTo.entityKindForMenuCtx( { entityId: 'media', kind: 'attachment' } ),
		).toBe( 'media' );
		expect(
			sendTo.entityKindForMenuCtx( { entityId: 'users', kind: 'user' } ),
		).toBe( 'user' );
		expect(
			sendTo.entityKindForMenuCtx( { entityId: 'comments', kind: 'comment' } ),
		).toBeNull();
	} );

	test( 'gates targets by the send-to trigger entityKinds', () => {
		expect( sendTo.sendToTargetsFor( 'post' ).map( ( a ) => a.id ) ).toEqual( [
			11, 12,
		] );
		// Empty entityKinds = every kind; agents without a send-to
		// trigger never appear.
		expect( sendTo.sendToTargetsFor( 'media' ).map( ( a ) => a.id ) ).toEqual( [
			12,
		] );
	} );

	test( 'registering twice never duplicates menu entries', () => {
		// The bundle IIFE can execute twice (boot enqueue + lazy window
		// loader) — registration must be idempotent on the hooks bus.
		sendTo.registerSendToMenuFilter();
		const options = runFilter( {
			entityId: 'posts',
			kind: 'post',
			item: { id: 7, title: { rendered: 'Hello' } },
		} );
		expect(
			options.filter( ( o ) => o.id === 'agent-send-to-11' ),
		).toHaveLength( 1 );
	} );

	test( 'appends Send to entries to a post tile menu', () => {
		const options = runFilter( {
			entityId: 'posts',
			kind: 'post',
			item: { id: 7, title: { rendered: 'Hello &amp; more' } },
		} );
		expect( options.map( ( o ) => o.id ) ).toEqual( [
			'open',
			'agent-send-to-11',
			'agent-send-to-12',
		] );
		expect( options[ 1 ].label ).toBe( 'Send to Post Only' );
	} );

	test( 'leaves menus for unmapped kinds untouched', () => {
		const options = runFilter( {
			entityId: 'comments',
			kind: 'comment',
			item: { id: 3 },
		} );
		expect( options.map( ( o ) => o.id ) ).toEqual( [ 'open' ] );
	} );

	test( 'a pick invokes the agent with source send-to and opens the chat', async () => {
		const openWindow = vi.fn( () => true );
		const wpBag = ( window as unknown as {
			wp: Record< string, unknown >;
		} ).wp;
		wpBag.os = { openWindow };
		const fetchMock = stubListFetch();

		try {
			const options = runFilter( {
				entityId: 'media',
				kind: 'attachment',
				item: { id: 44, title: { rendered: 'Hornet' } },
			} );
			const entry = options.find(
				( o ) => o.id === 'agent-send-to-12',
			) as MenuOption;
			entry.onSelect?.();
			await flush();

			expect( openWindow ).toHaveBeenCalledWith(
				'desktop-mode-agent-run',
				{ source: 'agents-send-to' },
			);
			const invoke = fetchMock.mock.calls.find( ( c ) =>
				String( c[ 0 ] ).includes( '/agents/12/invoke' ),
			) as [ string, RequestInit ];
			expect( invoke ).toBeTruthy();
			const sent = JSON.parse( String( invoke[ 1 ].body ) ) as {
				message: string;
				source: string;
			};
			expect( sent.source ).toBe( 'send-to' );
			expect( sent.message ).toContain( 'Hornet' );
			expect( sent.message ).toContain( 'Send to' );
			expect(
				agentsChatStore.state.transcripts[ 12 ]?.length,
			).toBeGreaterThan( 0 );
		} finally {
			delete wpBag.os;
		}
	} );
} );
