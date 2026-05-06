/**
 * Unit tests for the JS-side file-opener registry — registerOpener,
 * resolveOpener (resolution chain), and the open() dispatcher's
 * handler-kind routing. These tests cover Phase 1.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

type OpenersModule = typeof import( '../../src/desktop-files/openers' );
type OpenModule = typeof import( '../../src/desktop-files/open' );
type FileModule = typeof import( '../../src/desktop-files/file' );

async function load(): Promise< {
	openers: OpenersModule;
	open: OpenModule;
	file: FileModule;
} > {
	vi.resetModules();
	return {
		openers: await import( '../../src/desktop-files/openers' ),
		open: await import( '../../src/desktop-files/open' ),
		file: await import( '../../src/desktop-files/file' ),
	};
}

function fakeFile( type: string, ref: string, file: FileModule ): InstanceType< typeof file.DefaultDesktopFile > {
	return new file.DefaultDesktopFile(
		{
			type,
			ref,
			title: `Title for ${ ref }`,
			icon: 'dashicons-warning',
			previewUrl: '',
			exists: true,
		},
		type,
	);
}

describe( 'desktop-files openers registry', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
	} );

	test( 'registerOpener + getOpener round-trips', async () => {
		const { openers } = await load();
		openers.registerOpener( {
			id: 'my-opener',
			label: 'My opener',
			types: [ 'post' ],
			handler: { kind: 'url', url: () => 'about:blank' },
		} );
		const o = openers.getOpener( 'my-opener' );
		expect( o ).not.toBeNull();
		expect( o?.label ).toBe( 'My opener' );
	} );

	test( 'getOpenersForType filters by type', async () => {
		const { openers } = await load();
		openers.registerOpener( {
			id: 'a',
			label: 'A',
			types: [ 'post' ],
			handler: { kind: 'url', url: () => '' },
		} );
		openers.registerOpener( {
			id: 'b',
			label: 'B',
			types: [ 'user' ],
			handler: { kind: 'url', url: () => '' },
		} );
		expect( openers.getOpenersForType( 'post' ).map( ( e ) => e.id ) ).toEqual( [ 'a' ] );
		expect( openers.getOpenersForType( 'user' ).map( ( e ) => e.id ) ).toEqual( [ 'b' ] );
	} );

	test( 'resolveOpener picks user override first', async () => {
		const { openers } = await load();
		openers.registerOpener( {
			id: 'default',
			label: 'Default',
			types: [ 'post' ],
			isDefault: true,
			handler: { kind: 'url', url: () => '' },
		} );
		openers.registerOpener( {
			id: 'alternative',
			label: 'Alt',
			types: [ 'post' ],
			handler: { kind: 'url', url: () => '' },
		} );
		openers.setUserAssociations( { post: 'alternative' } );
		expect( openers.resolveOpener( 'post' )?.id ).toBe( 'alternative' );
	} );

	test( 'resolveOpener falls back to is_default when override missing', async () => {
		const { openers } = await load();
		openers.registerOpener( {
			id: 'd',
			label: 'D',
			types: [ 'post' ],
			isDefault: true,
			handler: { kind: 'url', url: () => '' },
		} );
		openers.registerOpener( {
			id: 'e',
			label: 'E',
			types: [ 'post' ],
			handler: { kind: 'url', url: () => '' },
		} );
		expect( openers.resolveOpener( 'post' )?.id ).toBe( 'd' );
	} );

	test( 'resolveOpener falls back to first match when no default', async () => {
		const { openers } = await load();
		openers.registerOpener( {
			id: 'first',
			label: 'A first',
			types: [ 'post' ],
			sort: 5,
			handler: { kind: 'url', url: () => '' },
		} );
		openers.registerOpener( {
			id: 'second',
			label: 'B second',
			types: [ 'post' ],
			sort: 10,
			handler: { kind: 'url', url: () => '' },
		} );
		expect( openers.resolveOpener( 'post' )?.id ).toBe( 'first' );
	} );

	test( 'resolveOpener returns null when no opener exists', async () => {
		const { openers } = await load();
		expect( openers.resolveOpener( 'post' ) ).toBeNull();
	} );

	test( 'desktop-mode.files.resolve-opener filter can override the choice', async () => {
		const { openers } = await load();
		openers.registerOpener( {
			id: 'a',
			label: 'A',
			types: [ 'post' ],
			isDefault: true,
			handler: { kind: 'url', url: () => '' },
		} );
		openers.registerOpener( {
			id: 'b',
			label: 'B',
			types: [ 'post' ],
			handler: { kind: 'url', url: () => '' },
		} );
		const stub = ( window.wp as { hooks: { addFilter: ( ...a: unknown[] ) => void } } ).hooks;
		stub.addFilter(
			'desktop-mode.files.resolve-opener',
			'test/force-b',
			() => openers.getOpener( 'b' ),
		);
		expect( openers.resolveOpener( 'post' )?.id ).toBe( 'b' );
	} );

	test( 'invalid registerOpener calls throw', async () => {
		const { openers } = await load();
		expect( () =>
			openers.registerOpener( {
				id: '',
				label: 'X',
				types: [ 'post' ],
				handler: { kind: 'url', url: () => '' },
			} ),
		).toThrow();
		expect( () =>
			openers.registerOpener( {
				id: 'x',
				label: '',
				types: [ 'post' ],
				handler: { kind: 'url', url: () => '' },
			} ),
		).toThrow();
		expect( () =>
			openers.registerOpener( {
				id: 'x',
				label: 'X',
				types: [],
				handler: { kind: 'url', url: () => '' },
			} ),
		).toThrow();
	} );

	test( 'open() dispatches url-kind handlers via openUrl dep', async () => {
		const { openers, open, file } = await load();
		const calls: Array< { id: string; url: string } > = [];
		open.installOpenDeps( {
			openUrl: ( a ) => {
				calls.push( { id: a.id, url: a.url } );
				return true;
			},
			openNativeWindow: () => false,
			deriveWindowId: ( url ) => `derived-${ url }`,
		} );
		openers.registerOpener( {
			id: 'gutenberg',
			label: 'Gutenberg',
			types: [ 'post' ],
			isDefault: true,
			handler: { kind: 'url', url: ( f ) => `/edit/${ f.ref() }` },
		} );
		const f = fakeFile( 'post', '42', file );
		const ok = await open.openFile( f );
		expect( ok ).toBe( true );
		expect( calls ).toEqual( [ { id: 'derived-/edit/42', url: '/edit/42' } ] );
	} );

	test( 'open() dispatches window-kind handlers', async () => {
		const { openers, open, file } = await load();
		const calls: Array< { id: string; config: unknown } > = [];
		open.installOpenDeps( {
			openUrl: () => false,
			openNativeWindow: ( id, config ) => {
				calls.push( { id, config } );
				return true;
			},
			deriveWindowId: () => '',
		} );
		openers.registerOpener( {
			id: 'jorvy',
			label: 'Jorvy',
			types: [ 'jorvy-quote' ],
			isDefault: true,
			handler: {
				kind: 'window',
				windowId: 'jorvy-window',
				config: ( f ) => ( { quoteId: f.ref() } ),
			},
		} );
		const f = fakeFile( 'jorvy-quote', '7', file );
		const ok = await open.openFile( f );
		expect( ok ).toBe( true );
		expect( calls ).toEqual( [ { id: 'jorvy-window', config: { quoteId: '7' } } ] );
	} );

	test( 'open() dispatches js-kind handlers', async () => {
		const { openers, open, file } = await load();
		const seen: string[] = [];
		open.installOpenDeps( {
			openUrl: () => false,
			openNativeWindow: () => false,
			deriveWindowId: () => '',
		} );
		openers.registerOpener( {
			id: 'modal',
			label: 'Modal',
			types: [ 'post' ],
			isDefault: true,
			handler: {
				kind: 'js',
				open: ( f ) => {
					seen.push( f.ref() );
				},
			},
		} );
		const f = fakeFile( 'post', '13', file );
		const ok = await open.openFile( f );
		expect( ok ).toBe( true );
		expect( seen ).toEqual( [ '13' ] );
	} );

	test( 'open() returns false when no opener for the type', async () => {
		const { open, file } = await load();
		open.installOpenDeps( {
			openUrl: () => true,
			openNativeWindow: () => true,
			deriveWindowId: () => '',
		} );
		const ok = await open.openFile( fakeFile( 'never', 'x', file ) );
		expect( ok ).toBe( false );
	} );

	test( 'built-in JS openers register on import', async () => {
		vi.resetModules();
		const reg = await import( '../../src/desktop-files/openers' );
		await import( '../../src/desktop-files/index' );
		const ids = reg.getOpeners().map( ( o ) => o.id );
		expect( ids ).toEqual(
			expect.arrayContaining( [
				'wp-post-editor',
				'wp-media-editor',
				'wp-user-profile',
				'wp-term-editor',
				'wp-comment-editor',
				'browser-navigate',
			] ),
		);
	} );
} );
