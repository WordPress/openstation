/**
 * Tests for the submenu tab strip's active-state matching
 * (`syncActiveTab`). The strip has to stay lit while the user moves
 * around *inside* a tab's page — `nav-menus.php?action=locations`,
 * `edit.php?paged=2` — without ever letting one submenu entry claim
 * another entry's page.
 */
import { describe, expect, test } from 'vitest';
import { syncActiveTab } from './tabs';
import type { Window } from './index';

const ADMIN = window.location.origin + '/wp-admin/';

/**
 * Build a window stub carrying a submenu tab strip. Tabs are given in
 * click order; each entry is `[ label, url ]`.
 */
function mockTabbedWindow(
	tabs: [ string, string ][],
	activeTabId: string = 'primary',
): Window {
	const element = document.createElement( 'div' );
	const strip = document.createElement( 'nav' );
	strip.className = 'desktop-mode-window__tabs';
	for ( const [ label, url ] of tabs ) {
		const tab = document.createElement( 'button' );
		tab.className = 'desktop-mode-window__tab';
		tab.dataset.kind = 'submenu';
		tab.dataset.url = url;
		tab.textContent = label;
		strip.appendChild( tab );
	}
	element.appendChild( strip );
	return { element, _activeTabId: activeTabId } as unknown as Window;
}

/** Labels of every tab currently marked active. */
function activeLabels( win: Window ): string[] {
	return Array.from(
		win.element.querySelectorAll( '.desktop-mode-window__tab--active' ),
	).map( ( el ) => el.textContent ?? '' );
}

describe( 'syncActiveTab', () => {
	test( 'exact URL match lights that tab', () => {
		const win = mockTabbedWindow( [
			[ 'Appearance', ADMIN + 'themes.php' ],
			[ 'Menus', ADMIN + 'nav-menus.php' ],
		] );

		syncActiveTab( win, ADMIN + 'nav-menus.php' );

		expect( activeLabels( win ) ).toEqual( [ 'Menus' ] );
	} );

	test( 'the chromeless flag never breaks the match', () => {
		const win = mockTabbedWindow( [
			[ 'Menus', ADMIN + 'nav-menus.php' ],
		] );

		syncActiveTab( win, ADMIN + 'nav-menus.php?desktop_mode_chromeless=1' );

		expect( activeLabels( win ) ).toEqual( [ 'Menus' ] );
	} );

	test( 'sub-views of a tab keep it lit', () => {
		const win = mockTabbedWindow( [
			[ 'Appearance', ADMIN + 'themes.php' ],
			[ 'Widgets', ADMIN + 'widgets.php' ],
			[ 'Menus', ADMIN + 'nav-menus.php' ],
		] );

		// WP's own in-screen tabs on nav-menus.php.
		for ( const view of [
			'nav-menus.php?action=locations',
			'nav-menus.php?action=edit&menu=2',
			'nav-menus.php?menu=0&action=edit&_wpnonce=abc123',
		] ) {
			syncActiveTab( win, ADMIN + view );
			expect( activeLabels( win ) ).toEqual( [ 'Menus' ] );
		}
	} );

	test( 'pagination and feedback params keep a list tab lit', () => {
		const win = mockTabbedWindow( [
			[ 'All Posts', ADMIN + 'edit.php?post_type=post' ],
			[ 'Add Post', ADMIN + 'post-new.php?post_type=post' ],
		] );

		syncActiveTab( win, ADMIN + 'edit.php?post_type=post&paged=2&s=hello' );

		expect( activeLabels( win ) ).toEqual( [ 'All Posts' ] );
	} );

	test( 'identity params still separate sibling tabs', () => {
		const win = mockTabbedWindow( [
			[ 'Categories', ADMIN + 'edit-tags.php?taxonomy=category' ],
			[ 'Tags', ADMIN + 'edit-tags.php?taxonomy=post_tag' ],
		] );

		syncActiveTab(
			win,
			ADMIN + 'edit-tags.php?taxonomy=post_tag&paged=3',
		);

		expect( activeLabels( win ) ).toEqual( [ 'Tags' ] );
	} );

	test( 'the most specific matching tab wins', () => {
		// A plugin registering both a landing page and a deeper `tab=`
		// view as separate submenu entries.
		const win = mockTabbedWindow( [
			[ 'Mail', ADMIN + 'admin.php?page=mail' ],
			[ 'Email Test', ADMIN + 'admin.php?page=mail&tab=test' ],
		] );

		syncActiveTab( win, ADMIN + 'admin.php?page=mail&tab=test&retry=1' );

		expect( activeLabels( win ) ).toEqual( [ 'Email Test' ] );
	} );

	test( 'a tab never claims a URL that contradicts its own params', () => {
		const win = mockTabbedWindow( [
			[ 'Mail', ADMIN + 'admin.php?page=mail' ],
			[ 'Email Test', ADMIN + 'admin.php?page=mail&tab=test' ],
		] );

		// An unlisted `tab=` value belongs to the landing entry, not to
		// the Email Test entry.
		syncActiveTab( win, ADMIN + 'admin.php?page=mail&tab=logs' );

		expect( activeLabels( win ) ).toEqual( [ 'Mail' ] );
	} );

	test( 'a URL on no tab’s page leaves the strip blank', () => {
		const win = mockTabbedWindow( [
			[ 'Appearance', ADMIN + 'themes.php' ],
			[ 'Menus', ADMIN + 'nav-menus.php' ],
		] );

		syncActiveTab( win, ADMIN + 'upload.php' );

		expect( activeLabels( win ) ).toEqual( [] );
	} );

	test( 'a foregrounded external tab clears every submenu tab', () => {
		const win = mockTabbedWindow(
			[ [ 'Menus', ADMIN + 'nav-menus.php' ] ],
			'ext-1',
		);

		syncActiveTab( win, ADMIN + 'nav-menus.php' );

		expect( activeLabels( win ) ).toEqual( [] );
	} );

	test( 'aria-selected tracks the active tab', () => {
		const win = mockTabbedWindow( [
			[ 'Appearance', ADMIN + 'themes.php' ],
			[ 'Menus', ADMIN + 'nav-menus.php' ],
		] );

		syncActiveTab( win, ADMIN + 'nav-menus.php?action=locations' );

		const selected = Array.from(
			win.element.querySelectorAll( '[aria-selected="true"]' ),
		).map( ( el ) => el.textContent );
		expect( selected ).toEqual( [ 'Menus' ] );
	} );
} );
