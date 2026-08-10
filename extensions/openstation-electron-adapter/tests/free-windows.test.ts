/**
 * The main-process freed-window registry.
 *
 * Bookkeeping, not rendering: who is out, what happens when one closes,
 * what geometry it reopens at, and what URLs it refuses. None of that
 * needs a compositor, so none of it is tested with one.
 */

import { describe, expect, test, vi } from 'vitest';

import { FreeWindows, MIN_SIZE } from '../app/src/lib/free-windows';
import type { CreateWindowOptions, FreeWindowHandle } from '../app/src/lib/free-windows';

/** A BrowserWindow double that records handlers and lets tests fire them. */
function fakeHandle() {
	const handlers: Record< string, Array< ( ...args: unknown[] ) => void > > = {};
	const record = { destroyed: false, focused: 0, minimized: false, title: '' };

	const handle: FreeWindowHandle = {
		isDestroyed: () => record.destroyed,
		isMinimized: () => record.minimized,
		isFullScreen: () => false,
		getBounds: () => ( { x: 10, y: 20, width: 800, height: 600 } ),
		restore: () => {
			record.minimized = false;
		},
		focus: () => {
			record.focused += 1;
		},
		close: () => {
			record.destroyed = true;
			handlers.closed?.forEach( ( fn ) => fn() );
		},
		destroy: () => {
			record.destroyed = true;
		},
		on: ( event, listener ) => {
			( handlers[ event ] ||= [] ).push( listener );
			return handle;
		},
		once: ( event, listener ) => {
			( handlers[ event ] ||= [] ).push( listener );
			return handle;
		},
		setTitle: ( title ) => {
			record.title = title;
		},
	};

	return {
		handle,
		record,
		fire: ( event: string, ...args: unknown[] ) =>
			handlers[ event ]?.forEach( ( fn ) => fn( ...args ) ),
	};
}

/**
 * @param opts Overrides.
 */
function harness( opts: { allow?: ( url: string ) => boolean } = {} ) {
	const created: CreateWindowOptions[] = [];
	const handles: ReturnType< typeof fakeHandle >[] = [];
	const bounds: Record< string, { x: number; y: number; width: number; height: number } > = {};
	const onDocked = vi.fn();
	const onFreed = vi.fn();
	const onActivity = vi.fn();

	const registry = new FreeWindows( {
		createWindow: ( o ) => {
			created.push( o );
			const h = fakeHandle();
			handles.push( h );
			return h.handle;
		},
		getBounds: ( id ) => bounds[ id ] ?? null,
		saveBounds: ( id, b ) => {
			bounds[ id ] = b;
		},
		isAllowedUrl: opts.allow,
		onDocked,
		onFreed,
		onActivity,
	} );

	return { registry, created, handles, bounds, onDocked, onFreed, onActivity };
}

const REQ = {
	windowId: 'edit-php',
	url: 'https://example.test/wp-admin/edit.php',
	title: 'Posts',
	width: 900,
	height: 700,
};

describe( 'freeing a window', () => {
	test( 'creates one native window and tracks it', () => {
		const h = harness();

		const result = h.registry.free( REQ );

		expect( result ).toMatchObject( { ok: true, reused: false } );
		expect( h.created ).toHaveLength( 1 );
		expect( h.registry.list() ).toEqual( [ 'edit-php' ] );
		expect( h.registry.any() ).toBe( true );
	} );

	test( 'focuses the existing window instead of opening a second copy', () => {
		const h = harness();
		h.registry.free( REQ );

		const result = h.registry.free( REQ );

		expect( result ).toMatchObject( { ok: true, reused: true } );
		expect( h.created ).toHaveLength( 1 );
		expect( h.handles[ 0 ]!.record.focused ).toBe( 1 );
	} );

	test( 'restores a minimized window before focusing it', () => {
		const h = harness();
		h.registry.free( REQ );
		h.handles[ 0 ]!.record.minimized = true;

		h.registry.free( REQ );

		expect( h.handles[ 0 ]!.record.minimized ).toBe( false );
	} );

	test( 'refuses a request missing an id or a URL', () => {
		const h = harness();
		expect( h.registry.free( { windowId: '', url: REQ.url } ).ok ).toBe( false );
		expect( h.registry.free( { windowId: 'x', url: '' } ).ok ).toBe( false );
		expect( h.created ).toHaveLength( 0 );
	} );

	test( 'refuses a URL the app is not allowed to open', () => {
		// The preload already checked the scheme; the main process is
		// the last gate before a window opens, and the page choosing
		// the URL is exactly what an attacker might control.
		const h = harness( { allow: ( url ) => url.startsWith( 'https://example.test' ) } );

		const result = h.registry.free( { ...REQ, url: 'https://evil.test/' } );

		expect( result.ok ).toBe( false );
		expect( result.error ).toContain( 'not on the connected site' );
		expect( h.created ).toHaveLength( 0 );
	} );
} );

describe( 'geometry', () => {
	test( 'uses the in-shell size when nothing is remembered', () => {
		const h = harness();
		h.registry.free( REQ );
		expect( h.created[ 0 ] ).toMatchObject( { width: 900, height: 700 } );
	} );

	test( 'prefers remembered bounds over the requested size', () => {
		const h = harness();
		h.bounds[ 'edit-php' ] = { x: 5, y: 6, width: 1200, height: 800 };

		h.registry.free( REQ );

		expect( h.created[ 0 ] ).toMatchObject( {
			x: 5,
			y: 6,
			width: 1200,
			height: 800,
		} );
	} );

	test( 'never opens a window smaller than the minimum', () => {
		const h = harness();
		h.registry.free( { ...REQ, width: 10, height: 10 } );
		expect( h.created[ 0 ]!.width ).toBe( MIN_SIZE.width );
		expect( h.created[ 0 ]!.height ).toBe( MIN_SIZE.height );
	} );

	test( 'remembers bounds when the window is moved or resized', () => {
		const h = harness();
		h.registry.free( REQ );

		h.handles[ 0 ]!.fire( 'moved' );

		expect( h.bounds[ 'edit-php' ] ).toEqual( {
			x: 10,
			y: 20,
			width: 800,
			height: 600,
		} );
	} );

	test( 'does not remember bounds while minimized', () => {
		const h = harness();
		h.registry.free( REQ );
		h.handles[ 0 ]!.record.minimized = true;

		h.handles[ 0 ]!.fire( 'resized' );

		expect( h.bounds[ 'edit-php' ] ).toBeUndefined();
	} );
} );

describe( 'docking back', () => {
	test( 'closing the native window announces a dock-back', () => {
		const h = harness();
		h.registry.free( REQ );

		h.registry.dock( 'edit-php' );

		expect( h.onDocked ).toHaveBeenCalledWith( 'edit-php' );
		expect( h.registry.list() ).toEqual( [] );
	} );

	test( 'a user-initiated close lands on the same path', () => {
		const h = harness();
		h.registry.free( REQ );

		h.handles[ 0 ]!.record.destroyed = true;
		h.handles[ 0 ]!.fire( 'closed' );

		expect( h.onDocked ).toHaveBeenCalledWith( 'edit-php' );
	} );

	test( 'docking an unknown window is a no-op', () => {
		const h = harness();
		expect( h.registry.dock( 'nope' ) ).toBe( false );
		expect( h.onDocked ).not.toHaveBeenCalled();
	} );

	test( 'quitting closes everything without docking anything back', () => {
		// Otherwise quit fires a storm of dock-back messages at a
		// renderer that is also going away.
		const h = harness();
		h.registry.free( REQ );
		h.registry.free( { ...REQ, windowId: 'os-files' } );

		h.registry.closeAll();

		expect( h.onDocked ).not.toHaveBeenCalled();
		expect( h.registry.list() ).toEqual( [] );
	} );

	test( 'reset re-arms the registry for a site switch', () => {
		const h = harness();
		h.registry.free( REQ );
		h.registry.reset();

		h.registry.free( REQ );
		h.registry.dock( 'edit-php' );

		expect( h.onDocked ).toHaveBeenCalledWith( 'edit-php' );
	} );
} );

describe( 'window events', () => {
	test( 'announces the window once it paints', () => {
		const h = harness();
		h.registry.free( REQ );

		h.handles[ 0 ]!.fire( 'ready-to-show' );

		expect( h.onFreed ).toHaveBeenCalledWith( 'edit-php' );
	} );

	test( 'lets the page own its title', () => {
		const h = harness();
		h.registry.free( REQ );
		const prevented = vi.fn();

		h.handles[ 0 ]!.fire( 'page-title-updated', { preventDefault: prevented }, 'Edit Post' );

		expect( prevented ).toHaveBeenCalled();
		expect( h.handles[ 0 ]!.record.title ).toBe( 'Edit Post' );
	} );

	test( 'falls back to the given title when the page supplies none', () => {
		const h = harness();
		h.registry.free( REQ );

		h.handles[ 0 ]!.fire( 'page-title-updated', { preventDefault: () => {} }, '' );

		expect( h.handles[ 0 ]!.record.title ).toBe( 'Posts' );
	} );

	test( 'focus counts as user activity', () => {
		const h = harness();
		h.registry.free( REQ );

		h.handles[ 0 ]!.fire( 'focus' );

		expect( h.onActivity ).toHaveBeenCalled();
	} );
} );

describe( 'focus', () => {
	test( 'restores and focuses a known window', () => {
		const h = harness();
		h.registry.free( REQ );
		h.handles[ 0 ]!.record.minimized = true;

		expect( h.registry.focus( 'edit-php' ) ).toBe( true );
		expect( h.handles[ 0 ]!.record.minimized ).toBe( false );
		expect( h.handles[ 0 ]!.record.focused ).toBe( 1 );
	} );

	test( 'reports failure for an unknown window', () => {
		expect( harness().registry.focus( 'nope' ) ).toBe( false );
	} );
} );
