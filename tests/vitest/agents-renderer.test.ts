/**
 * Vitest — renderer integration for the Agents section.
 *
 * Asserts on the painted DOM after the renderer mounts. Stubs the
 * REST adapter via vi.mock so the renderer's CRUD wiring can be
 * exercised without a real server.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { Agent } from '../../src/my-wordpress/agents-types';

function buildAgent( overrides: Partial< Agent > = {} ): Agent {
	return {
		id: 100,
		slug: 'remove-bg',
		name: 'Remove BG',
		description: 'Removes backgrounds.',
		instructions: 'You are an image processor.',
		role: 'editor',
		guidelineId: 200,
		guidelineLink: '',
		abilities: [ 'media/upload' ],
		triggers: [],
		model: '',
		rateLimit: 0,
		avatarUrl: '',
		...overrides,
	};
}

const stub = vi.hoisted( () => {
	return {
		listAgents: vi.fn(),
		createAgent: vi.fn(),
		updateAgent: vi.fn(),
		deleteAgent: vi.fn(),
		setAbilities: vi.fn(),
		setTriggers: vi.fn(),
		setRole: vi.fn(),
		fetchAbilitiesCatalogue: vi.fn(),
		fetchHooksCatalogue: vi.fn(),
		fetchTriggerKinds: vi.fn(),
		enableGuidelinesExperiment: vi.fn(),
	};
} );

vi.mock( '../../src/my-wordpress/agents-rest', () => stub );

interface WindowConfigSlot {
	'desktop-mode-my-wordpress'?: {
		restRoot: string;
		restNonce: string;
		entities: unknown[];
		perPage: number;
		agentsConfig?: Record< string, unknown >;
	};
}

function installConfig( agentsEnabled: boolean, gutenbergActive = true ): void {
	(
		window as unknown as { desktopModeWindowConfig?: WindowConfigSlot }
	).desktopModeWindowConfig = {
		'desktop-mode-my-wordpress': {
			restRoot: 'https://example.test/wp-json/',
			restNonce: 'test-nonce',
			entities: [],
			perPage: 24,
			agentsConfig: {
				enabled: agentsEnabled,
				gutenbergActive,
				skillTermId: 1,
				restNamespace: 'desktop-mode/v1',
				enableExperimentNonce: 'exp-nonce',
				gutenbergInstallUrl: 'https://example.test/install',
			},
		},
	};
}

function clearConfig(): void {
	delete (
		window as unknown as { desktopModeWindowConfig?: unknown }
	).desktopModeWindowConfig;
}

function makeHost(): { body: HTMLElement; navigate: ReturnType< typeof vi.fn >; addTeardown: ReturnType< typeof vi.fn >; route: { kind: 'list'; entityId: 'agents' } } {
	const body = document.createElement( 'div' );
	document.body.appendChild( body );
	return {
		body,
		navigate: vi.fn(),
		addTeardown: vi.fn(),
		route: { kind: 'list', entityId: 'agents' },
	};
}

async function flush(): Promise< void > {
	// Two ticks — first resolves the renderer's `void ( async () => ... )()`
	// load promise, second resolves the inner `await Promise.all` plus
	// `await listAgents()`.
	await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
}

describe( 'agents-renderer', () => {
	beforeEach( () => {
		installHooksStub();
		document.body.replaceChildren();
		Object.values( stub ).forEach( ( fn ) => fn.mockReset() );
		stub.fetchAbilitiesCatalogue.mockResolvedValue( [
			{
				slug: 'media/upload',
				label: 'Upload media',
				description: 'desc',
			},
		] );
		stub.fetchHooksCatalogue.mockResolvedValue( [] );
		stub.fetchTriggerKinds.mockResolvedValue( [
			{
				slug: 'hook',
				label: 'WordPress hook',
				config_schema: { type: 'object', properties: {} },
			},
		] );
	} );

	afterEach( () => {
		clearConfig();
		clearHooksStub();
		vi.restoreAllMocks();
	} );

	test( 'soft-gate paints when agentsConfig.enabled is false (gutenberg active)', async () => {
		installConfig( false, true );
		const { renderAgentsKind } = await import(
			'../../src/my-wordpress/agents-renderer'
		);
		const host = makeHost();
		renderAgentsKind( host, { id: 'agents', label: 'Agents', icon: '', restPath: '' } );

		const empty = host.body.querySelector( 'wpd-empty-state' );
		expect( empty ).not.toBeNull();
		const buttons = host.body.querySelectorAll( 'wpd-button' );
		expect( buttons.length ).toBeGreaterThanOrEqual( 1 );
		const enableBtn = Array.from( buttons ).find( ( b ) =>
			( b.textContent || '' ).includes( 'Enable Guidelines' ),
		);
		expect( enableBtn ).toBeTruthy();
	} );

	test( 'soft-gate shows Install Gutenberg when Gutenberg is missing', async () => {
		installConfig( false, false );
		const { renderAgentsKind } = await import(
			'../../src/my-wordpress/agents-renderer'
		);
		const host = makeHost();
		renderAgentsKind( host, { id: 'agents', label: 'Agents', icon: '', restPath: '' } );

		const buttons = host.body.querySelectorAll( 'wpd-button' );
		const installBtn = Array.from( buttons ).find( ( b ) =>
			( b.textContent || '' ).includes( 'Install Gutenberg' ),
		);
		expect( installBtn ).toBeTruthy();
	} );

	test( 'empty list paints the "no agents yet" hint and create button', async () => {
		installConfig( true );
		stub.listAgents.mockResolvedValue( [] );
		const { renderAgentsKind } = await import(
			'../../src/my-wordpress/agents-renderer'
		);
		const host = makeHost();
		renderAgentsKind( host, { id: 'agents', label: 'Agents', icon: '', restPath: '' } );
		await flush();

		const hint = host.body.querySelector(
			'.desktop-mode-my-wordpress__agents-empty',
		);
		expect( hint?.textContent ).toContain( 'No agents yet' );

		const createBtn = host.body.querySelector( 'wpd-button[variant="primary"]' );
		expect( createBtn?.textContent ).toContain( 'Create agent' );
	} );

	test( 'populated list paints tile per agent', async () => {
		installConfig( true );
		stub.listAgents.mockResolvedValue( [
			buildAgent( { id: 1, name: 'A', slug: 'a' } ),
			buildAgent( { id: 2, name: 'B', slug: 'b' } ),
		] );
		const { renderAgentsKind } = await import(
			'../../src/my-wordpress/agents-renderer'
		);
		const host = makeHost();
		renderAgentsKind( host, { id: 'agents', label: 'Agents', icon: '', restPath: '' } );
		await flush();

		const tiles = host.body.querySelectorAll( 'wpd-tile' );
		expect( tiles.length ).toBe( 2 );
		expect( tiles[ 0 ].getAttribute( 'label' ) ).toBe( 'A' );
	} );

	test( 'clicking + Create agent flips the right pane into the create form', async () => {
		installConfig( true );
		stub.listAgents.mockResolvedValue( [] );
		const { renderAgentsKind } = await import(
			'../../src/my-wordpress/agents-renderer'
		);
		const host = makeHost();
		renderAgentsKind( host, { id: 'agents', label: 'Agents', icon: '', restPath: '' } );
		await flush();

		const createBtn = host.body.querySelector(
			'wpd-button[variant="primary"]',
		) as HTMLElement;
		createBtn.click();

		const form = host.body.querySelector(
			'.desktop-mode-my-wordpress__agent-create-form',
		);
		expect( form ).not.toBeNull();
	} );

	test( 'clicking a tile selects it and paints the edit panel', async () => {
		installConfig( true );
		stub.listAgents.mockResolvedValue( [
			buildAgent( { id: 11, name: 'Pickme' } ),
		] );
		const { renderAgentsKind } = await import(
			'../../src/my-wordpress/agents-renderer'
		);
		const host = makeHost();
		renderAgentsKind( host, { id: 'agents', label: 'Agents', icon: '', restPath: '' } );
		await flush();

		const tile = host.body.querySelector( 'wpd-tile' ) as HTMLElement;
		tile.click();

		const panel = host.body.querySelector(
			'.desktop-mode-my-wordpress__agent-panel',
		);
		expect( panel ).not.toBeNull();
		const heading = host.body.querySelector( 'h2' );
		expect( heading?.textContent ).toBe( 'Pickme' );
	} );
} );
