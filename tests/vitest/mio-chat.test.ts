import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { mountMioChat } from '../../src/mio/assistant/chat';
import { MioSession } from '../../src/mio/assistant/session';

beforeEach( () => { vi.stubGlobal( 'ResizeObserver', class { observe() {} disconnect() {} } ); } );

afterEach( () => { vi.unstubAllGlobals(); document.body.innerHTML = ''; vi.restoreAllMocks(); } );

test( 'chat submits with kit events, formats assistant text safely, and closes with Escape', async () => {
	const session = new MioSession( { host: document.body, title: 'Preferences', prompt: () => 'Help', documents: [], abilities: () => [] }, async () => ( { message: '**Saved** <img src=x onerror=alert(1)> [bad](javascript:alert)', calls: [] } ), () => true );
	const close = vi.fn();
	const chat = mountMioChat( document.body, 'Preferences', session, close );
	const input = document.querySelector( 'os-textarea' )!;
	input.dispatchEvent( new CustomEvent( 'os-input-change', { detail: { value: '<script>hello</script>' } } ) );
	input.dispatchEvent( new CustomEvent( 'os-submit' ) );
	for ( let i = 0; i < 8; i++ ) { await Promise.resolve(); }
	expect( document.querySelector( '.os-mio-chat__message--assistant strong' )?.textContent ).toBe( 'Saved' );
	expect( document.querySelector( '.os-mio-chat img, .os-mio-chat script, .os-mio-chat a' ) ).toBeNull();
	expect( document.querySelector( '.os-mio-chat__message--user' )?.textContent ).toBe( '<script>hello</script>' );
	expect( Array.from( document.querySelectorAll( 'os-button' ) ).find( b => b.textContent === 'Stop' )?.hidden ).toBe( true );
	document.querySelector( '.os-mio-chat' )!.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ) );
	expect( close ).toHaveBeenCalledOnce();
	chat.destroy();
	expect( document.querySelector( '.os-mio-chat' ) ).toBeNull();
} );


test.each( [ 0, 40 ] )( 'a long reply reveals its beginning and leaves subsequent scrolling to the reader (%i existing messages)', async ( count ) => {
	// jsdom has no layout. Model a reply starting 180px into a 1200px log.
	vi.spyOn( HTMLElement.prototype, 'offsetTop', 'get' ).mockImplementation( function () {
		return this.classList.contains( 'os-mio-chat__message--assistant' ) ? 180 : 0;
	} );
	vi.spyOn( HTMLElement.prototype, 'scrollHeight', 'get' ).mockReturnValue( 1200 );
	const session = new MioSession( { host: document.body, title: 'Preferences', prompt: () => 'Help', documents: [], abilities: () => [] }, async () => ( { message: 'Long explanation.\n\n'.repeat( 100 ), calls: [] } ), () => true );
	session.conversation.write( Array.from( { length: count }, () => ( { role: 'assistant' as const, text: 'Previous answer' } ) ) );
	const chat = mountMioChat( document.body, 'Preferences', session, vi.fn() );
	const input = document.querySelector( 'os-textarea' )!;
	input.dispatchEvent( new CustomEvent( 'os-input-change', { detail: { value: 'Explain everything' } } ) );
	input.dispatchEvent( new CustomEvent( 'os-submit' ) );
	for ( let i = 0; i < 8; i++ ) { await Promise.resolve(); }
	const log = document.querySelector<HTMLElement>( '.os-mio-chat__log' )!;
	expect( log.scrollTop ).toBe( 180 );
	log.scrollTop = 450;
	log.dispatchEvent( new Event( 'scroll' ) );
	for ( let i = 0; i < 4; i++ ) { await Promise.resolve(); }
	expect( log.scrollTop ).toBe( 450 );
	chat.destroy();
} );

test( 'composer wraps to two rows, preserves Shift+Enter and clears after Enter sends', async () => {
	const transport = vi.fn( async () => ( { message: 'Understood.', calls: [] } ) );
	const session = new MioSession( { host: document.body, title: 'Preferences', prompt: () => 'Help', documents: [], abilities: () => [] }, transport, () => true );
	const chat = mountMioChat( document.body, 'Preferences', session, vi.fn() );
	await Promise.resolve();
	const input = document.querySelector( 'os-textarea' )!;
	const native = input.shadowRoot!.querySelector( 'textarea' )!;
	expect( input.getAttribute( 'rows' ) ).toBe( '1' );
	expect( input.getAttribute( 'max-rows' ) ).toBe( '2' );
	expect( input.hasAttribute( 'auto-grow' ) ).toBe( true );
	native.value = 'A long first line\nAnd another line';
	native.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	const newline = new KeyboardEvent( 'keydown', { key: 'Enter', shiftKey: true, cancelable: true, bubbles: true } );
	native.dispatchEvent( newline );
	expect( newline.defaultPrevented ).toBe( false ); expect( transport ).not.toHaveBeenCalled();
	native.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Enter', cancelable: true, bubbles: true } ) );
	for ( let i = 0; i < 10; i++ ) { await Promise.resolve(); }
	expect( transport ).toHaveBeenCalledOnce(); expect( native.value ).toBe( '' );
	expect( session.conversation.read()[ 0 ].text ).toBe( 'A long first line\nAnd another line' );
	chat.destroy();
} );
