/**
 * Tests for the central native URL remap registry — the dispatcher
 * the Dock and the portal both consult before falling back to an
 * iframe open. Each new native window that replaces a classic admin
 * page (Posts, future Pages / Media / Users) registers a single
 * entry here; a slip in the registry's contract makes ALL of them
 * silently fall back to the iframe path, which is exactly the kind
 * of UX regression you only notice once it's already shipped.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	_resetNativeUrlRemap,
	bindNativeUrlRemap,
	listNativeUrlRemaps,
	registerNativeUrlRemap,
	tryNativeUrlRemap,
	unregisterNativeUrlRemap,
} from '../../src/native-url-remap';
import type { OsSettingsSnapshot } from '../../src/settings/registry';

const ADMIN_URL = 'http://example.test/wp-admin/';

function snapshot( over: Partial< OsSettingsSnapshot > = {} ): OsSettingsSnapshot {
	return {
		wallpaper: 'dark',
		accent: 'wp-blue',
		dockSize: 'default',
		desktopLayout: 'classic',
		dockRailRenderer: 'default',
		ai: { enabled: false, provider: 'openai', apiKey: '', transport: 'off' },
		nativePostsEnabled: false,
		...over,
	};
}

afterEach( () => {
	_resetNativeUrlRemap();
} );

describe( 'tryNativeUrlRemap — short-circuit cases', () => {
	test( 'returns false when the registry has not been bound yet', () => {
		registerNativeUrlRemap( {
			id: 'desktop-mode-posts',
			nativeWindowId: 'desktop-mode-posts',
			matches: () => true,
		} );
		// No `bindNativeUrlRemap` call — the snapshot accessor and the
		// opener don't exist yet, so the walk must fail-closed.
		expect( tryNativeUrlRemap( '/wp-admin/edit.php' ) ).toBe( false );
	} );

	test( 'returns false on an empty url string', () => {
		const openById = vi.fn().mockReturnValue( true );
		bindNativeUrlRemap( {
			getSnapshot: () => snapshot( { nativePostsEnabled: true } ),
			openById,
			adminUrl: ADMIN_URL,
		} );
		expect( tryNativeUrlRemap( '' ) ).toBe( false );
		expect( openById ).not.toHaveBeenCalled();
	} );

	test( 'returns false when no entries match', () => {
		const openById = vi.fn().mockReturnValue( true );
		bindNativeUrlRemap( {
			getSnapshot: () => snapshot(),
			openById,
			adminUrl: ADMIN_URL,
		} );
		expect( tryNativeUrlRemap( ADMIN_URL + 'edit.php' ) ).toBe( false );
		expect( openById ).not.toHaveBeenCalled();
	} );
} );

describe( 'registry registration semantics', () => {
	test( 'register replaces any prior entry with the same id', () => {
		registerNativeUrlRemap( {
			id: 'demo',
			nativeWindowId: 'old',
			matches: () => true,
		} );
		registerNativeUrlRemap( {
			id: 'demo',
			nativeWindowId: 'new',
			matches: () => true,
		} );
		const list = listNativeUrlRemaps();
		expect( list ).toHaveLength( 1 );
		expect( list[ 0 ].nativeWindowId ).toBe( 'new' );
	} );

	test( 'register returns an unregister function', () => {
		const unsub = registerNativeUrlRemap( {
			id: 'demo',
			nativeWindowId: 'demo',
			matches: () => true,
		} );
		expect( listNativeUrlRemaps() ).toHaveLength( 1 );
		unsub();
		expect( listNativeUrlRemaps() ).toHaveLength( 0 );
	} );

	test( 'unregister by id removes the entry', () => {
		registerNativeUrlRemap( {
			id: 'demo',
			nativeWindowId: 'demo',
			matches: () => true,
		} );
		unregisterNativeUrlRemap( 'demo' );
		expect( listNativeUrlRemaps() ).toHaveLength( 0 );
	} );

	test( 'malformed entries are silently dropped (defensive)', () => {
		// @ts-expect-error — purposeful malformed entry
		registerNativeUrlRemap( null );
		// @ts-expect-error — purposeful malformed entry
		registerNativeUrlRemap( { id: '', nativeWindowId: 'x', matches: () => true } );
		// @ts-expect-error — purposeful malformed entry
		registerNativeUrlRemap( { id: 'demo', nativeWindowId: '', matches: () => true } );
		// @ts-expect-error — purposeful malformed entry
		registerNativeUrlRemap( { id: 'demo', nativeWindowId: 'x' } );
		expect( listNativeUrlRemaps() ).toHaveLength( 0 );
	} );
} );

describe( 'tryNativeUrlRemap — Posts case', () => {
	const postsEntry = ( opts: { enabled: boolean; openOk: boolean } ) => {
		const openById = vi.fn().mockReturnValue( opts.openOk );
		bindNativeUrlRemap( {
			getSnapshot: () => snapshot( { nativePostsEnabled: opts.enabled } ),
			openById,
			adminUrl: ADMIN_URL,
		} );
		registerNativeUrlRemap( {
			id: 'desktop-mode-posts',
			nativeWindowId: 'desktop-mode-posts',
			matches: ( _url, parsed ) => {
				if ( ! parsed.pathname.endsWith( '/edit.php' ) ) {
					return false;
				}
				const postType = parsed.searchParams.get( 'post_type' );
				return ! postType || postType === 'post';
			},
			enabled: ( s ) => s.nativePostsEnabled === true,
		} );
		return openById;
	};

	test( 'opt-in on + bare /wp-admin/edit.php → opens native', () => {
		const openById = postsEntry( { enabled: true, openOk: true } );
		expect( tryNativeUrlRemap( ADMIN_URL + 'edit.php' ) ).toBe( true );
		expect( openById ).toHaveBeenCalledWith( 'desktop-mode-posts' );
	} );

	test( 'opt-in on + ?post_type=post → opens native', () => {
		const openById = postsEntry( { enabled: true, openOk: true } );
		expect( tryNativeUrlRemap( ADMIN_URL + 'edit.php?post_type=post' ) ).toBe(
			true,
		);
		expect( openById ).toHaveBeenCalledWith( 'desktop-mode-posts' );
	} );

	test( 'opt-in on + ?post_type=page → no remap (let Pages own its URL later)', () => {
		const openById = postsEntry( { enabled: true, openOk: true } );
		expect( tryNativeUrlRemap( ADMIN_URL + 'edit.php?post_type=page' ) ).toBe(
			false,
		);
		expect( openById ).not.toHaveBeenCalled();
	} );

	test( 'opt-in OFF → no remap, even on the matching URL', () => {
		const openById = postsEntry( { enabled: false, openOk: true } );
		expect( tryNativeUrlRemap( ADMIN_URL + 'edit.php' ) ).toBe( false );
		expect( openById ).not.toHaveBeenCalled();
	} );

	test( 'opt-in on but openById says "not registered" → falls through', () => {
		// `openById` returning false simulates a user who flipped the
		// toggle on but somehow lost `edit_posts` (or the window
		// registration failed). The registry must NOT swallow the
		// click — the iframe path is the safe fallback.
		const openById = postsEntry( { enabled: true, openOk: false } );
		expect( tryNativeUrlRemap( ADMIN_URL + 'edit.php' ) ).toBe( false );
		expect( openById ).toHaveBeenCalledWith( 'desktop-mode-posts' );
	} );

	test( 'plain admin URLs (upload.php, users.php) are not claimed by Posts', () => {
		const openById = postsEntry( { enabled: true, openOk: true } );
		expect( tryNativeUrlRemap( ADMIN_URL + 'upload.php' ) ).toBe( false );
		expect( tryNativeUrlRemap( ADMIN_URL + 'users.php' ) ).toBe( false );
		expect( openById ).not.toHaveBeenCalled();
	} );
} );

describe( 'tryNativeUrlRemap — multiple entries', () => {
	test( 'walks in registration order and stops at the first opener that succeeds', () => {
		const openById = vi.fn().mockImplementation( ( id: string ) => id === 'b' );
		bindNativeUrlRemap( {
			getSnapshot: () => snapshot(),
			openById,
			adminUrl: ADMIN_URL,
		} );
		// `a` claims the URL but openById returns false → fall through.
		// `b` also claims and openById returns true → win.
		registerNativeUrlRemap( {
			id: 'a',
			nativeWindowId: 'a',
			matches: () => true,
		} );
		registerNativeUrlRemap( {
			id: 'b',
			nativeWindowId: 'b',
			matches: () => true,
		} );
		expect( tryNativeUrlRemap( ADMIN_URL + 'edit.php' ) ).toBe( true );
		expect( openById ).toHaveBeenNthCalledWith( 1, 'a' );
		expect( openById ).toHaveBeenNthCalledWith( 2, 'b' );
	} );
} );
