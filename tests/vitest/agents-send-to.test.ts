/**
 * Vitest — Agents send-to store + shared menu helper.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

const INIT_CONFIG = {
	restRoot: 'https://example.test/wp-json/',
	restNonce: 'test-nonce',
};

describe( 'agents-send-to', () => {
	beforeEach( () => {
		installHooksStub();
		vi.resetModules();
	} );
	afterEach( () => {
		clearHooksStub();
		vi.restoreAllMocks();
		document.body.replaceChildren();
	} );

	test( 'init() seeds the cache from initialTargets', async () => {
		const mod = await import( '../../src/agents-send-to' );
		mod.init( {
			...INIT_CONFIG,
			initialTargets: [
				{
					id: 1,
					slug: 'alpha',
					name: 'Alpha',
					avatarUrl: '',
					entityKinds: [ 'post', 'page' ],
				},
				{
					id: 2,
					slug: 'beta',
					name: 'Beta',
					avatarUrl: '',
					entityKinds: [ 'media' ],
				},
			],
		} );

		expect( mod.getTargetsForKind( 'post' ).map( ( t ) => t.name ) ).toEqual( [ 'Alpha' ] );
		expect( mod.getTargetsForKind( 'media' ).map( ( t ) => t.name ) ).toEqual( [ 'Beta' ] );
		expect( mod.getTargetsForKind( 'comment' ) ).toEqual( [] );
	} );

	test( 'attachSendToOption() appends a single Send-to parent with has-children', async () => {
		const mod = await import( '../../src/agents-send-to' );
		mod.init( {
			...INIT_CONFIG,
			initialTargets: [
				{
					id: 7,
					slug: 'remove-bg',
					name: 'Remove BG',
					avatarUrl: '',
					entityKinds: [ 'media' ],
				},
			],
		} );

		const menu = document.createElement( 'wpd-context-menu' );
		document.body.appendChild( menu );
		mod.attachSendToOption( menu, {
			entityId: 'media',
			kind: 'media',
			item: { id: 99 },
		} );

		const options = menu.querySelectorAll( 'wpd-context-menu-option' );
		expect( options.length ).toBe( 1 );
		expect( options[ 0 ].hasAttribute( 'has-children' ) ).toBe( true );
		expect( options[ 0 ].textContent ).toContain( 'Send to' );
	} );

	test( 'attachSendToOption() is a no-op when no target matches the kind', async () => {
		const mod = await import( '../../src/agents-send-to' );
		mod.init( {
			...INIT_CONFIG,
			initialTargets: [
				{
					id: 1,
					slug: 'a',
					name: 'A',
					avatarUrl: '',
					entityKinds: [ 'post' ],
				},
			],
		} );

		const menu = document.createElement( 'wpd-context-menu' );
		document.body.appendChild( menu );
		mod.attachSendToOption( menu, {
			entityId: 'users',
			kind: 'user',
			item: { id: 5 },
		} );
		expect( menu.querySelectorAll( 'wpd-context-menu-option' ).length ).toBe( 0 );
	} );

	test( 'pushAgentToCache() updates the cache when triggers change', async () => {
		const mod = await import( '../../src/agents-send-to' );
		mod.init( {
			...INIT_CONFIG,
			initialTargets: [],
		} );
		expect( mod.getTargetsForKind( 'post' ) ).toEqual( [] );

		mod.pushAgentToCache( {
			id: 42,
			slug: 'newby',
			name: 'Newby',
			avatarUrl: '',
			triggers: [
				{
					kind: 'send-to',
					config: { entityKinds: [ 'post', 'comment' ] },
				},
			],
		} );

		expect( mod.getTargetsForKind( 'post' ).map( ( t ) => t.id ) ).toEqual( [ 42 ] );
		expect( mod.getTargetsForKind( 'comment' ).map( ( t ) => t.id ) ).toEqual( [ 42 ] );
	} );

	test( 'pushAgentToCache() removes the agent when no send-to trigger remains', async () => {
		const mod = await import( '../../src/agents-send-to' );
		mod.init( {
			...INIT_CONFIG,
			initialTargets: [
				{
					id: 7,
					slug: 'will-go',
					name: 'WillGo',
					avatarUrl: '',
					entityKinds: [ 'post' ],
				},
			],
		} );

		mod.pushAgentToCache( {
			id: 7,
			slug: 'will-go',
			name: 'WillGo',
			avatarUrl: '',
			triggers: [], // No send-to.
		} );

		expect( mod.getTargetsForKind( 'post' ) ).toEqual( [] );
	} );

	test( 'dispatchSendTo() fires the action with the right payload', async () => {
		const mod = await import( '../../src/agents-send-to' );
		mod.init( { ...INIT_CONFIG, initialTargets: [] } );

		const hooks = await import( '../../src/hooks' );
		const spy = vi.fn();
		hooks.addAction(
			'desktop-mode.agent.send-to',
			'test/spy',
			( ( ...args: unknown[] ) => spy( ...args ) ) as ( ...args: unknown[] ) => void,
		);

		mod.dispatchSendTo(
			{
				id: 1,
				slug: 'a',
				name: 'A',
				avatarUrl: '',
				entityKinds: [ 'post' ],
			},
			{
				entityId: 'posts',
				kind: 'post',
				item: { id: 314, title: { rendered: 'Hello' } },
			},
		);

		expect( spy ).toHaveBeenCalledTimes( 1 );
		const [ payload ] = spy.mock.calls[ 0 ];
		expect( ( payload as { target: { id: number } } ).target.id ).toBe( 1 );
		expect( ( payload as { entityKind: string } ).entityKind ).toBe( 'post' );
		hooks.removeAction( 'desktop-mode.agent.send-to', 'test/spy' );
	} );

	test( 'openSendToOnlyMenu() returns false and paints nothing when no targets match', async () => {
		const mod = await import( '../../src/agents-send-to' );
		mod.init( { ...INIT_CONFIG, initialTargets: [] } );

		const opened = mod.openSendToOnlyMenu(
			{ entityId: 'posts', kind: 'post', item: { id: 1 } },
			{ x: 10, y: 10 },
		);
		expect( opened ).toBe( false );
		expect( document.querySelectorAll( '.desktop-mode-agent-send-to-host' ).length ).toBe(
			0,
		);
	} );

	test( 'openSendToOnlyMenu() mounts a context menu with the Send-to option when targets match', async () => {
		const mod = await import( '../../src/agents-send-to' );
		mod.init( {
			...INIT_CONFIG,
			initialTargets: [
				{
					id: 11,
					slug: 'audit',
					name: 'Audit',
					avatarUrl: '',
					entityKinds: [ 'post' ],
				},
			],
		} );

		const opened = mod.openSendToOnlyMenu(
			{ entityId: 'posts', kind: 'post', item: { id: 1 } },
			{ x: 10, y: 10 },
		);
		expect( opened ).toBe( true );
		const host = document.querySelector(
			'.desktop-mode-agent-send-to-host',
		) as HTMLElement | null;
		expect( host ).toBeTruthy();
		expect(
			host?.querySelector( 'wpd-context-menu-option[data-menu-item-id="desktop-mode-agent-send-to"]' ),
		).toBeTruthy();
	} );
} );
