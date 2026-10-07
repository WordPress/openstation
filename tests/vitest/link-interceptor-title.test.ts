import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { bindTopWindowLinkInterceptor } from '../../src/boot/link-interceptor';
import type { DesktopConfig } from '../../src/types';
import type { WindowManager } from '../../src/window-manager';

const ADMIN_URL = `${ window.location.origin }/wp-admin/`;

const manager = { open: vi.fn(), openNew: vi.fn() };

let container: HTMLElement;

function makeConfig(): DesktopConfig {
	return {
		adminUrl: ADMIN_URL,
		dockItems: [],
	} as unknown as DesktopConfig;
}

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

function click( el: Element ): void {
	el.dispatchEvent(
		new MouseEvent( 'click', { bubbles: true, cancelable: true } ),
	);
}

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
