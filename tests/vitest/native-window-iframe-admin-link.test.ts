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
	let onAdminLinkMock: ReturnType< typeof vi.fn >;

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

		onAdminLinkMock = vi.fn( ( _url: string, tab: string ) => {
			tabs.value = tab;
			return true;
		} );

		teardown = embedAdminPage(
			host,
			`${ window.location.origin }/wp-admin/post-new.php`,
			{
				windowId: 'desktop-mode-posts',
				onAdminLink: onAdminLinkMock,
			},
		);
		iframe = host.querySelector( 'iframe' )!;
	} );

	afterEach( () => {
		teardown?.();
		container.remove();
		_resetNativeUrlRemap();
		delete ( window as unknown as { wp?: unknown } ).wp;
	} );

	test( 'calls onAdminLink callback when link remaps to this native window', () => {
		registerNativeUrlRemap( {
			id: 'desktop-mode-posts',
			nativeWindowId: 'desktop-mode-posts',
			matches: ( _url, parsed ) => parsed.pathname.endsWith( '/edit.php' ),
			params: ( _url, parsed ) => {
				const tagged = parsed.searchParams.get( 'os_tab' );
				return tagged ? { tab: tagged } : { tab: 'posts' };
			},
		} );

		// Cross-origin messages are ignored
		const crossOriginEv = new MessageEvent( 'message', {
			data: {
				type: 'os-iframe-admin-link',
				url: `${ window.location.origin }/wp-admin/edit.php`,
			},
			origin: 'https://evil.example.com',
		} );
		Object.defineProperty( crossOriginEv, 'source', {
			value: iframe.contentWindow,
			configurable: true,
		} );
		window.dispatchEvent( crossOriginEv );
		expect( onAdminLinkMock ).not.toHaveBeenCalled();

		// Default mapped tab 'posts'
		postFromIframe( {
			type: 'os-iframe-admin-link',
			url: `${ window.location.origin }/wp-admin/edit.php`,
		} );
		expect( onAdminLinkMock ).toHaveBeenCalledWith(
			`${ window.location.origin }/wp-admin/edit.php`,
			'posts',
		);
		expect( tabs.value ).toBe( 'posts' );

		// Specific tab mapped (e.g. categories)
		postFromIframe( {
			type: 'os-iframe-admin-link',
			url: `${ window.location.origin }/wp-admin/edit.php?os_tab=categories`,
		} );
		expect( onAdminLinkMock ).toHaveBeenCalledWith(
			`${ window.location.origin }/wp-admin/edit.php?os_tab=categories`,
			'categories',
		);
		expect( tabs.value ).toBe( 'categories' );
	} );

	test( 'matches remap on baseId for multi-instance windows (e.g. posts-2)', () => {
		const secondHost = document.createElement( 'div' );
		document.body.appendChild( secondHost );

		const secondOnAdminLink = vi.fn( () => true );
		( window as unknown as { wp?: unknown } ).wp = {
			os: {
				windowManager: {
					getById: ( id: string ) =>
						id === 'desktop-mode-posts-2'
							? { config: { baseId: 'desktop-mode-posts' } }
							: undefined,
				},
			},
		};

		const secondTeardown = embedAdminPage(
			secondHost,
			`${ window.location.origin }/wp-admin/post-new.php`,
			{
				windowId: 'desktop-mode-posts-2',
				onAdminLink: secondOnAdminLink,
			},
		);

		registerNativeUrlRemap( {
			id: 'desktop-mode-posts',
			nativeWindowId: 'desktop-mode-posts',
			matches: ( _url, parsed ) => parsed.pathname.endsWith( '/edit.php' ),
			params: () => ( { tab: 'posts' } ),
		} );

		const secondIframe = secondHost.querySelector( 'iframe' )!;
		const ev = new MessageEvent( 'message', {
			data: {
				type: 'os-iframe-admin-link',
				url: `${ window.location.origin }/wp-admin/edit.php`,
			},
			origin: window.location.origin,
		} );
		Object.defineProperty( ev, 'source', {
			value: secondIframe.contentWindow,
			configurable: true,
		} );
		window.dispatchEvent( ev );

		expect( secondOnAdminLink ).toHaveBeenCalledWith(
			`${ window.location.origin }/wp-admin/edit.php`,
			'posts',
		);
		secondTeardown();
		secondHost.remove();
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
