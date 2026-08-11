/**
 * The here-or-there state machine.
 *
 * A window is either in the shell or out on the real desktop, never
 * both and never neither, and two independent processes can change
 * that. Everything below is a way of getting the two out of sync, and
 * an assertion that it does not happen.
 */

import { describe, expect, test, vi } from 'vitest';

import { FreedWindows } from '../src/freed-windows';
import type { ManagedWindow } from '../src/freed-windows';

/** A window double that records what was done to it. */
function fakeWindow( id: string, state = 'normal' ) {
	const classes = new Set< string >();
	const attrs: Record< string, string > = {};
	const win = {
		id,
		state,
		element: {
			classList: {
				add: ( c: string ) => classes.add( c ),
				remove: ( c: string ) => classes.delete( c ),
			},
			setAttribute: ( n: string, v: string ) => {
				attrs[ n ] = v;
			},
			removeAttribute: ( n: string ) => {
				delete attrs[ n ];
			},
		},
		minimize: vi.fn( () => {
			win.state = 'minimized';
		} ),
		restore: vi.fn( () => {
			win.state = 'normal';
		} ),
	};
	return { win: win as unknown as ManagedWindow, classes, attrs, raw: win };
}

/**
 * @param windows Windows the manager knows about.
 */
function harness( windows: Record< string, ReturnType< typeof fakeWindow > > = {} ) {
	const focusNative = vi.fn();
	const closeNative = vi.fn();
	const onFreed = vi.fn();
	const onDocked = vi.fn();
	const focus = vi.fn();

	const freed = new FreedWindows( {
		manager: {
			getById: ( id: string ) => windows[ id ]?.win ?? null,
			focus,
		},
		focusNative,
		closeNative,
		onFreed,
		onDocked,
	} );

	return { freed, focusNative, closeNative, onFreed, onDocked, focus };
}

describe( 'adopting a window', () => {
	test( 'minimizes it, marks it, and announces it', () => {
		const posts = fakeWindow( 'edit-php' );
		const h = harness( { 'edit-php': posts } );

		h.freed.adopt( 'edit-php' );

		expect( h.freed.has( 'edit-php' ) ).toBe( true );
		expect( posts.raw.minimize ).toHaveBeenCalledTimes( 1 );
		expect( posts.classes.has( 'os-window--freed' ) ).toBe( true );
		expect( posts.attrs[ 'data-os-freed' ] ).toBe( '1' );
		expect( h.onFreed ).toHaveBeenCalledWith( 'edit-php' );
	} );

	test( 'is idempotent — a second adopt does not re-minimize or re-announce', () => {
		const posts = fakeWindow( 'edit-php' );
		const h = harness( { 'edit-php': posts } );

		h.freed.adopt( 'edit-php' );
		h.freed.adopt( 'edit-php' );

		expect( posts.raw.minimize ).toHaveBeenCalledTimes( 1 );
		expect( h.onFreed ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'does not minimize a window that is already minimized', () => {
		const posts = fakeWindow( 'edit-php', 'minimized' );
		const h = harness( { 'edit-php': posts } );

		h.freed.adopt( 'edit-php' );

		expect( posts.raw.minimize ).not.toHaveBeenCalled();
	} );

	test( 'still records an id whose window the shell does not have', () => {
		// The host can free a window the shell has since forgotten
		// (a reload, a navigation). The bookkeeping has to survive it.
		const h = harness();
		h.freed.adopt( 'ghost' );
		expect( h.freed.list() ).toEqual( [ 'ghost' ] );
	} );
} );

describe( 'releasing a window', () => {
	test( 'restores it, unmarks it, focuses it, and announces it', () => {
		const posts = fakeWindow( 'edit-php' );
		const h = harness( { 'edit-php': posts } );
		h.freed.adopt( 'edit-php' );

		h.freed.release( 'edit-php' );

		expect( h.freed.has( 'edit-php' ) ).toBe( false );
		expect( posts.raw.restore ).toHaveBeenCalledTimes( 1 );
		expect( posts.classes.has( 'os-window--freed' ) ).toBe( false );
		expect( posts.attrs[ 'data-os-freed' ] ).toBeUndefined();
		expect( h.focus ).toHaveBeenCalledTimes( 1 );
		expect( h.onDocked ).toHaveBeenCalledWith( 'edit-php' );
	} );

	test( 'ignores a window that was never freed', () => {
		const h = harness( { 'edit-php': fakeWindow( 'edit-php' ) } );
		h.freed.release( 'edit-php' );
		expect( h.onDocked ).not.toHaveBeenCalled();
	} );
} );

describe( 'redirecting focus to the native window', () => {
	test( 'raises the native window instead of restoring the shell copy', () => {
		// This is the rule that keeps the dock honest: clicking Posts
		// while Posts is out on the desktop must not open a second one.
		const posts = fakeWindow( 'edit-php' );
		const h = harness( { 'edit-php': posts } );
		h.freed.adopt( 'edit-php' );
		posts.raw.state = 'normal'; // Something restored it behind our back.

		h.freed.redirect( 'edit-php' );

		expect( posts.raw.minimize ).toHaveBeenCalledTimes( 2 );
		expect( h.focusNative ).toHaveBeenCalledWith( 'edit-php' );
	} );

	test( 'leaves windows that are not freed completely alone', () => {
		const posts = fakeWindow( 'edit-php' );
		const h = harness( { 'edit-php': posts } );

		h.freed.redirect( 'edit-php' );

		expect( posts.raw.minimize ).not.toHaveBeenCalled();
		expect( h.focusNative ).not.toHaveBeenCalled();
	} );
} );

describe( 'forgetting a closed window', () => {
	test( 'closes the native counterpart', () => {
		const h = harness( { 'edit-php': fakeWindow( 'edit-php' ) } );
		h.freed.adopt( 'edit-php' );

		h.freed.forget( 'edit-php' );

		expect( h.freed.has( 'edit-php' ) ).toBe( false );
		expect( h.closeNative ).toHaveBeenCalledWith( 'edit-php' );
	} );

	test( 'does nothing for a window that was not freed', () => {
		const h = harness();
		h.freed.forget( 'edit-php' );
		expect( h.closeNative ).not.toHaveBeenCalled();
	} );
} );

describe( 're-adopting after a shell reload', () => {
	test( 'records the ids without announcing transitions that did not happen', () => {
		// Native windows outlive the page that created them, so boot
		// is not a clean slate — but nothing *changed*, so subscribers
		// must not be told a window was just freed.
		const h = harness();

		h.freed.adoptExisting( [ 'edit-php', 'os-files' ] );

		expect( h.freed.list().sort() ).toEqual( [ 'edit-php', 'os-files' ] );
		expect( h.onFreed ).not.toHaveBeenCalled();
	} );

	test( 'ignores empty ids in the host’s list', () => {
		const h = harness();
		h.freed.adoptExisting( [ '', 'edit-php' ] );
		expect( h.freed.list() ).toEqual( [ 'edit-php' ] );
	} );
} );
