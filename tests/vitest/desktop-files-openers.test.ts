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

describe( 'desktop-files openers registry', async () => {
	beforeEach( async () => {
		installHooksStub();
	} );

	afterEach( async () => {
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

	test( 'os.files.resolve-opener filter can override the choice', async () => {
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
			'os.files.resolve-opener',
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

	test( 'appliesTo gates resolution per file and hides the opener from type-level listings', async () => {
		const { openers, file } = await load();
		openers.registerOpener( {
			id: 'special-open',
			label: 'Special',
			types: [ 'user' ],
			isDefault: true,
			sort: 5,
			appliesTo: ( f ) =>
				( f.shape as { special?: boolean } ).special === true,
			handler: { kind: 'js', open: () => void 0 },
		} );
		openers.registerOpener( {
			id: 'plain-open',
			label: 'Plain',
			types: [ 'user' ],
			isDefault: true,
			sort: 10,
			handler: { kind: 'js', open: () => void 0 },
		} );

		const plain = fakeFile( 'user', '7', file );
		const special = new file.DefaultDesktopFile(
			{
				type: 'user',
				ref: '9',
				title: 'Agent',
				icon: '',
				previewUrl: '',
				exists: true,
				special: true,
			} as never,
			'user',
		);

		expect( openers.resolveOpener( 'user', plain )?.id ).toBe(
			'plain-open',
		);
		expect( openers.resolveOpener( 'user', special )?.id ).toBe(
			'special-open',
		);
		// Type-level listing (no file to test) excludes predicate defs.
		expect(
			openers.getOpenersForType( 'user' ).map( ( o ) => o.id ),
		).toEqual( [ 'plain-open' ] );
	} );

	test( 'agent user tiles resolve to the agent-chat opener and open the chat window', async () => {
		vi.resetModules();
		const reg = await import( '../../src/desktop-files/openers' );
		await import( '../../src/desktop-files/index' );
		const { DefaultDesktopFile } = await import(
			'../../src/desktop-files/file'
		);
		const { agentsChatStore } = await import(
			'../../src/agents-chat-store'
		);
		agentsChatStore.state.activeAgent = null;

		// Augment — replacing `window.wp` wholesale would clobber the
		// hooks stub the registry depends on.
		const openWindow = vi.fn( () => true );
		( window.wp as unknown as Record< string, unknown > ).os = {
			openWindow,
		};
		try {
			const agentFile = new DefaultDesktopFile(
				{
					type: 'user',
					ref: '15',
					title: 'TLDR Editor',
					icon: '',
					previewUrl: 'https://example.test/agent-avatar.svg',
					exists: true,
					isAgent: true,
					agentDescription: 'Summarizes posts.',
				} as never,
				'user',
			);

			// A human user still resolves to the profile opener.
			const humanFile = new DefaultDesktopFile(
				{
					type: 'user',
					ref: '2',
					title: 'Human',
					icon: '',
					previewUrl: '',
					exists: true,
				} as never,
				'user',
			);
			expect( reg.resolveOpener( 'user', humanFile )?.id ).toBe(
				'wp-user-profile',
			);

			const opener = reg.resolveOpener( 'user', agentFile );
			expect( opener?.id ).toBe( 'agent-chat' );
			expect( opener?.handler.kind ).toBe( 'js' );
			if ( opener?.handler.kind === 'js' ) {
				opener.handler.open( agentFile );
			}

			expect( openWindow ).toHaveBeenCalledWith(
				'desktop-mode-agent-run',
				expect.objectContaining( { source: 'agents-open' } ),
			);
			expect( agentsChatStore.state.activeAgent ).toEqual( {
				id: 15,
				name: 'TLDR Editor',
				description: 'Summarizes posts.',
				avatarUrl: 'https://example.test/agent-avatar.svg',
			} );
		} finally {
			delete ( window.wp as unknown as Record< string, unknown > )
				.os;
		}
	} );

	test( 'openUrl routes through tryNativeUrlRemap so user shortcuts open the native window', async () => {
		// Regression: `installFilesOpenDeps.openUrl` used to call
		// `manager.open` directly, dropping desktop shortcuts into
		// a chromeless iframe even when a native window (`User Edit`,
		// `Users`, `Posts`, …) had claimed the URL. The wired
		// `openUrl` now asks `tryNativeUrlRemap` first; this test
		// locks that contract in by registering a remap, mounting
		// the same wrapper desktop.ts builds, and asserting the
		// fallback `manager.open` is never called.
		const { openers, open, file } = await load();
		vi.resetModules();
		const remap = await import( '../../src/native-url-remap' );

		const openByIdSpy = vi.fn().mockReturnValue( true );
		remap.bindNativeUrlRemap( {
			getSnapshot: () =>
				( { nativeUsersEnabled: true } ) as unknown as Parameters<
					typeof remap.bindNativeUrlRemap
				>[ 0 ][ 'getSnapshot' ] extends () => infer R
					? R
					: never,
			openById: openByIdSpy,
			adminUrl: 'http://example.test/wp-admin/',
		} );
		remap.registerNativeUrlRemap( {
			id: 'desktop-mode-user-edit',
			nativeWindowId: 'desktop-mode-user-edit',
			matches: ( _url, parsed ) =>
				parsed.pathname.endsWith( '/user-edit.php' ) &&
				parsed.searchParams.has( 'user_id' ),
			enabled: ( s: { nativeUsersEnabled?: boolean } ) =>
				s.nativeUsersEnabled === true,
		} );

		const managerOpenSpy = vi.fn().mockReturnValue( true );
		const openUrl = ( a: { id: string; url: string; title: string; icon: string } ) => {
			if ( remap.tryNativeUrlRemap( a.url ) ) {
				return true;
			}
			return managerOpenSpy( { id: a.id, baseId: a.id, ...a } );
		};
		open.installOpenDeps( {
			openUrl,
			openNativeWindow: () => false,
			deriveWindowId: ( url: string ) => `derived-${ url }`,
		} );

		openers.registerOpener( {
			id: 'wp-user-profile',
			label: 'User profile',
			types: [ 'user' ],
			isDefault: true,
			handler: {
				kind: 'url',
				url: ( f ) =>
					`http://example.test/wp-admin/user-edit.php?user_id=${ f.ref() }`,
			},
		} );

		const opened = await open.openFile( fakeFile( 'user', '42', file ) );
		expect( opened ).toBe( true );
		expect( openByIdSpy ).toHaveBeenCalledWith( 'desktop-mode-user-edit' );
		// CRITICAL: the chromeless iframe fallback must NOT fire when
		// a native remap claims the URL.
		expect( managerOpenSpy ).not.toHaveBeenCalled();

		remap._resetNativeUrlRemap();
	} );
} );
