/**
 * Link interceptor: how the window it opens gets its name.
 *
 * Reading the anchor's own text is the default and stays that way,
 * but it is only a guess: `textContent` runs together across element
 * boundaries, so an anchor built from several elements (the drafts
 * widget's title span beside its "356d ago" stamp span) produced
 * "Ginza after work356d ago". `data-os-window-title` lets such an
 * anchor say what the window is called instead.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { bindTopWindowLinkInterceptor } from '../../src/boot/link-interceptor';
import type { DesktopConfig } from '../../src/types';
import type { WindowManager } from '../../src/window-manager';

const ADMIN_URL = `${ window.location.origin }/wp-admin/`;

/**
 * One binding for the whole file, not one per test. The interceptor
 * has no disposer, so a per-test binding would stack up on `document`.
 * Since the first listener to run calls `preventDefault()`, every
 * later one bails on its own `defaultPrevented` guard and the test's
 * own stub never hears the click.
 */
const manager = { open: vi.fn(), openNew: vi.fn() };

let container: HTMLElement;

/** Config with an empty dock, so no dock entry can claim the title. */
function makeConfig(): DesktopConfig {
	return {
		adminUrl: ADMIN_URL,
		dockItems: [],
	} as unknown as DesktopConfig;
}

/** The row markup the drafts widget builds: two spans, no whitespace. */
function draftRowLink( title: string, stamp: string ): HTMLAnchorElement {
	const link = document.createElement( 'a' );
	link.href = `${ ADMIN_URL }post.php?post=42&action=edit`;

	const name = document.createElement( 'span' );
	name.textContent = title;
	const time = document.createElement( 'span' );
	time.textContent = stamp;

	link.append( name, time );
	return link;
}

/** A plain left click, cancelable so `preventDefault` actually bites. */
function click( el: Element ): void {
	el.dispatchEvent(
		new MouseEvent( 'click', { bubbles: true, cancelable: true } ),
	);
}

/** Title the interceptor handed the window manager for the last click. */
function openedTitle(): string {
	expect( manager.open ).toHaveBeenCalledTimes( 1 );
	return ( manager.open.mock.calls[ 0 ][ 0 ] as { title: string } ).title;
}

beforeAll( () => {
	bindTopWindowLinkInterceptor(
		manager as unknown as WindowManager,
		makeConfig(),
	);
} );

beforeEach( () => {
	manager.open.mockClear();
	manager.openNew.mockClear();
	container = document.createElement( 'div' );
	document.body.appendChild( container );
} );

afterEach( () => {
	container.remove();
} );

describe( 'link interceptor: window title', () => {
	it( 'prefers the title the anchor declares', () => {
		const link = draftRowLink( 'Ginza after work', '356d ago' );
		link.dataset.osWindowTitle = 'Ginza after work';
		container.appendChild( link );

		click( link );

		expect( openedTitle() ).toBe( 'Ginza after work' );
	} );

	it( 'falls back to the link text for a plain anchor', () => {
		const link = document.createElement( 'a' );
		link.href = `${ ADMIN_URL }edit.php`;
		link.textContent = 'All Posts';
		container.appendChild( link );

		click( link );

		expect( openedTitle() ).toBe( 'All Posts' );
	} );

	it( 'runs multi-element anchors together without a declared title', () => {
		// Not the desired output: this is the bug the attribute exists
		// to let an anchor opt out of, pinned so the fallback's
		// behaviour stays a deliberate choice rather than an accident.
		const link = draftRowLink( 'Ginza after work', '356d ago' );
		container.appendChild( link );

		click( link );

		expect( openedTitle() ).toBe( 'Ginza after work356d ago' );
	} );

	it( 'ignores an attribute that is only whitespace', () => {
		const link = document.createElement( 'a' );
		link.href = `${ ADMIN_URL }edit.php`;
		link.textContent = 'All Posts';
		link.dataset.osWindowTitle = '   ';
		container.appendChild( link );

		click( link );

		expect( openedTitle() ).toBe( 'All Posts' );
	} );
} );
