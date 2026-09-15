/**
 * The chromeless bridge's OS-file drop forwarder, run against a real
 * DOM: which drops reach the shell, and which land in a native file
 * input on the page instead.
 *
 * Core's Upload Plugin box (`plugin-install.php?tab=upload`) is one
 * `<input type="file">` inside `form.wp-upload-form` and no script:
 * nothing there ever calls `preventDefault()`, so the forwarder's
 * "unclaimed drop → escalate to the shell" rule took a plugin zip
 * dropped on the box and opened the Media Library dialog over it.
 * The forwarder now hands such a drop to the input, the way the
 * browser does outside the shell. Same harness as
 * `chromeless-bridge-links.test.ts`: the emitted source, evaluated
 * in jsdom, with the parent shell stubbed to record what it is sent.
 *
 * @vitest-environment-options { "url": "http://localhost/wp-admin/plugin-install.php?tab=upload&openstation_chromeless=1" }
 */
import { describe, expect, test, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve( __dirname, '../..' );

/** Messages the bridge posted to the (stubbed) parent shell. */
let posted: Array< Record< string, unknown > > = [];

/**
 * jsdom has no `DataTransfer`. The bridge only needs one to trim a
 * multi-file drop down to the first file for a non-`multiple` input,
 * so a list-builder is the whole contract.
 */
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

	// jsdom lays nothing out, so every element reports zero client
	// rects — which the bridge reads as "not rendered". Answer the way
	// a browser would: rendered unless something up the tree is hidden.
	Element.prototype.getClientRects = function ( this: Element ) {
		return ( this.closest( '[hidden]' ) ? [] : [ {} ] ) as unknown as DOMRectList;
	};

	( globalThis as unknown as { DataTransfer: unknown } ).DataTransfer =
		FakeDataTransfer;

	// eslint-disable-next-line no-eval -- the point is to exercise the
	// emitted source rather than a re-implementation of it.
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

/** Core's Upload Plugin box, as `install_plugins_upload()` prints it. */
const PLUGIN_UPLOAD_BOX =
	'<div class="wrap plugin-install-tab-upload"><div class="upload-plugin">' +
	'<p class="install-help">If you have a plugin in a .zip format, you may install or update it by uploading it here.</p>' +
	'<form method="post" enctype="multipart/form-data" class="wp-upload-form" action="/wp-admin/update.php?action=upload-plugin">' +
	'<input type="hidden" name="_wpnonce" value="x">' +
	'<label class="screen-reader-text" for="pluginzip">Plugin zip file</label>' +
	'<input type="file" id="pluginzip" name="pluginzip" accept=".zip">' +
	'<input type="submit" name="install-plugin-submit" id="install-plugin-submit" class="button" value="Install Now" disabled>' +
	'</form></div></div>';

/**
 * The file input, with `files` made writable. jsdom's setter only
 * accepts its own `FileList`, which nothing can construct; an own
 * property in front of it lets the bridge's assignment land where the
 * test can read it back.
 */
function fileInput( selector: string ): HTMLInputElement {
	const input = document.querySelector( selector ) as HTMLInputElement;
	Object.defineProperty( input, 'files', {
		value: null,
		writable: true,
		configurable: true,
	} );
	return input;
}

/** A drag event carrying OS files, the way the bridge reads one. */
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

/** The drop messages the bridge sent to the shell. */
function dropMessages(): Array< Record< string, unknown > > {
	return posted.filter( ( m ) => m.type === 'os-file-drop' );
}

describe( 'chromeless bridge: a file dropped on a native upload box', () => {
	test( 'a zip dropped anywhere on the Upload Plugin box lands in its file input', () => {
		document.body.innerHTML = PLUGIN_UPLOAD_BOX;
		const input = fileInput( '#pluginzip' );
		// What common.js binds to enable Install Now.
		const onChange = vi.fn();
		input.addEventListener( 'change', onChange );
		const file = zip();

		// On the box's own button, not the input: the box is the target.
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

	// Media › Add New: plupload owns `#drag-drop-area`, and the no-JS
	// `#async-upload` input sits hidden beside it. A drop on the form
	// outside plupload's area must not vanish into an input nobody can
	// see.
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
		// A plugin enhancing the box with its own uploader.
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
