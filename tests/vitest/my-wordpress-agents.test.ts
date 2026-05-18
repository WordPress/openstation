/**
 * Agents (UX mock) — invariants on the mock data and a smoke test that
 * the renderer paints without throwing.
 */
import { describe, expect, test } from 'vitest';
import {
	BOT_ICON_DATA_URI,
	BOT_ICON_SVG,
	MOCK_ABILITIES,
	MOCK_AGENT_COUNT,
	MOCK_AGENTS,
	type AgentTriggerKind,
} from '../../src/my-wordpress/agents-mock';
import { renderAgentsKind } from '../../src/my-wordpress/agents-renderer';

describe( 'my-wordpress agents mock data', () => {
	test( 'exports exactly the four planned agents', () => {
		const ids = MOCK_AGENTS.map( ( a ) => a.id );
		expect( ids ).toEqual( [
			'remove-bg',
			'optimize-seo',
			'send-to-mail-list',
			'moderate-comments',
		] );
	} );

	test( 'every agent has a non-empty name, description, prompt', () => {
		for ( const agent of MOCK_AGENTS ) {
			expect( agent.name.length ).toBeGreaterThan( 0 );
			expect( agent.description.length ).toBeGreaterThan( 0 );
			expect( agent.systemPrompt.length ).toBeGreaterThan( 0 );
		}
	} );

	test( 'MOCK_AGENT_COUNT mirrors MOCK_AGENTS.length', () => {
		expect( MOCK_AGENT_COUNT ).toBe( MOCK_AGENTS.length );
	} );

	test( 'BOT_ICON_DATA_URI is a base64-encoded SVG data URI', () => {
		expect( BOT_ICON_DATA_URI ).toMatch(
			/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/,
		);
		// Round-trip the payload back to verify it matches the source SVG.
		const payload = BOT_ICON_DATA_URI.slice(
			'data:image/svg+xml;base64,'.length,
		);
		expect( atob( payload ) ).toBe( BOT_ICON_SVG );
		// Sanity: the SVG opens and closes cleanly.
		expect( BOT_ICON_SVG ).toMatch( /^<svg / );
		expect( BOT_ICON_SVG.endsWith( '</svg>' ) ).toBe( true );
	} );

	test( 'every tool slug on an agent is in the abilities catalogue', () => {
		const known = new Set( MOCK_ABILITIES.map( ( a ) => a.slug ) );
		for ( const agent of MOCK_AGENTS ) {
			for ( const slug of agent.toolSlugs ) {
				expect( known.has( slug ) ).toBe( true );
			}
		}
	} );

	test( 'no agent ships duplicate tool slugs', () => {
		for ( const agent of MOCK_AGENTS ) {
			expect( new Set( agent.toolSlugs ).size ).toBe(
				agent.toolSlugs.length,
			);
		}
	} );

	test( 'every agent has at least one trigger', () => {
		for ( const agent of MOCK_AGENTS ) {
			expect( agent.triggers.length ).toBeGreaterThan( 0 );
		}
	} );

	test( 'collectively the agents exercise every trigger kind', () => {
		const seen = new Set< AgentTriggerKind >();
		for ( const agent of MOCK_AGENTS ) {
			for ( const trigger of agent.triggers ) {
				seen.add( trigger.kind );
			}
		}
		// The mock is meant to showcase the full trigger surface;
		// `agent` (agent-to-agent) is the only kind we haven't
		// modelled yet — so 4 of the 5 should appear at least once.
		expect( seen.has( 'drag' ) ).toBe( true );
		expect( seen.has( 'chat' ) ).toBe( true );
		expect( seen.has( 'hook' ) ).toBe( true );
		expect( seen.has( 'endpoint' ) ).toBe( true );
	} );

	test( 'every ability slug uses the namespace/verb shape', () => {
		for ( const ability of MOCK_ABILITIES ) {
			expect( ability.slug ).toMatch( /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/ );
		}
	} );

	test( 'abilities catalogue has no duplicate slugs', () => {
		const slugs = MOCK_ABILITIES.map( ( a ) => a.slug );
		expect( new Set( slugs ).size ).toBe( slugs.length );
	} );
} );

describe( 'renderAgentsKind', () => {
	test( 'paints the split layout + tiles + create button into host body', () => {
		const body = document.createElement( 'div' );
		const teardowns: Array< () => void > = [];
		renderAgentsKind(
			{
				body,
				route: { kind: 'list', entityId: 'agents' },
				navigate: () => {
					/* noop */
				},
				addTeardown: ( fn ) => teardowns.push( fn ),
			},
			{
				id: 'agents',
				label: 'Agents',
				icon: BOT_ICON_DATA_URI,
				restPath: '',
				kind: 'agents',
			},
		);

		const split = body.querySelector( '.desktop-mode-my-wordpress__split' );
		expect( split ).not.toBeNull();

		const tiles = body.querySelectorAll(
			'.desktop-mode-my-wordpress__agent-tile',
		);
		expect( tiles.length ).toBe( MOCK_AGENTS.length );

		// Every tile shares the bot glyph — the user explicitly
		// wanted "the same icon" across every agent inside the folder.
		for ( const tile of Array.from( tiles ) ) {
			expect( tile.getAttribute( 'icon' ) ).toBe( BOT_ICON_DATA_URI );
		}

		const createBtn = body.querySelector(
			'.desktop-mode-my-wordpress__agents-create wpd-button',
		);
		expect( createBtn ).not.toBeNull();
		expect( createBtn?.getAttribute( 'variant' ) ).toBe( 'primary' );
	} );

	test( 'clicking a tile selects it and reveals the detail panel', () => {
		const body = document.createElement( 'div' );
		renderAgentsKind(
			{
				body,
				route: { kind: 'list', entityId: 'agents' },
				navigate: () => {},
				addTeardown: () => {},
			},
			{
				id: 'agents',
				label: 'Agents',
				icon: '',
				restPath: '',
				kind: 'agents',
			},
		);

		// No detail panel paints until a tile is clicked.
		expect(
			body.querySelector( '.desktop-mode-my-wordpress__agent-panel' ),
		).toBeNull();

		const firstTile = body.querySelector< HTMLElement >(
			'.desktop-mode-my-wordpress__agent-tile',
		);
		expect( firstTile ).not.toBeNull();
		firstTile?.click();

		const panel = body.querySelector(
			'.desktop-mode-my-wordpress__agent-panel',
		);
		expect( panel ).not.toBeNull();
		expect( ( panel as HTMLElement ).dataset.agentId ).toBe(
			MOCK_AGENTS[ 0 ].id,
		);

		// Tools section paints one row per ability — selected ones
		// carry the `--on` modifier.
		const rows = panel?.querySelectorAll(
			'.desktop-mode-my-wordpress__agent-tools-row',
		);
		expect( rows?.length ).toBe( MOCK_ABILITIES.length );
		const onRows = panel?.querySelectorAll(
			'.desktop-mode-my-wordpress__agent-tools-row--on',
		);
		expect( onRows?.length ).toBe( MOCK_AGENTS[ 0 ].toolSlugs.length );
	} );
} );
