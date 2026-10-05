/** Repeated requests and media DOM updates must not multiply bridge callbacks. */
import { afterEach, describe, expect, test } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve( __dirname, '../..' );
const documents: JSDOM[] = [];

function frame( markup = '' ) {
	const dom = new JSDOM( `<body>${ markup }</body>`, {
		url: 'http://localhost/wp-admin/upload.php?openstation_chromeless=1',
		runScripts: 'outside-only',
	} );
	documents.push( dom );
	const w = dom.window;
	const messages: Array< Record< string, unknown > > = [];
	Object.defineProperty( w, 'parent', {
		value: { postMessage: ( message: Record< string, unknown > ) => messages.push( message ) },
	} );
	const load = ( path: string ) => w.eval( readFileSync( resolve( ROOT, path ), 'utf8' ) );
	return { w, messages, load };
}

afterEach( () => {
	for ( const dom of documents.splice( 0 ) ) {
		dom.window.close();
	}
} );

function networkFrame() {
	const f = frame();
	class XHR extends f.w.EventTarget {
		status = 200;
		failSend = false;
		open() {}
		setRequestHeader() {}
		send() {
			if ( this.failSend ) {
				throw new Error( 'send failed' );
			}
		}
	}
	f.w.XMLHttpRequest = XHR as unknown as typeof f.w.XMLHttpRequest;
	f.load( 'src/chromeless-bridge.js' );
	f.messages.length = 0;
	return { ...f, xhr: new f.w.XMLHttpRequest() as unknown as XHR };
}

describe( 'media bridge lifecycle', () => {
	test( 'reusing an XHR reports each completion once, with balanced activity', () => {
		const { w, xhr, messages } = networkFrame();
		for ( let i = 0; i < 100; i++ ) {
			( xhr as unknown as XMLHttpRequest ).open( 'POST', `/wp-admin/async-upload.php?chunk=${ i }` );
			xhr.send();
			xhr.dispatchEvent( new w.Event( 'loadend' ) );
		}
		const network = messages.filter( ( m ) => m.type === 'os-iframe-network' );
		expect( network ).toHaveLength( 100 );
		expect( new Set( network.map( ( m ) => m.url ) ).size ).toBe( 100 );
		expect( messages.filter( ( m ) => m.type === 'os-iframe-activity' && m.phase === 'start' ) ).toHaveLength( 100 );
		expect( messages.filter( ( m ) => m.type === 'os-iframe-activity' && m.phase === 'end' ) ).toHaveLength( 100 );
	} );

	test( 'a synchronous send failure settles activity and leaves no callback on retry', () => {
		const { w, xhr, messages } = networkFrame();
		( xhr as unknown as XMLHttpRequest ).open( 'POST', '/wp-admin/async-upload.php' );
		xhr.failSend = true;
		expect( () => xhr.send() ).toThrow( 'send failed' );
		expect( messages.filter( ( m ) => m.type === 'os-iframe-activity' && m.phase === 'end' ) ).toEqual( [
			expect.objectContaining( { failed: true, status: 0 } ),
		] );
		xhr.failSend = false;
		( xhr as unknown as XMLHttpRequest ).open( 'POST', '/wp-admin/async-upload.php' );
		xhr.send();
		xhr.dispatchEvent( new w.Event( 'loadend' ) );
		expect( messages.filter( ( m ) => m.type === 'os-iframe-network' ) ).toHaveLength( 2 );
		expect( messages.filter( ( m ) => m.type === 'os-iframe-activity' && m.phase === 'end' ) ).toHaveLength( 2 );
	} );

	test( 'enhances grid and detail elements already present when the script loads', () => {
		const { w, load } = frame( '<li class="attachment" data-id="1"></li><div class="attachment-details" data-id="1"></div>' );
		load( 'assets/js/media-library-enhanced.js' );
		for ( const el of w.document.querySelectorAll( '.attachment, .attachment-details' ) ) {
			expect( el.getAttribute( 'draggable' ) ).toBe( 'true' );
		}
	} );

	test( 'repeated list refreshes still send one start and end per drag', async () => {
		const { w, messages, load } = frame( '<table class="media"><tbody></tbody></table>' );
		load( 'assets/js/media-library-enhanced.js' );
		const tbody = w.document.querySelector( 'tbody' )!;
		for ( let i = 0; i < 100; i++ ) {
			tbody.innerHTML = `<tr id="post-${ i + 1 }"><td><a class="row-title" href="/photo.jpg"><img src="/photo.jpg"></a></td></tr>`;
			await Promise.resolve();
			const img = tbody.querySelector( 'img' )!;
			const event = new w.Event( 'dragstart', { bubbles: true, cancelable: true } );
			Object.defineProperty( event, 'dataTransfer', { value: { setData() {} } } );
			img.dispatchEvent( event );
			img.dispatchEvent( new w.Event( 'dragend', { bubbles: true } ) );
		}
		expect( messages.filter( ( m ) => m.type === 'os-drag-start' ) ).toHaveLength( 100 );
		expect( messages.filter( ( m ) => m.type === 'os-drag-end' ) ).toHaveLength( 100 );
	} );
} );
