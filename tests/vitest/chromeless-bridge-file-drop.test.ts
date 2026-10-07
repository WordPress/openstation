import { describe, expect, test, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve( __dirname, '../..' );

let posted: Array< Record< string, unknown > > = [];

class FakeDataTransfer {
	files: File[] = [];
	items = {
		add: ( file: File ): void => {
			this.files.push( file );
		},
	};
}

beforeAll( () => {
	Object.defineProperty( window, 'parent', {
		value: {
			postMessage: ( data: Record< string, unknown > ) => {
				posted.push( data );
			},
		},
		configurable: true,
	} );

	(
		window as unknown as { __osChromelessData: Record< string, unknown > }
	).__osChromelessData = {
		_menuPayload: null,
		_menuSig: null,
		_identity: null,
		_softReload: [],
	};

	Element.prototype.getClientRects = function ( this: Element ) {
		return ( this.closest( '[hidden]' ) ? [] : [ {} ] ) as unknown as DOMRectList;
	};

	( globalThis as unknown as { DataTransfer: unknown } ).DataTransfer =
		FakeDataTransfer;

	( 0, eval )(
		readFileSync( resolve( ROOT, 'src/chromeless-bridge.js' ), 'utf8' )
	);
} );

beforeEach( () => {
	posted = [];
	document.body.innerHTML = '';
} );

afterEach( () => {
	vi.useRealTimers();
} );

const PLUGIN_UPLOAD_BOX =
	'<div class="wrap plugin-install-tab-upload"><div class="upload-plugin">' +
	'<p class="install-help">If you have a plugin in a .zip format, you may install or update it by uploading it here.</p>' +
	'<form method="post" enctype="multipart/form-data" class="wp-upload-form" action="/wp-admin/update.php?action=upload-plugin">' +
	'<input type="hidden" name="_wpnonce" value="x">' +
	'<label class="screen-reader-text" for="pluginzip">Plugin zip file</label>' +
	'<input type="file" id="pluginzip" name="pluginzip" accept=".zip">' +
	'<input type="submit" name="install-plugin-submit" id="install-plugin-submit" class="button" value="Install Now" disabled>' +
	'</form></div></div>';

function fileInput( selector: string ): HTMLInputElement {
	const input = document.querySelector( selector ) as HTMLInputElement;
	Object.defineProperty( input, 'files', {
		value: null,
		writable: true,
		configurable: true,
	} );
	return input;
}

function fileDrag( type: 'dragover' | 'drop', files: File[] ): Event {
	const ev = new Event( type, { bubbles: true, cancelable: true } );
	Object.defineProperty( ev, 'dataTransfer', {
		value: { types: [ 'Files' ], files, dropEffect: 'none' },
	} );
	return ev;
}

function zip( name = 'plugin.zip' ): File {
	return new File( [ 'PK' ], name, { type: 'application/zip' } );
}

function dropMessages(): Array< Record< string, unknown > > {
	return posted.filter( ( m ) => m.type === 'os-file-drop' );
}

describe( 'chromeless bridge: a file dropped on a native upload box', () => {
	test( 'a zip dropped anywhere on the Upload Plugin box lands in its file input', () => {
		document.body.innerHTML = PLUGIN_UPLOAD_BOX;
		const input = fileInput( '#pluginzip' );

		const onChange = vi.fn();
		input.addEventListener( 'change', onChange );
		const file = zip();

		const ev = fileDrag( 'drop', [ file ] );
		document.querySelector( '#install-plugin-submit' )!.dispatchEvent( ev );

		expect( input.files ).toEqual( [ file ] );
		expect( onChange ).toHaveBeenCalledTimes( 1 );
		expect( ev.defaultPrevented ).toBe( true );
		expect( dropMessages() ).toHaveLength( 0 );
	} );

	test( 'a drop straight onto a file input is handed to it on any page', () => {
		document.body.innerHTML =
			'<form method="post"><p><label>Import <input type="file" id="import"></label></p></form>';
		const input = fileInput( '#import' );
		const file = zip( 'export.xml' );

		const ev = fileDrag( 'drop', [ file ] );
		input.dispatchEvent( ev );

		expect( input.files ).toEqual( [ file ] );
		expect( ev.defaultPrevented ).toBe( true );
		expect( dropMessages() ).toHaveLength( 0 );
	} );

	test( 'a single-file input takes the first of several files, a multiple one takes them all', () => {
		document.body.innerHTML = PLUGIN_UPLOAD_BOX;
		const input = fileInput( '#pluginzip' );
		const files = [ zip( 'a.zip' ), zip( 'b.zip' ), zip( 'c.zip' ) ];

		document.querySelector( 'form' )!.dispatchEvent( fileDrag( 'drop', files ) );

		expect( input.files ).toEqual( [ files[ 0 ] ] );

		input.multiple = true;
		document.querySelector( 'form' )!.dispatchEvent( fileDrag( 'drop', files ) );

		expect( input.files ).toEqual( files );
	} );

	test( 'a drop on the page background still escalates to the shell', () => {
		document.body.innerHTML =
			PLUGIN_UPLOAD_BOX + '<div class="wp-list-table-wrap"><p id="elsewhere">Cards</p></div>';
		const input = fileInput( '#pluginzip' );
		const file = zip();

		const ev = fileDrag( 'drop', [ file ] );
		document.querySelector( '#elsewhere' )!.dispatchEvent( ev );

		expect( input.files ).toBeNull();
		expect( ev.defaultPrevented ).toBe( true );
		expect( dropMessages() ).toHaveLength( 1 );
		expect( dropMessages()[ 0 ].files ).toEqual( [ file ] );
	} );

	test( 'a hidden file input does not take the drop', () => {
		document.body.innerHTML =
			'<form class="wp-upload-form media-upload-form" method="post">' +
			'<div id="plupload-upload-ui"><div id="drag-drop-area"><p>Drop files to upload</p></div></div>' +
			'<p id="html-upload-ui" hidden><input type="file" name="async-upload" id="async-upload"></p>' +
			'<p class="max-upload-size">Maximum upload file size: 1 GB.</p>' +
			'</form>';
		const input = fileInput( '#async-upload' );

		document.querySelector( '.max-upload-size' )!.dispatchEvent( fileDrag( 'drop', [ zip() ] ) );

		expect( input.files ).toBeNull();
		expect( dropMessages() ).toHaveLength( 1 );
	} );

	test( 'a disabled input, or a box with two, does not take the drop', () => {
		document.body.innerHTML = PLUGIN_UPLOAD_BOX;
		const input = fileInput( '#pluginzip' );
		input.disabled = true;

		document.querySelector( 'form' )!.dispatchEvent( fileDrag( 'drop', [ zip() ] ) );

		expect( input.files ).toBeNull();
		expect( dropMessages() ).toHaveLength( 1 );

		input.disabled = false;
		input.insertAdjacentHTML( 'afterend', '<input type="file" id="second">' );
		document.querySelector( 'form' )!.dispatchEvent( fileDrag( 'drop', [ zip() ] ) );

		expect( input.files ).toBeNull();
		expect( dropMessages() ).toHaveLength( 2 );
	} );

	test( 'a script that already claimed the drop keeps it', () => {
		document.body.innerHTML = PLUGIN_UPLOAD_BOX;
		const input = fileInput( '#pluginzip' );

		document
			.querySelector( 'form' )!
			.addEventListener( 'drop', ( e ) => e.preventDefault() );

		document.querySelector( 'form' )!.dispatchEvent( fileDrag( 'drop', [ zip() ] ) );

		expect( input.files ).toBeNull();
		expect( dropMessages() ).toHaveLength( 0 );
	} );
} );

describe( 'chromeless bridge: the box a file drag hovers is marked', () => {
	test( 'dragging over the box stamps it, and the drop clears it', () => {
		document.body.innerHTML = PLUGIN_UPLOAD_BOX;
		fileInput( '#pluginzip' );
		const form = document.querySelector( 'form' )!;

		document.querySelector( '#install-plugin-submit' )!.dispatchEvent(
			fileDrag( 'dragover', [ zip() ] )
		);

		expect( form.hasAttribute( 'data-os-file-drop-active' ) ).toBe( true );

		form.dispatchEvent( fileDrag( 'drop', [ zip() ] ) );

		expect( form.hasAttribute( 'data-os-file-drop-active' ) ).toBe( false );
	} );

	test( 'the mark goes away on its own once the drag stops coming', () => {
		vi.useFakeTimers();
		document.body.innerHTML = PLUGIN_UPLOAD_BOX;
		fileInput( '#pluginzip' );
		const form = document.querySelector( 'form' )!;

		form.dispatchEvent( fileDrag( 'dragover', [ zip() ] ) );
		expect( form.hasAttribute( 'data-os-file-drop-active' ) ).toBe( true );

		vi.advanceTimersByTime( 200 );
		form.dispatchEvent( fileDrag( 'dragover', [ zip() ] ) );
		vi.advanceTimersByTime( 200 );
		expect( form.hasAttribute( 'data-os-file-drop-active' ) ).toBe( true );

		vi.advanceTimersByTime( 100 );
		expect( form.hasAttribute( 'data-os-file-drop-active' ) ).toBe( false );
	} );

	test( 'the page background is never marked', () => {
		document.body.innerHTML = PLUGIN_UPLOAD_BOX + '<p id="elsewhere">Cards</p>';
		fileInput( '#pluginzip' );

		document.querySelector( '#elsewhere' )!.dispatchEvent(
			fileDrag( 'dragover', [ zip() ] )
		);

		expect( document.querySelector( '[data-os-file-drop-active]' ) ).toBeNull();
	} );
} );
