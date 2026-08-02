import { afterEach, describe, expect, test, vi } from 'vitest';

type IntakeModule = typeof import( '../../src/desktop-files/url-intake' );

async function load(): Promise< IntakeModule > {
	vi.resetModules();
	return import( '../../src/desktop-files/url-intake' );
}

function transfer(
	data: Record< string, string >,
	types = Object.keys( data ),
): DataTransfer {
	return {
		types,
		dropEffect: 'none',
		getData: ( type: string ) => data[ type ] ?? '',
	} as unknown as DataTransfer;
}

function withTransfer< T extends Event >(
	event: T,
	key: 'clipboardData' | 'dataTransfer',
	value: DataTransfer,
): T {
	Object.defineProperty( event, key, { value } );
	return event;
}

function activate( host: HTMLElement ): void {
	host.dispatchEvent( new Event( 'pointerdown', { bubbles: true, composed: true } ) );
}

afterEach( () => {
	document.body.innerHTML = '';
	vi.restoreAllMocks();
} );

describe( 'desktop URL intake controller', () => {
	test( 'accepts the first paste without a preliminary desktop click', async () => {
		const intake = await load();
		const host = document.createElement( 'main' );
		document.body.appendChild( host );
		const onUrl = vi.fn();
		intake.registerUrlIntakeTarget( { host, onUrl } );

		const event = withTransfer(
			new Event( 'paste', { bubbles: true, cancelable: true, composed: true } ) as ClipboardEvent,
			'clipboardData',
			transfer( { 'text/plain': 'https://example.com/first-paste' } ),
		);
		host.dispatchEvent( event );

		expect( event.defaultPrevented ).toBe( true );
		expect( onUrl ).toHaveBeenCalledWith( expect.objectContaining( {
			url: 'https://example.com/first-paste',
			source: 'paste',
		} ) );
		intake.__resetUrlIntakeForTests();
	} );

	test( 'prefers URI-list on paste and tears down cleanly', async () => {
		const intake = await load();
		const host = document.createElement( 'main' );
		document.body.appendChild( host );
		const onUrl = vi.fn();
		const unregister = intake.registerUrlIntakeTarget( { host, onUrl } );
		activate( host );

		const event = withTransfer(
			new Event( 'paste', { bubbles: true, cancelable: true, composed: true } ) as ClipboardEvent,
			'clipboardData',
			transfer( {
				'text/uri-list': '# dragged link\nhttps://uri.example/path',
				'text/plain': 'https://plain.example/',
			} ),
		);
		host.dispatchEvent( event );

		expect( event.defaultPrevented ).toBe( true );
		expect( onUrl ).toHaveBeenCalledWith( expect.objectContaining( {
			url: 'https://uri.example/path',
			source: 'paste',
		} ) );

		unregister();
		host.dispatchEvent( withTransfer(
			new Event( 'paste', { bubbles: true, cancelable: true } ) as ClipboardEvent,
			'clipboardData',
			transfer( { 'text/plain': 'https://after.example/' } ),
		) );
		expect( onUrl ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'does not interfere with OS file drops', async () => {
		const intake = await load();
		const host = document.createElement( 'main' );
		document.body.appendChild( host );
		const onUrl = vi.fn();
		intake.registerUrlIntakeTarget( { host, onUrl } );

		const event = withTransfer(
			new Event( 'drop', { bubbles: true, cancelable: true, composed: true } ) as DragEvent,
			'dataTransfer',
			transfer( { 'text/uri-list': 'https://example.com/' }, [ 'Files', 'text/uri-list' ] ),
		);
		host.dispatchEvent( event );

		expect( event.defaultPrevented ).toBe( false );
		expect( onUrl ).not.toHaveBeenCalled();
		intake.__resetUrlIntakeForTests();
	} );

	test( 'drop includes pointer coordinates and the closed-folder tile target', async () => {
		const intake = await load();
		const host = document.createElement( 'main' );
		const folder = document.createElement( 'div' );
		folder.className = 'desktop-mode-file-tile';
		folder.dataset.fileType = 'folder';
		host.appendChild( folder );
		document.body.appendChild( host );
		const onUrl = vi.fn();
		intake.registerUrlIntakeTarget( { host, onUrl } );

		const event = withTransfer(
			new Event( 'drop', { bubbles: true, cancelable: true, composed: true } ) as DragEvent,
			'dataTransfer',
			transfer( { 'text/plain': 'example.com' } ),
		);
		Object.defineProperties( event, {
			clientX: { value: 123 },
			clientY: { value: 234 },
		} );
		folder.dispatchEvent( event );

		expect( onUrl ).toHaveBeenCalledWith( expect.objectContaining( {
			url: 'https://example.com/',
			source: 'drop',
			clientX: 123,
			clientY: 234,
			eventTarget: folder,
		} ) );
		intake.__resetUrlIntakeForTests();
	} );

	test( 'paste is ignored in editable controls, modals, and iframes', async () => {
		const intake = await load();
		const host = document.createElement( 'main' );
		const input = document.createElement( 'input' );
		host.appendChild( input );
		document.body.appendChild( host );
		const onUrl = vi.fn();
		intake.registerUrlIntakeTarget( { host, onUrl } );
		activate( host );

		const paste = ( target: HTMLElement ) => target.dispatchEvent( withTransfer(
			new Event( 'paste', { bubbles: true, cancelable: true, composed: true } ) as ClipboardEvent,
			'clipboardData',
			transfer( { 'text/plain': 'https://example.com/' } ),
		) );

		paste( input );
		const modal = document.createElement( 'div' );
		modal.setAttribute( 'aria-modal', 'true' );
		document.body.appendChild( modal );
		paste( host );
		modal.remove();
		const frame = document.createElement( 'iframe' );
		document.body.appendChild( frame );
		frame.focus();
		paste( host );

		expect( onUrl ).not.toHaveBeenCalled();
		intake.__resetUrlIntakeForTests();
	} );
} );
