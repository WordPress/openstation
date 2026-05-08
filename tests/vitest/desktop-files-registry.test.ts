/**
 * Unit tests for the JS-side files registry — the registerType /
 * resolve / getTypes surface that mirrors the PHP file-type
 * registry. These tests cover Phase 0: registry behavior only.
 * Higher-phase tests (opener resolution, REST round-trips, layer
 * rendering) live in their own files.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

type RegistryModule = typeof import( '../../src/desktop-files/registry' );
type FileModule = typeof import( '../../src/desktop-files/file' );

async function load(): Promise< {
	registry: RegistryModule;
	file: FileModule;
} > {
	vi.resetModules();
	return {
		registry: await import( '../../src/desktop-files/registry' ),
		file: await import( '../../src/desktop-files/file' ),
	};
}

describe( 'desktop-files registry', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
	} );

	test( 'registerType + getType round-trips', async () => {
		const { registry } = await load();
		registry.registerType( { type: 'note', label: 'Note', sort: 50 } );
		const entry = registry.getType( 'note' );
		expect( entry ).not.toBeNull();
		expect( entry?.label ).toBe( 'Note' );
		expect( entry?.sort ).toBe( 50 );
	} );

	test( 'unknown type resolves to a DefaultDesktopFile', async () => {
		const { registry, file } = await load();
		const instance = registry.resolve( {
			type: 'never-registered',
			ref: '42',
			title: 'X',
			icon: 'dashicons-warning',
			previewUrl: '',
			exists: false,
		} );
		expect( instance ).toBeInstanceOf( file.DefaultDesktopFile );
		expect( instance.type() ).toBe( 'never-registered' );
		expect( instance.title() ).toBe( 'X' );
	} );

	test( 'registered class is preferred over default', async () => {
		const { registry, file } = await load();
		class JorvyFile extends file.DesktopFile {
			public type(): string {
				return 'jorvy';
			}
			public title(): string {
				return `JORVY: ${ this.shape.title }`;
			}
		}
		registry.registerType( {
			type: 'jorvy',
			label: 'Jorvy',
			sort: 200,
			DesktopFile: JorvyFile,
		} );
		const instance = registry.resolve( {
			type: 'jorvy',
			ref: '1',
			title: 'Hello',
			icon: 'dashicons-star-filled',
			previewUrl: '',
			exists: true,
		} );
		expect( instance.title() ).toBe( 'JORVY: Hello' );
	} );

	test( 'late registration overwrites earlier one', async () => {
		const { registry } = await load();
		registry.registerType( { type: 'note', label: 'First', sort: 10 } );
		registry.registerType( { type: 'note', label: 'Second', sort: 20 } );
		expect( registry.getType( 'note' )?.label ).toBe( 'Second' );
	} );

	test( 'unregisterType drops the entry', async () => {
		const { registry } = await load();
		registry.registerType( { type: 'tmp', label: 'Temp', sort: 99 } );
		expect( registry.getType( 'tmp' ) ).not.toBeNull();
		registry.unregisterType( 'tmp' );
		expect( registry.getType( 'tmp' ) ).toBeNull();
	} );

	test( 'getTypes applies the desktop-mode.files.types filter', async () => {
		const { registry } = await load();
		registry.registerType( { type: 'a', label: 'A', sort: 10 } );
		registry.registerType( { type: 'b', label: 'B', sort: 20 } );
		const stub = ( window.wp as { hooks: { addFilter: ( ...a: unknown[] ) => void } } ).hooks;
		stub.addFilter(
			'desktop-mode.files.types',
			'test/hide-b',
			( list ) => ( list as Array< { type: string } > ).filter( ( e ) => e.type !== 'b' ),
		);
		const types = registry.getTypes();
		expect( types.map( ( t ) => t.type ) ).toEqual( [ 'a' ] );
	} );

	test( 'getTypes is sorted by sort then label', async () => {
		const { registry } = await load();
		registry.registerType( { type: 'late', label: 'Zeta', sort: 50 } );
		registry.registerType( { type: 'first', label: 'Alpha', sort: 10 } );
		registry.registerType( { type: 'tied-a', label: 'Beta', sort: 30 } );
		registry.registerType( { type: 'tied-b', label: 'Alpha', sort: 30 } );
		const types = registry.getTypes();
		expect( types.map( ( t ) => t.type ) ).toEqual( [
			'first',
			'tied-b',
			'tied-a',
			'late',
		] );
	} );

	test( 'registerType with empty type throws', async () => {
		const { registry } = await load();
		expect( () =>
			registry.registerType( { type: '', label: 'X', sort: 10 } ),
		).toThrow();
	} );

	test( 'registerType with empty label throws', async () => {
		const { registry } = await load();
		expect( () =>
			registry.registerType( { type: 'x', label: '', sort: 10 } ),
		).toThrow();
	} );

	test( 'subscribe fires on register and unregister', async () => {
		const { registry } = await load();
		let count = 0;
		const off = registry.subscribe( () => {
			count += 1;
		} );
		registry.registerType( { type: 'sub', label: 'Sub', sort: 1 } );
		registry.unregisterType( 'sub' );
		off();
		expect( count ).toBe( 2 );
	} );

	test( 'doAction fires desktop-mode.files.type-registered on register', async () => {
		const { registry } = await load();
		const stub = ( window.wp as { hooks: { didAction: ( n: string ) => number } } ).hooks;
		registry.registerType( { type: 'tracked', label: 'Tracked', sort: 1 } );
		expect( stub.didAction( 'desktop-mode.files.type-registered' ) ).toBe( 1 );
	} );

	test( 'built-in types register on importing the index module', async () => {
		vi.resetModules();
		const reg = await import( '../../src/desktop-files/registry' );
		// Importing index has side effects.
		await import( '../../src/desktop-files/index' );
		const types = reg.getTypes().map( ( t ) => t.type );
		expect( types ).toEqual(
			expect.arrayContaining( [
				'folder',
				'post',
				'attachment',
				'user',
				'term',
				'comment',
				'bookmark',
			] ),
		);
	} );
} );
