/**
 * `/workspace` — the switcher from the keyboard.
 *
 * The pill sits under the window layer by design, so this command is
 * the route that still works with something maximized over it. What
 * matters here is that one command answers the whole question — switch,
 * create, edit — and that "commerce" lands on the Commerce *desk*
 * rather than on "New: Commerce" when both are in the list.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { listCommands, unregisterCommand } from '../../src/commands';
import type { CommandContext, CommandSuggestion } from '../../src/commands';
import {
	createWorkspace,
	registerWorkspaceCommand,
	type WorkspaceDeps,
} from '../../src/workspaces';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

function ctx(): CommandContext {
	return {
		close: vi.fn(),
		openInWindow: vi.fn(),
		confirm: vi.fn().mockResolvedValue( true ),
	} as unknown as CommandContext;
}

/** Labels from a `suggest()` result, which may be a promise. */
async function labels(
	result: CommandSuggestion[] | Promise< CommandSuggestion[] > | undefined,
): Promise< string[] > {
	return ( ( await result ) ?? [] ).map( ( s ) => s.label );
}

describe( '/workspace', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;
	let deps: WorkspaceDeps;
	let edit: ReturnType< typeof vi.fn >;

	beforeEach( () => {
		installHooksStub();
		desktop = document.createElement( 'div' );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
		edit = vi.fn();
		deps = {
			manager,
			getNavItems: () => [],
			adminUrl: 'http://example.test/wp-admin/',
			deriveWindowId: ( url: string ) => url,
			openNative: vi.fn(),
			refreshLayout: vi.fn(),
		};
		registerWorkspaceCommand( deps, edit );
	} );

	afterEach( () => {
		unregisterCommand( 'workspace' );
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
		vi.restoreAllMocks();
	} );

	test( 'it registers once, under one slug', () => {
		const mine = listCommands().filter( ( c ) => c.slug === 'workspace' );
		expect( mine ).toHaveLength( 1 );
		expect( mine[ 0 ].label ).toBe( 'Workspace' );
	} );

	test( 'with no args it offers desks, then templates, then the editor', async () => {
		const command = listCommands().find( ( c ) => c.slug === 'workspace' )!;
		const rows = await labels( command.suggest?.( '', ctx() ) );

		expect( rows[ 0 ] ).toBe( 'Desktop 1' );
		expect( rows ).toContain( 'New: Commerce' );
		expect( rows ).toContain( 'New: Learning' );
		expect( rows ).toContain( 'New: Publishing' );
		expect( rows.at( -1 ) ).toBe( 'Edit this workspace…' );
	} );

	test( 'running a template name creates and enters that desk', () => {
		const command = listCommands().find( ( c ) => c.slug === 'workspace' )!;
		const before = manager.getDesktops().length;

		command.run( 'New: Publishing', ctx() );

		expect( manager.getDesktops() ).toHaveLength( before + 1 );
		const active = manager.getActiveDesktop();
		expect( active.label ).toBe( 'Publishing' );
		expect( active.profile?.preset ).toBe( 'publishing' );
	} );

	test( 'an existing desk wins over the template of the same name', () => {
		const shop = createWorkspace( deps, { preset: 'commerce' } );
		manager.switchDesktop( manager.getDesktops()[ 0 ].id );
		const command = listCommands().find( ( c ) => c.slug === 'workspace' )!;
		const before = manager.getDesktops().length;

		command.run( 'commerce', ctx() );

		// Switched, not created: "/workspace commerce" when a Commerce
		// desk already exists means "take me there".
		expect( manager.getDesktops() ).toHaveLength( before );
		expect( manager.getActiveDesktopId() ).toBe( shop.id );
	} );

	test( 'the editor row opens the editor on the current desk', () => {
		const command = listCommands().find( ( c ) => c.slug === 'workspace' )!;
		command.run( 'Edit this workspace', ctx() );
		expect( edit ).toHaveBeenCalledWith( manager.getActiveDesktopId() );
	} );

	test( 'no match reports it instead of guessing', () => {
		const command = listCommands().find( ( c ) => c.slug === 'workspace' )!;
		const result = command.run( 'nothing-like-this', ctx() );
		expect( String( result ) ).toContain( 'No workspace matching' );
	} );

	test( 'bare invocation explains itself rather than acting', () => {
		const command = listCommands().find( ( c ) => c.slug === 'workspace' )!;
		const before = manager.getDesktops().length;
		const result = command.run( '   ', ctx() );
		expect( String( result ) ).toContain( 'Type a workspace name' );
		expect( manager.getDesktops() ).toHaveLength( before );
	} );
} );
