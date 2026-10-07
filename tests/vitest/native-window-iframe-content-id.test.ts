import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createRegisterWindow } from '../../src/native-windows';
import { getSyntheticIframe } from '../../src/connection';
import { isWindowContentLoading } from '../../src/window-channels';
import { WindowManager } from '../../src/window-manager';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

describe( 'iframeContent native windows — window id plumbing', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;
	let registerWindow: ReturnType< typeof createRegisterWindow >;

	beforeEach( () => {
		installHooksStub();
		desktop = document.createElement( 'div' );
		desktop.id = 'os-area';
		Object.defineProperty( desktop, 'getBoundingClientRect', {
			value: () =>
				( {
					left: 0,
					top: 0,
					right: 1600,
					bottom: 900,
					width: 1600,
					height: 900,
					x: 0,
					y: 0,
					toJSON: () => ( {} ),
				} ) as DOMRect,
		} );
		Object.defineProperty( desktop, 'clientWidth', {
			value: 1600,
			configurable: true,
		} );
		Object.defineProperty( desktop, 'clientHeight', {
			value: 900,
			configurable: true,
		} );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
		registerWindow = createRegisterWindow( manager );
	} );

	afterEach( () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	const def = () => ( {
		id: 'chat',
		title: 'Chat',
		icon: 'dashicons-format-chat',
		iframeContent: { url: '/wp-admin/admin.php?page=chat' },
	} );

	const openOnSecondDesktop = async () => {
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		return registerWindow( def() );
	};

	test( 'the primary instance registers its iframe under its own id', async () => {
		const win = await registerWindow( def() );

		expect( win.id ).toBe( 'chat' );
		const iframe = win.element.querySelector( 'iframe' );
		expect( iframe ).not.toBeNull();
		expect( getSyntheticIframe( 'chat' ) ).toBe( iframe );
	} );

	test( 'a suffixed second instance registers under the suffixed id', async () => {
		const first = await registerWindow( def() );
		const second = await openOnSecondDesktop();

		expect( second.id ).toBe( 'chat-2' );
		expect( second ).not.toBe( first );

		const firstIframe = first.element.querySelector( 'iframe' );
		const secondIframe = second.element.querySelector( 'iframe' );
		expect( secondIframe ).not.toBeNull();
		expect( secondIframe ).not.toBe( firstIframe );

		expect( getSyntheticIframe( 'chat-2' ) ).toBe( secondIframe );
		expect( getSyntheticIframe( 'chat' ) ).toBe( firstIframe );
	} );

	test( 'the suffixed instance clears its own loading state on iframe load', async () => {
		await registerWindow( def() );
		const second = await openOnSecondDesktop();

		expect( isWindowContentLoading( second.id ) ).toBe( true );

		second.element
			.querySelector( 'iframe' )!
			.dispatchEvent( new Event( 'load' ) );

		expect( isWindowContentLoading( second.id ) ).toBe( false );
	} );

	test( 'closing the window drops its message listener', async () => {
		const received: unknown[] = [];
		const win = await registerWindow( {
			...def(),
			iframeContent: {
				url: '/wp-admin/admin.php?page=chat',
				onMessage: ( data: unknown ) => received.push( data ),
			},
		} );
		const iframe = win.element.querySelector( 'iframe' )!;

		const post = ( payload: unknown ) => {
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

		post( { type: 'ping', n: 1 } );
		expect( received ).toHaveLength( 1 );

		win.destroy();
		post( { type: 'ping', n: 2 } );

		expect( received ).toHaveLength( 1 );
	} );

	test( 'closing one instance leaves the other bridge entry intact', async () => {
		const first = await registerWindow( def() );
		const second = await openOnSecondDesktop();
		const firstIframe = first.element.querySelector( 'iframe' );

		second.destroy();

		expect( getSyntheticIframe( 'chat-2' ) ).toBeNull();
		expect( getSyntheticIframe( 'chat' ) ).toBe( firstIframe );
	} );
} );
