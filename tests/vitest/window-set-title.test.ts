/**
 * `Window.setTitle()` against a real window, mounted the way the
 * shell mounts one.
 *
 * The regression this pins is invisible from the outside: Layer 3's
 * slot painter runs in the constructor, snapshots each slot's DOM,
 * and repaints it from `cloneNode` copies — so the title span the
 * constructor captured is already detached by the time anything
 * calls `setTitle`. Writing to that orphan updated `config.title`
 * and fired the hook while the title bar kept showing the old name,
 * which broke every caller at once: a plugin's `setTitle`, the
 * iframe's `os-title-change`, and the shell's own page-title
 * adoption for windows it could only guess a name for.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Window } from '../../src/window';
import type { WindowConfig } from '../../src/types';
import { syncActiveTab } from '../../src/window/tabs';
import { paintWindowSlots } from '../../src/window-chrome/slots/render';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

function baseConfig( overrides: Partial< WindowConfig > = {} ): WindowConfig {
	return {
		id: 'revision-php',
		url: 'http://example.test/wp-admin/revision.php?revision=31',
		title: 'Browse',
		icon: 'dashicons-admin-post',
		x: 40,
		y: 40,
		width: 800,
		height: 600,
		minWidth: 320,
		minHeight: 200,
		...overrides,
	};
}

function mountWindow( cfg: WindowConfig ): { win: Window; cleanup: () => void } {
	const parent = document.createElement( 'div' );
	document.body.appendChild( parent );
	const win = new Window( cfg );
	parent.appendChild( win.element );
	return {
		win,
		cleanup: () => {
			parent.remove();
		},
	};
}

/** What the title bar actually shows right now. */
function paintedTitle( win: Window ): string {
	return (
		win.element.querySelector< HTMLElement >( '.os-window__title' )
			?.textContent ?? ''
	);
}

describe( 'Window.setTitle', () => {
	let cleanup: () => void = () => {};

	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		cleanup();
		clearHooksStub();
	} );

	test( 'repaints the title bar, not the node the constructor captured', () => {
		const mounted = mountWindow( baseConfig() );
		cleanup = mounted.cleanup;

		mounted.win.setTitle( 'Revisions' );

		expect( paintedTitle( mounted.win ) ).toBe( 'Revisions' );
		expect( mounted.win.config.title ).toBe( 'Revisions' );
	} );

	test( 'the name survives a window-slot repaint', () => {
		// The slot painter restores each slot from a snapshot cloned at
		// construction. Restoring the title's verbatim put the window's
		// ORIGINAL name back and left `config.title` reporting the new
		// one — and a repaint fires whenever the slot registry mutates,
		// so activating a plugin that registers a slot renamed every
		// open window back to whatever it started as.
		const mounted = mountWindow( baseConfig() );
		cleanup = mounted.cleanup;

		mounted.win.setTitle( 'Revisions' );
		paintWindowSlots( mounted.win );

		expect( paintedTitle( mounted.win ) ).toBe( 'Revisions' );
	} );

	test( 'a title slot override that removed the span is not a crash', () => {
		// `appearance.slots.title = null` is a plugin saying "render
		// nothing here". The name still has to reach `config` and the
		// hook; only the default rendering is skipped.
		const mounted = mountWindow(
			baseConfig( { appearance: { slots: { title: null } } } )
		);
		cleanup = mounted.cleanup;

		expect( () => mounted.win.setTitle( 'Revisions' ) ).not.toThrow();
		expect( mounted.win.config.title ).toBe( 'Revisions' );
	} );
} );


describe( 'window app-link row', () => {
	let win: Window;
	beforeEach( () => installHooksStub() );
	afterEach( () => {
		win?.destroy();
		clearHooksStub();
		window.getSelection()?.removeAllRanges();
	} );

	test( 'sits below the content, follows navigation without submenu tabs, and selects only its text', () => {
		win = new Window( baseConfig() );
		document.body.appendChild( win.element );
		const row = win.element.querySelector< HTMLElement >( '.os-window__app-link' )!;
		expect( row.previousElementSibling?.classList.contains( 'os-window__body' ) ).toBe( true );
		const text = row.querySelector< HTMLElement >( '.os-window__app-link-text' )!;
		syncActiveTab( win, `${ window.location.origin }/wp-admin/post.php?post=77&action=edit&openstation_chromeless=1` );
		expect( text.textContent ).toBe( `${ window.location.origin }/wp-admin/post.php?post=77&action=edit` );
		text.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'a', ctrlKey: true, bubbles: true } ) );
		expect( window.getSelection()?.toString() ).toBe( text.textContent );
	} );

	test( 'copies the address from the icon at the start of the bar', async () => {
		const writeText = vi.fn( async () => undefined );
		Object.defineProperty( navigator, 'clipboard', { value: { writeText }, configurable: true } );
		win = new Window( baseConfig( { native: true, baseId: 'acme-inbox' } ) );
		const row = win.element.querySelector< HTMLElement >( '.os-window__app-link' )!;
		const copy = row.firstElementChild as HTMLButtonElement;
		expect( copy.classList.contains( 'os-window__app-link-copy' ) ).toBe( true );
		copy.click();
		await vi.waitFor( () => expect( copy.classList.contains( 'is-copied' ) ).toBe( true ) );
		expect( writeText ).toHaveBeenCalledWith( row.querySelector( '.os-window__app-link-text' )!.textContent );
		Reflect.deleteProperty( navigator, 'clipboard' );
	} );

	test( 'allows a plugin to suppress its window address', () => {
		const hooks = installHooksStub();
		hooks.addFilter( 'os.window.share-url', 'acme/private', () => '' );
		win = new Window( baseConfig( { native: true, baseId: 'acme-private' } ) );
		expect( win.element.querySelector< HTMLElement >( '.os-window__app-link' )!.hidden ).toBe( true );
	} );
} );
