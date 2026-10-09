import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { embedAdminPage } from '../../src/native-windows';
import {
	getWindowContent,
	setWindowContent,
} from '../../src/window-links/engine';
import {
	LOADING_SPINNER_PRESET,
	LOADING_SPINNER_SIZE,
} from '../../src/window/constants';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

const WINDOW_ID = 'desktop-mode-posts';

let shown = true;
let resizeCallback: ( () => void ) | null = null;

beforeEach( () => {
	installHooksStub();
	shown = true;
	resizeCallback = null;
	vi.spyOn( HTMLIFrameElement.prototype, 'getClientRects' ).mockImplementation(
		() => ( shown ? [ {} ] : [] ) as unknown as DOMRectList,
	);
	vi.stubGlobal(
		'ResizeObserver',
		class {
			constructor( cb: () => void ) {
				resizeCallback = cb;
			}
			observe(): void {}
			disconnect(): void {}
		},
	);
	setWindowContent( WINDOW_ID, null, { source: 'config' } );
} );

afterEach( () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	clearHooksStub();
	document.body.innerHTML = '';
} );

function mount(): {
	host: HTMLElement;
	iframe: HTMLIFrameElement;
	teardown: () => void;
} {
	const host = document.createElement( 'div' );
	document.body.appendChild( host );
	const teardown = embedAdminPage( host, '/wp-admin/post-new.php', {
		windowId: WINDOW_ID,
	} );
	return { host, iframe: host.querySelector( 'iframe' )!, teardown };
}

function announce( iframe: HTMLIFrameElement, identity: unknown ): void {
	window.dispatchEvent(
		new MessageEvent( 'message', {
			data: { type: 'os-content-identity', identity },
			origin: window.location.origin,
			source: iframe.contentWindow,
		} ),
	);
}

const DRAFT = {
	type: 'post',
	id: 42,
	previewUrl: `${ window.location.origin }/?p=42&preview=true`,
};

describe( 'embedAdminPage', () => {
	test( 'paints the window overlay preset and size', () => {
		const { host, teardown } = mount();

		const spinner = host.querySelector( 'os-spinner' );
		expect( spinner?.getAttribute( 'preset' ) ).toBe(
			LOADING_SPINNER_PRESET,
		);
		expect( spinner?.getAttribute( 'size' ) ).toBe( LOADING_SPINNER_SIZE );

		teardown();
	} );

	test( "the page's identity becomes the window's while shown", () => {
		const { iframe, teardown } = mount();

		announce( iframe, null );
		expect( getWindowContent( WINDOW_ID ) ).toBeUndefined();

		announce( iframe, DRAFT );
		expect( getWindowContent( WINDOW_ID ) ).toMatchObject( {
			id: 42,
			previewUrl: DRAFT.previewUrl,
		} );

		teardown();
		expect( getWindowContent( WINDOW_ID ) ).toBeUndefined();
	} );

	test( 'hiding the panel releases the identity, showing re-claims it', () => {
		const { iframe, teardown } = mount();
		announce( iframe, DRAFT );

		shown = false;
		resizeCallback?.();
		expect( getWindowContent( WINDOW_ID ) ).toBeUndefined();

		shown = true;
		resizeCallback?.();
		expect( getWindowContent( WINDOW_ID ) ).toMatchObject( { id: 42 } );

		teardown();
	} );

	test( 'releasing restores the identity the window had before', () => {
		setWindowContent(
			WINDOW_ID,
			{ type: 'post-list', id: 1 },
			{ source: 'config' },
		);
		const { iframe, teardown } = mount();
		announce( iframe, DRAFT );
		expect( getWindowContent( WINDOW_ID ) ).toMatchObject( { id: 42 } );

		teardown();
		expect( getWindowContent( WINDOW_ID ) ).toMatchObject( {
			type: 'post-list',
			id: 1,
		} );
	} );

	test( 'ignores identities from another frame', () => {
		const { teardown } = mount();
		const other = document.createElement( 'iframe' );
		document.body.appendChild( other );

		announce( other, DRAFT );
		expect( getWindowContent( WINDOW_ID ) ).toBeUndefined();

		teardown();
	} );
} );
