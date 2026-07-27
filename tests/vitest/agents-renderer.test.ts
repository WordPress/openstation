/**
 * Unit tests for `src/my-wordpress/agents-renderer.ts` — the `agent`
 * entity-kind registration and the list/empty/detail paints.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import '../../src/my-wordpress/agents-renderer';
import { getEntityRenderer } from '../../src/my-wordpress/kind-registry';
import type { EntityRenderHost } from '../../src/my-wordpress/kind-registry';
import type { MyWordPressEntity } from '../../src/my-wordpress/types';
import type { Agent } from '../../src/my-wordpress/agents-types';

const WINDOW_ID = 'desktop-mode-my-wordpress';

const ENTITY: MyWordPressEntity = {
	id: 'agents',
	label: 'Agents',
	icon: 'data:image/svg+xml;base64,x',
	restPath: 'desktop-mode/v1/agents',
	kind: 'agent',
};

const AGENT: Agent = {
	id: 12,
	slug: 'audit',
	name: 'Audit Agent',
	description: 'Audits drafts.',
	instructions: 'Audit the post.',
	role: 'author',
	abilities: [ 'desktop-mode/get-post' ],
	triggers: [],
	model: '',
	rateLimit: 0,
	avatarUrl: 'data:image/svg+xml;base64,x',
};

type FetchMock = ReturnType< typeof vi.fn >;

function installConfig( overrides: Record< string, unknown > = {} ): void {
	( window as unknown as Record< string, unknown > ).desktopModeWindowConfig = {
		[ WINDOW_ID ]: {
			restRoot: 'https://example.test/wp-json/',
			restNonce: 'test-nonce',
			entities: [ ENTITY ],
			perPage: 24,
			editPostUrlBase: '',
			agents: {
				canManage: true,
				canInvoke: true,
				aiAvailable: false,
				aiStatusUrl: '',
				connectorsUrl: 'https://example.test/wp-admin/options-connectors.php',
				runWindowId: 'desktop-mode-agent-run',
				...overrides,
			},
		},
	};
}

function mockAgentList( agents: Agent[] ): FetchMock {
	const fn = vi.fn( async () => ( {
		ok: true,
		status: 200,
		json: async () => agents,
	} ) as unknown as Response );
	( globalThis as unknown as { fetch: FetchMock } ).fetch = fn;
	return fn;
}

function makeHost(): EntityRenderHost & { teardowns: Array< () => void > } {
	const body = document.createElement( 'div' );
	document.body.appendChild( body );
	const teardowns: Array< () => void > = [];
	return {
		body,
		route: { kind: 'list', entityId: 'agents' },
		navigate: () => void 0,
		addTeardown: ( fn: () => void ) => teardowns.push( fn ),
		teardowns,
	};
}

async function flush(): Promise< void > {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
}

beforeEach( () => {
	installConfig();
} );

afterEach( () => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
	delete ( window as unknown as Record< string, unknown > )
		.desktopModeWindowConfig;
} );

describe( 'agents entity kind', () => {
	test( 'registers the `agent` kind in the registry', () => {
		expect( getEntityRenderer( 'agent' ) ).toBeTypeOf( 'function' );
	} );

	test( 'paints the agent list with name, description, and role', async () => {
		mockAgentList( [ AGENT ] );
		const host = makeHost();

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();

		const row = host.body.querySelector( '.dm-agents__row' );
		expect( row ).not.toBeNull();
		expect( row!.textContent ).toContain( 'Audit Agent' );
		expect( row!.textContent ).toContain( 'Audits drafts.' );
		expect( row!.textContent ).toContain( 'author' );
	} );

	test( 'selecting an agent shows the Define pane with its fields', async () => {
		mockAgentList( [ AGENT ] );
		const host = makeHost();

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();

		// First agent auto-selects; the detail head + tabs paint.
		expect(
			host.body.querySelector( '.dm-agents__detail-head' ),
		).not.toBeNull();
		const tabs = Array.from(
			host.body.querySelectorAll( '.dm-agents__tab' ),
		).map( ( el ) => el.textContent?.trim() );
		expect( tabs ).toEqual( [ 'Define', 'Tools', 'Triggers' ] );

		const nameField = host.body.querySelector( 'wpd-text-field' );
		expect( nameField?.getAttribute( 'value' ) ).toBe( 'Audit Agent' );
	} );

	test( 'empty list paints the empty state with a create CTA', async () => {
		mockAgentList( [] );
		const host = makeHost();

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();

		expect( host.body.querySelector( 'wpd-empty-state' ) ).not.toBeNull();
		const create = host.body.querySelector( '.dm-agents__create' );
		expect( create ).not.toBeNull();
	} );

	test( 'without manage capability there is no create button', async () => {
		installConfig( { canManage: false } );
		mockAgentList( [] );
		const host = makeHost();

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();

		expect( host.body.querySelector( '.dm-agents__create' ) ).toBeNull();
	} );

	test( 'missing AI client paints the warning notice', async () => {
		mockAgentList( [ AGENT ] );
		const host = makeHost();

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();

		const notice = host.body.querySelector( 'wpd-notice' );
		expect( notice ).not.toBeNull();
		expect( notice!.textContent ).toContain( 'AI Client' );
	} );

	test( 'list REST failures paint the error notice', async () => {
		const fn = vi.fn( async () => ( {
			ok: false,
			status: 500,
			json: async () => ( { message: 'kaboom' } ),
		} ) as unknown as Response );
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fn;
		const host = makeHost();

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();

		expect( host.body.textContent ).toContain( 'kaboom' );
	} );
} );
