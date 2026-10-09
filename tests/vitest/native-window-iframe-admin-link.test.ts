/**
 * Tests for in-iframe admin link navigation inside native windows (`os-iframe-admin-link`).
 *
 * Synthetic iframes in native windows lack the shell-managed `Window.iframe`
 * binding, so `native-windows.ts` handles in-frame navigation events directly:
 * same-window remaps switch `<os-tabs>` in place, cross-window remaps delegate
 * to `tryNativeUrlRemap()`, and other links fall back to `windowManager.open()`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { embedAdminPage } from '../../src/native-windows';
import {
	bindNativeUrlRemap,
	registerNativeUrlRemap,
	_resetNativeUrlRemap,
} from '../../src/native-url-remap';

describe( 'native windows — in-iframe admin link navigation', () => {
	let container: HTMLElement;
	let tabs: HTMLElement & { value: string };
	let host: HTMLElement;
	let iframe: HTMLIFrameElement;
	let teardown: () => void;

	const postFromIframe = ( payload: unknown ) => {
		const ev = new MessageEvent( 'message', {
			data: payload,
			origin: window.location.origin,
		} );
		Object.defineProperty( ev, 'source', {
			value: iframe.contentWindow,
			configurable: true,
		} );
		window.dispatchEvent( ev );
	};

	beforeEach( () => {
		_resetNativeUrlRemap();
		bindNativeUrlRemap( {
			adminUrl: `${ window.location.origin }/wp-admin/`,
			getSnapshot: () => ( {} ) as any,
			openById: vi.fn( () => true ),
		} );

		container = document.createElement( 'div' );
		container.className = 'os-app-list desktop-mode-posts';
		container.setAttribute( 'data-window-id', 'desktop-mode-posts' );

		tabs = document.createElement( 'os-tabs' ) as HTMLElement & { value: string };
		tabs.value = 'new';
		container.appendChild( tabs );

		host = document.createElement( 'div' );
		container.appendChild( host );
		document.body.appendChild( container );

		teardown = embedAdminPage(
			host,
			`${ window.location.origin }/wp-admin/post-new.php`,
			{ windowId: 'desktop-mode-posts' },
		);
		iframe = host.querySelector( 'iframe' )!;
	} );

	afterEach( () => {
		teardown?.();
		container.remove();
		_resetNativeUrlRemap();
		delete ( window as unknown as { wp?: unknown } ).wp;
	} );

	test( 'switches tab in place and dispatches os-tab-change (respecting os_tab)', () => {
		registerNativeUrlRemap( {
			id: 'desktop-mode-posts',
			nativeWindowId: 'desktop-mode-posts',
			matches: ( _url, parsed ) => parsed.pathname.endsWith( '/edit.php' ),
		} );

		let tabChangeValue = '';
		tabs.addEventListener( 'os-tab-change', ( ( e: CustomEvent ) => {
			tabChangeValue = e.detail?.value;
		} ) as EventListener );

		// Default fallback tab 'posts' when no os_tab parameter is given
		postFromIframe( {
			type: 'os-iframe-admin-link',
			url: `${ window.location.origin }/wp-admin/edit.php`,
		} );
		expect( tabs.value ).toBe( 'posts' );
		expect( tabChangeValue ).toBe( 'posts' );

		// Custom os_tab parameter
		postFromIframe( {
			type: 'os-iframe-admin-link',
			url: `${ window.location.origin }/wp-admin/edit.php?os_tab=categories`,
		} );
		expect( tabs.value ).toBe( 'categories' );
		expect( tabChangeValue ).toBe( 'categories' );
	} );

	test( 'delegates to tryNativeUrlRemap when link targets another native window', () => {
		const openById = vi.fn( () => true );
		bindNativeUrlRemap( {
			adminUrl: `${ window.location.origin }/wp-admin/`,
			getSnapshot: () => ( {} ) as any,
			openById,
		} );
		registerNativeUrlRemap( {
			id: 'desktop-mode-pages',
			nativeWindowId: 'desktop-mode-pages',
			matches: ( _url, parsed ) =>
				parsed.searchParams.get( 'post_type' ) === 'page',
		} );

		postFromIframe( {
			type: 'os-iframe-admin-link',
			url: `${ window.location.origin }/wp-admin/edit.php?post_type=page`,
		} );

		expect( tabs.value ).toBe( 'new' );
		expect( openById ).toHaveBeenCalledWith( 'desktop-mode-pages' );
	} );

	test( 'falls back to windowManager.open when link is unmapped', () => {
		const openMock = vi.fn();
		const deriveMock = vi.fn( () => 'options-general-php' );
		( window as unknown as { wp?: unknown } ).wp = {
			os: {
				windowManager: { open: openMock },
				deriveWindowId: deriveMock,
			},
		};

		const linkUrl = `${ window.location.origin }/wp-admin/options-general.php`;
		postFromIframe( {
			type: 'os-iframe-admin-link',
			url: linkUrl,
			label: 'Settings',
		} );

		expect( deriveMock ).toHaveBeenCalledWith( linkUrl );
		expect( openMock ).toHaveBeenCalledWith( {
			id: 'options-general-php',
			baseId: 'options-general-php',
			url: linkUrl,
			title: 'Settings',
			icon: 'dashicons-admin-generic',
		} );
	} );

	test( 'teardown removes message listener so subsequent messages are ignored', () => {
		registerNativeUrlRemap( {
			id: 'desktop-mode-posts',
			nativeWindowId: 'desktop-mode-posts',
			matches: ( _url, parsed ) => parsed.pathname.endsWith( '/edit.php' ),
		} );

		teardown();

		postFromIframe( {
			type: 'os-iframe-admin-link',
			url: `${ window.location.origin }/wp-admin/edit.php`,
		} );
		expect( tabs.value ).toBe( 'new' );
	} );
} );
