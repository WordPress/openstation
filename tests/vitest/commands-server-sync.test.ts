import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

type Sync = typeof import( '../../src/commands/server-sync' );
type CommandsModule = typeof import( '../../src/commands' );
type Loader = typeof import( '../../src/wallpapers/vendor-loader' );

async function loadModules(): Promise< {
	sync: Sync;
	commands: CommandsModule;
	loader: Loader;
} > {
	vi.resetModules();
	const sync = await import( '../../src/commands/server-sync' );
	const commands = await import( '../../src/commands' );
	const loader = await import( '../../src/wallpapers/vendor-loader' );
	return { sync, commands, loader };
}

describe( 'commands/server-sync.ts', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		vi.restoreAllMocks();
		document.head.innerHTML = '';
	} );

	test( 'injects a <script> tag for each new handle', async () => {
		const { sync, loader } = await loadModules();
		const spy = vi
			.spyOn( loader, 'loadVendorScript' )
			.mockResolvedValue( undefined );

		const run = sync.createCommandRegistrySync();
		await run( [
			{ handle: 'plugin-a', scriptUrl: 'https://example.test/a.js' },
			{ handle: 'plugin-b', scriptUrl: 'https://example.test/b.js' },
		] );

		expect( spy ).toHaveBeenCalledTimes( 2 );
		expect( spy ).toHaveBeenCalledWith(
			'https://example.test/a.js',
			expect.any( Object ),
		);
		expect( spy ).toHaveBeenCalledWith(
			'https://example.test/b.js',
			expect.any( Object ),
		);
	} );

	test( 'hands the loader the dependency closure with the bundle', async () => {
		const { sync, loader } = await loadModules();
		const spy = vi
			.spyOn( loader, 'loadVendorScript' )
			.mockResolvedValue( undefined );
		const deps = [
			{ handle: 'plugin-a-config', url: '', before: [ 'window.pluginA={};' ] },
		];

		const run = sync.createCommandRegistrySync();
		await run( [
			{ handle: 'plugin-a', scriptUrl: 'https://example.test/a.js', scriptDeps: deps },
		] );

		expect( spy ).toHaveBeenCalledWith(
			'https://example.test/a.js',
			expect.objectContaining( { deps } ),
		);
	} );

	test( 'is idempotent — a second sync with the same handles is a no-op', async () => {
		const { sync, loader } = await loadModules();
		const spy = vi
			.spyOn( loader, 'loadVendorScript' )
			.mockResolvedValue( undefined );

		const run = sync.createCommandRegistrySync();
		await run( [
			{ handle: 'plugin-a', scriptUrl: 'https://example.test/a.js' },
		] );
		await run( [
			{ handle: 'plugin-a', scriptUrl: 'https://example.test/a.js' },
		] );

		expect( spy ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'unregisters owner-tagged commands when a handle leaves the payload', async () => {
		const { sync, commands, loader } = await loadModules();
		vi.spyOn( loader, 'loadVendorScript' ).mockResolvedValue( undefined );

		const run = sync.createCommandRegistrySync();
		await run( [
			{ handle: 'plugin-a', scriptUrl: 'https://example.test/a.js' },
		] );

		commands.registerCommand( {
			slug: 'a-hello',
			label: 'Hello',
			owner: 'plugin-a',
			run: () => undefined,
		} );
		commands.registerCommand( {
			slug: 'untagged',
			label: 'No owner',
			run: () => undefined,
		} );

		expect( commands.findCommand( 'a-hello' ) ).not.toBeNull();

		await run( [] );

		expect( commands.findCommand( 'a-hello' ) ).toBeNull();

		expect( commands.findCommand( 'untagged' ) ).not.toBeNull();
	} );

	test( 'unregisters commands declared via PHP metadata when their handle leaves, even without `owner`', async () => {
		const { sync, commands, loader } = await loadModules();
		vi.spyOn( loader, 'loadVendorScript' ).mockResolvedValue( undefined );

		const run = sync.createCommandRegistrySync();

		await run(
			[
				{ handle: 'plugin-a', scriptUrl: 'https://example.test/a.js' },
			],
			[
				{ slug: 'a-one', label: 'One', description: '', icon: '', hint: '', scriptUrl: 'https://example.test/a.js', scriptHandle: 'plugin-a' },
				{ slug: 'a-two', label: 'Two', description: '', icon: '', hint: '', scriptUrl: 'https://example.test/a.js', scriptHandle: 'plugin-a' },
			],
		);

		commands.registerCommand( { slug: 'a-one', label: 'One', run: () => undefined } );
		commands.registerCommand( { slug: 'a-two', label: 'Two', run: () => undefined } );
		commands.registerCommand( { slug: 'survivor', label: 'Survivor', run: () => undefined } );

		await run( [], [] );

		expect( commands.findCommand( 'a-one' ) ).toBeNull();
		expect( commands.findCommand( 'a-two' ) ).toBeNull();
		expect( commands.findCommand( 'survivor' ) ).not.toBeNull();
	} );

	test( 'silently skips entries with an empty scriptUrl', async () => {
		const { sync, loader } = await loadModules();
		const spy = vi
			.spyOn( loader, 'loadVendorScript' )
			.mockResolvedValue( undefined );

		const run = sync.createCommandRegistrySync();
		await run( [ { handle: 'plugin-a', scriptUrl: '' } ] );

		expect( spy ).not.toHaveBeenCalled();
	} );
} );
