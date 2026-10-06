/**
 * The shell screen is never a window's document.
 *
 * The desktop boots from `admin.php?page=openstation`. Four paths turn
 * a URL into a document — the iframe src builder, the boot-time entry
 * window, session restore, and the two speculative fetchers — and each
 * one has to refuse that URL, or a desktop boots inside a window (or is
 * built on hover for nobody). They all answer through one predicate;
 * this pins the predicate and each consumer's use of it.
 */

import { describe, expect, it, vi } from 'vitest';
import { buildAppLink, readAppLink } from '../../src/window/share-link';

import { isShellDocumentUrl, SHELL_PAGE_SLUG, shellUrlWithoutBootArgs } from '../../src/shell-url';
import { isSpeculatableDocument } from '../../src/pwa/sw-policy';
import { withChromelessParam } from '../../src/window/dom';
import { openCurrentPage } from '../../src/boot/session';
import type { DesktopConfig } from '../../src/types';
import type { WindowManager } from '../../src/window-manager';

const ORIGIN = window.location.origin;
const ADMIN = `${ ORIGIN }/wp-admin/`;
const SHELL = `${ ADMIN }admin.php?page=${ SHELL_PAGE_SLUG }`;

describe( 'isShellDocumentUrl', () => {
	it( 'recognises the shell screen, with or without extra args', () => {
		expect( isShellDocumentUrl( new URL( SHELL ) ) ).toBe( true );
		expect(
			isShellDocumentUrl(
				new URL( `${ SHELL }&target=%2Fwp-admin%2Fedit.php&intent=1` ),
			),
		).toBe( true );
		expect(
			isShellDocumentUrl(
				new URL( `${ SHELL }&openstation_chromeless=1` ),
			),
		).toBe( true );
	} );

	it( 'is keyed on the file and the page slug, not the admin folder', () => {
		expect(
			isShellDocumentUrl(
				new URL( `${ ORIGIN }/blog/backend/admin.php?page=openstation` ),
			),
		).toBe( true );
		expect(
			isShellDocumentUrl( new URL( `${ ADMIN }admin.php?page=openstation-settings` ) ),
		).toBe( false );
		expect(
			isShellDocumentUrl( new URL( `${ ADMIN }edit.php?page=openstation` ) ),
		).toBe( false );
		expect( isShellDocumentUrl( new URL( `${ ADMIN }admin.php` ) ) ).toBe( false );
	} );

	it( 'resolves a relative string against the base, and rejects garbage', () => {
		expect( isShellDocumentUrl( 'admin.php?page=openstation', ADMIN ) ).toBe( true );
		expect( isShellDocumentUrl( '/wp-admin/admin.php?page=openstation' ) ).toBe( true );
		expect( isShellDocumentUrl( '/wp-admin/edit.php' ) ).toBe( false );
		expect( isShellDocumentUrl( 'not a url', 'also not a url' ) ).toBe( false );
	} );
} );

describe( 'consumers refuse the shell screen', () => {
	it( 'the service worker never speculates it, even flagged chromeless', () => {
		expect(
			isSpeculatableDocument( new URL( `${ SHELL }&openstation_chromeless=1` ) ),
		).toBe( false );
		// Control: a real screen with the same shape is accepted.
		expect(
			isSpeculatableDocument(
				new URL( `${ ADMIN }admin.php?page=acme-crm&openstation_chromeless=1` ),
			),
		).toBe( true );
	} );

	it( 'the iframe URL builder returns null for it', () => {
		expect( withChromelessParam( SHELL ) ).toBeNull();
		expect( withChromelessParam( `${ ADMIN }admin.php?page=acme-crm` ) ).toBe(
			`${ ADMIN }admin.php?page=acme-crm&openstation_chromeless=1`,
		);
	} );

	it( 'the boot entry window is not opened on it', async () => {
		const open = vi.fn().mockResolvedValue( undefined );
		const manager = { open } as unknown as WindowManager;
		const config = {
			currentPage: SHELL,
			currentTitle: '',
			currentIcon: 'dashicons-admin-generic',
			adminUrl: ADMIN,
			dockItems: [],
		} as unknown as DesktopConfig;

		await openCurrentPage( manager, config );

		expect( open ).not.toHaveBeenCalled();
	} );

	it( 'the boot entry window takes its title from the dock when the server left it empty', async () => {
		const open = vi.fn().mockResolvedValue( undefined );
		const manager = { open } as unknown as WindowManager;
		const config = {
			currentPage: `${ ADMIN }edit.php`,
			currentTitle: '',
			currentIcon: 'dashicons-admin-post',
			adminUrl: ADMIN,
			dockItems: [
				{
					id: 'edit-php',
					title: 'Posts',
					icon: 'dashicons-admin-post',
					url: `${ ADMIN }edit.php`,
					submenu: [],
				},
			],
		} as unknown as DesktopConfig;

		await openCurrentPage( manager, config );

		expect( open ).toHaveBeenCalledTimes( 1 );
		expect( open.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
			url: `${ ADMIN }edit.php`,
			title: 'Posts',
		} );
	} );
} );


describe( 'shareable app links', () => {
	it( 'gives an iframe window its own page address, without shell flags or nonces', () => {
		const current = `${ ADMIN }post.php?post=42&action=edit&openstation_chromeless=1&_wpnonce=secret#editor`;
		expect( buildAppLink( { id: 'post-42' }, current, ADMIN ) ).toBe( `${ ADMIN }post.php?post=42&action=edit#editor` );
		expect( buildAppLink( { id: 'plugins' }, `${ ADMIN }plugins.php?plugin=dir%2Ffile.php&openstation_chromeless=1`, ADMIN ) )
			.toBe( `${ ADMIN }plugins.php?plugin=dir%2Ffile.php` );
		expect( buildAppLink( { id: 'dashboard' }, `${ ADMIN }index.php?openstation_chromeless=1`, ADMIN ) ).toBe( ADMIN );
		expect( buildAppLink( { id: 'preview' }, `${ ORIGIN }/hello/`, ADMIN ) ).toBe( `${ ORIGIN }/hello/` );
	} );

	it( 'names a native app by its registry id on the shell screen, and reads it back', () => {
		const link = buildAppLink( { id: 'acme/inbox-2', baseId: 'acme/inbox', native: true }, '#acme/inbox-2', ADMIN );
		expect( link ).toBe( `${ ADMIN }admin.php?page=openstation&app=acme/inbox` );
		expect( readAppLink( link ) ).toEqual( { app: 'acme/inbox' } );
		expect( shellUrlWithoutBootArgs( link ) ).toBe( SHELL );
	} );

	it( 'refuses nested desktops, unsafe URLs, and malformed instructions', () => {
		for ( const url of [ SHELL, 'javascript:alert(1)', 'https://other.test/wp-admin/edit.php', 'https://user:password@example.test/wp-admin/edit.php' ] ) {
			expect( buildAppLink( { id: 'unsafe' }, url, ADMIN ) ).toBe( '' );
		}
		for ( const address of [ 'not a url', `${ SHELL }&app=bad%3Cscript%3E`, `${ ADMIN }edit.php?app=inbox` ] ) {
			expect( readAppLink( address ) ).toBeNull();
		}
	} );
} );
