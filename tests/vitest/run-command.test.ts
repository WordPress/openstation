/**
 * Unit tests for the AI assistant's `run_command` dispatch —
 * `matchCommandByIntent()` + `runCommandByIntent()` in `src/commands.ts`.
 *
 * The server emits a `tool_call` with `{ slug: '__run_command__', args }`;
 * the browser resolves that natural-language intent against the command
 * registry and runs the best match. These cover the matcher's ranking and
 * the runner's success + no-match paths.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	registerCommand,
	unregisterCommand,
	matchCommandByIntent,
	runCommandByIntent,
	type CommandContext,
} from '../../src/commands';

const CTX: CommandContext = {
	close: () => {},
	openInWindow: () => {},
	confirm: async () => true,
};

const SLUGS = [ 'global-add-new-post', 'global-all-posts', 'global-manage-plugins', 'global-switch-theme', 'global-new-entry' ];

function seed(): void {
	registerCommand( { slug: 'global-add-new-post', label: 'Add new post', run: () => {} } );
	registerCommand( { slug: 'global-all-posts', label: 'All posts', run: () => {} } );
	registerCommand( { slug: 'global-manage-plugins', label: 'Manage plugins', run: () => {} } );
	registerCommand( { slug: 'global-switch-theme', label: 'Switch theme', run: () => {} } );
}

afterEach( () => {
	for ( const s of SLUGS ) {
		unregisterCommand( s );
	}
} );

describe( 'matchCommandByIntent', () => {
	test( 'ranks the closest command by token overlap', () => {
		seed();
		expect( matchCommandByIntent( 'create a new post' )?.slug ).toBe( 'global-add-new-post' );
		expect( matchCommandByIntent( 'take me to plugins' )?.slug ).toBe( 'global-manage-plugins' );
		expect( matchCommandByIntent( 'switch the theme' )?.slug ).toBe( 'global-switch-theme' );
	} );

	test( 'returns null when nothing overlaps', () => {
		seed();
		expect( matchCommandByIntent( 'order a pizza' ) ).toBeNull();
		expect( matchCommandByIntent( '' ) ).toBeNull();
	} );
} );

describe( 'runCommandByIntent', () => {
	test( 'runs the matched command', async () => {
		const run = vi.fn( () => 'done' );
		registerCommand( { slug: 'global-manage-plugins', label: 'Manage plugins', run } );
		registerCommand( { slug: 'global-add-new-post', label: 'Add new post', run: () => {} } );

		const result = await runCommandByIntent( 'manage my plugins', CTX );
		expect( run ).toHaveBeenCalledTimes( 1 );
		expect( result ).toBe( 'done' );
	} );

	test( 'returns an error envelope when no command matches', async () => {
		seed();
		const result = await runCommandByIntent( 'order a pizza', CTX );
		expect( result ).toHaveProperty( 'error' );
	} );

	test( 'passes the raw intent through as args', async () => {
		const run = vi.fn( () => {} );
		registerCommand( { slug: 'global-manage-plugins', label: 'Manage plugins', run } );

		await runCommandByIntent( 'manage plugins', CTX );
		expect( run ).toHaveBeenCalledWith( 'manage plugins', CTX );
	} );

	test( 'catches a throwing command and returns an error envelope', async () => {
		registerCommand( {
			slug: 'global-manage-plugins',
			label: 'Manage plugins',
			run: () => {
				throw new Error( 'boom' );
			},
		} );

		const result = await runCommandByIntent( 'manage plugins', CTX );
		expect( result ).toHaveProperty( 'error' );
		expect( ( result as { error: string } ).error ).toContain( 'boom' );
	} );
} );

describe( 'matchCommandByIntent — localization', () => {
	test( 'tokenizes non-ASCII labels and intents', () => {
		registerCommand( { slug: 'global-new-entry', label: 'Añadir entrada', run: () => {} } );
		registerCommand( { slug: 'global-manage-plugins', label: 'Gestionar plugins', run: () => {} } );

		const cmd = matchCommandByIntent( 'añadir una entrada' );
		expect( cmd?.slug ).toBe( 'global-new-entry' );
	} );
} );
