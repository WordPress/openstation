/**
 * `/workspace` — desks from the keyboard.
 *
 * One command answers the whole question — switch, save the main desk
 * as a workspace, manage them — and a workspace is never created from
 * a template or a form here: only by saving a desk.
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
	let manage: ReturnType< typeof vi.fn >;
	let saveAs: ReturnType< typeof vi.fn >;
	let restoreMain: ReturnType< typeof vi.fn >;

	beforeEach( () => {
		installHooksStub();
		desktop = document.createElement( 'div' );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
		manage = vi.fn();
		saveAs = vi.fn( () => ( { id: 'desktop-2' } ) );
		restoreMain = vi.fn();
		deps = {
			manager,
			getNavItems: () => [],
			adminUrl: 'http://example.test/wp-admin/',
			deriveWindowId: ( url: string ) => url,
			openNative: vi.fn(),
			refreshLayout: vi.fn(),
		};
		registerWorkspaceCommand( deps, manage, saveAs, undefined, restoreMain );
	} );

	afterEach( () => {
		unregisterCommand( 'workspace' );
		unregisterCommand( 'save-workspace' );
		unregisterCommand( 'keep-desk' );
		unregisterCommand( 'restore-main-desk' );
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

	test( 'with no args it offers desks, then save, manage and keep — no templates', async () => {
		const command = listCommands().find( ( c ) => c.slug === 'workspace' )!;
		const rows = await labels( command.suggest?.( '', ctx() ) );

		expect( rows[ 0 ] ).toBe( 'Main desk' );
		expect( rows.some( ( r ) => r.startsWith( 'New:' ) ) ).toBe( false );
		expect( rows.slice( -3 ) ).toEqual( [
			'Save desk as new workspace',
			'Manage workspaces…',
			'Keep this desk',
		] );
	} );

	test( '/save-workspace saves, and says so when there is nothing to save', () => {
		const command = listCommands().find( ( c ) => c.slug === 'save-workspace' )!;
		const context = ctx();
		expect( command.run( '', context ) ).toBeUndefined();
		expect( saveAs ).toHaveBeenCalled();
		expect( context.close ).toHaveBeenCalled();

		saveAs.mockReturnValue( null );
		expect( String( command.run( '', ctx() ) ) ).toContain( 'no desk to save' );
	} );

	test( 'a desk name switches to that desk', () => {
		const shop = createWorkspace( deps, { label: 'Commerce' } );
		manager.switchDesktop( manager.getDesktops()[ 0 ].id );
		const command = listCommands().find( ( c ) => c.slug === 'workspace' )!;
		const before = manager.getDesktops().length;

		command.run( 'commerce', ctx() );

		// Switched, never created.
		expect( manager.getDesktops() ).toHaveLength( before );
		expect( manager.getActiveDesktopId() ).toBe( shop.id );
	} );

	test( '/restore-main-desk hands off to the restore, which asks first', () => {
		const command = listCommands().find( ( c ) => c.slug === 'restore-main-desk' )!;
		command.run( '', ctx() );
		expect( restoreMain ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'the manage row opens the Workspaces app on the current desk', () => {
		const command = listCommands().find( ( c ) => c.slug === 'workspace' )!;
		command.run( 'Manage workspaces', ctx() );
		expect( manage ).toHaveBeenCalledWith( manager.getActiveDesktopId() );
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
