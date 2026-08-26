/**
 * Unit tests for `src/desktop-files/cross-frame-drop.ts` — the sink
 * that lets a drag lifted inside an iframe (an image in the core
 * Media Library) land on a files canvas as a shortcut.
 *
 * The gesture never becomes a DragManager session, so none of the
 * pointer-driven drop-target machinery applies. What the parent
 * document receives is a plain native `dragover` / `drop` pair, and
 * these tests drive exactly that.
 *
 * jsdom implements neither `DragEvent` nor `DataTransfer`, so both are
 * synthesised — the module only ever reads `types`, `getData()` and
 * writes `dropEffect`, which is a small enough surface to fake
 * honestly.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	attachCrossFrameDrop,
	ATTACHMENT_DROP_MIME,
} from '../../src/desktop-files/cross-frame-drop';
import type { ShortcutDragItem } from '../../src/desktop-files/drag-payloads';

interface FakeDataTransfer {
	types: string[];
	dropEffect: string;
	getData( mime: string ): string;
}

function dataTransfer(
	types: string[],
	data: Record< string, string > = {},
): FakeDataTransfer {
	return {
		types,
		dropEffect: 'none',
		getData: ( mime: string ) => data[ mime ] ?? '',
	};
}

function fireDrag(
	type: 'dragover' | 'drop' | 'dragleave',
	target: Element,
	dt: FakeDataTransfer | null,
	extra: Record< string, unknown > = {},
): Event {
	const ev = new Event( type, { bubbles: true, cancelable: true } );
	Object.defineProperty( ev, 'dataTransfer', { value: dt } );
	for ( const [ key, value ] of Object.entries( extra ) ) {
		Object.defineProperty( ev, key, { value } );
	}
	target.dispatchEvent( ev );
	return ev;
}

/** Build a canvas that mirrors the shell's shape: host > container. */
function mountCanvas() {
	const host = document.createElement( 'div' );
	host.id = 'os-area';
	const container = document.createElement( 'div' );
	container.className = 'os-files-layer';
	host.appendChild( container );
	document.body.appendChild( host );
	return { host, container };
}

/**
 * A tile as this module sees one: the canonical class, the file-type
 * dataset stamp, and the entity `ref`. Deliberately a plain element
 * rather than a real `<os-tile>` — the contract under test is that
 * DOM shape, and constructing the component would drag its whole
 * render path (and a `wp.hooks` global) into a test about drag events.
 */
function folderTile( ref: string ): HTMLElement {
	const tile = document.createElement( 'div' );
	tile.className = 'os-file-tile';
	tile.dataset.fileType = 'folder';
	tile.setAttribute( 'ref', ref );
	return tile;
}

type Filed = { entities: ReadonlyArray< ShortcutDragItem >; parentId: number };

describe( 'cross-frame drops onto a files canvas', () => {
	let host: HTMLElement;
	let container: HTMLElement;
	let filed: Filed[];
	let dispose: () => void;

	beforeEach( () => {
		( { host, container } = mountCanvas() );
		filed = [];
		dispose = attachCrossFrameDrop( {
			host,
			container,
			folderId: 0,
			fileEntities: ( entities, parentId ) =>
				filed.push( { entities, parentId } ),
		} );
	} );

	afterEach( () => {
		dispose();
		document.body.innerHTML = '';
		delete ( window as { wp?: unknown } ).wp;
	} );

	/** Publish a bridge payload the way an iframe-source drag would. */
	function bridgeHolds( payload: unknown ): void {
		( window as { wp?: unknown } ).wp = {
			os: { dragBridge: { getPayload: () => payload } },
		};
	}

	// ------------------------------------------------------------
	// Accepting the drag
	// ------------------------------------------------------------

	test( 'dragover over the canvas is accepted and marked copy', () => {
		bridgeHolds( { kind: 'attachment', id: 7, url: 'x', title: 'Photo' } );
		const dt = dataTransfer( [ 'text/uri-list' ] );

		const ev = fireDrag( 'dragover', host, dt );

		expect( ev.defaultPrevented ).toBe( true );
		expect( dt.dropEffect ).toBe( 'copy' );
		expect( host.hasAttribute( 'data-files-drop-active' ) ).toBe( true );
	} );

	test( 'the custom MIME alone is enough — no bridge needed', () => {
		const dt = dataTransfer( [ ATTACHMENT_DROP_MIME ] );

		const ev = fireDrag( 'dragover', host, dt );

		expect( ev.defaultPrevented ).toBe( true );
	} );

	test( 'a drag carrying nothing we can file is left alone', () => {
		const ev = fireDrag( 'dragover', host, dataTransfer( [ 'text/plain' ] ) );

		expect( ev.defaultPrevented ).toBe( false );
		expect( host.hasAttribute( 'data-files-drop-active' ) ).toBe( false );
	} );

	test( 'an OS file drag is left to the upload manager', () => {
		// Bridge payload present AND `Files` on the transfer: the file
		// drag wins, because claiming it here would swap the upload
		// dialog for a placement pointing at nothing. The `Files` test
		// runs FIRST for exactly this case — a stale bridge payload
		// from an earlier gesture must not capture a real upload.
		bridgeHolds( { kind: 'attachment', id: 7, url: 'x', title: 'Photo' } );
		const dt = dataTransfer( [ 'Files', ATTACHMENT_DROP_MIME ] );

		const ev = fireDrag( 'dragover', host, dt );

		expect( ev.defaultPrevented ).toBe( false );
		expect( host.hasAttribute( 'data-files-drop-active' ) ).toBe( false );
	} );

	test( 'a file dropped from the OS still reaches the upload manager', () => {
		// `src/os-file-drop/` listens on `window`, above this canvas in
		// the bubble path. Dropping a photo out of Finder onto the
		// desktop has to arrive there untouched — no `preventDefault`,
		// no `stopPropagation` — or the upload dialog never opens.
		bridgeHolds( { kind: 'attachment', id: 7, url: 'x', title: 'Photo' } );
		const uploadManager = vi.fn();
		window.addEventListener( 'drop', uploadManager );

		const ev = fireDrag( 'drop', host, dataTransfer( [ 'Files' ] ) );

		window.removeEventListener( 'drop', uploadManager );
		expect( uploadManager ).toHaveBeenCalledTimes( 1 );
		expect( ev.defaultPrevented ).toBe( false );
		expect( filed ).toHaveLength( 0 );
	} );

	// ------------------------------------------------------------
	// Surfaces that are not the canvas
	// ------------------------------------------------------------

	test( 'a drop on a window floating over the canvas is not claimed', () => {
		bridgeHolds( { kind: 'attachment', id: 7, url: 'x', title: 'Photo' } );
		const win = document.createElement( 'div' );
		win.className = 'wp-window';
		const titleBar = document.createElement( 'div' );
		win.appendChild( titleBar );
		host.appendChild( win );

		const ev = fireDrag( 'drop', titleBar, dataTransfer( [ 'text/uri-list' ] ) );

		expect( ev.defaultPrevented ).toBe( false );
		expect( filed ).toHaveLength( 0 );
	} );

	test( 'a drop on the widget column is not claimed', () => {
		bridgeHolds( { kind: 'attachment', id: 7, url: 'x', title: 'Photo' } );
		const widgets = document.createElement( 'aside' );
		widgets.id = 'os-widgets';
		host.appendChild( widgets );

		const ev = fireDrag( 'drop', widgets, dataTransfer( [ 'text/uri-list' ] ) );

		expect( ev.defaultPrevented ).toBe( false );
		expect( filed ).toHaveLength( 0 );
	} );

	test( 'a folder window canvas inside a window still accepts', () => {
		// The host itself lives inside `.wp-window` for a folder
		// window. The window check has to be relative to the host or
		// every folder drop is refused.
		dispose();
		document.body.innerHTML = '';
		const win = document.createElement( 'div' );
		win.className = 'wp-window';
		const body = document.createElement( 'div' );
		const layer = document.createElement( 'div' );
		body.appendChild( layer );
		win.appendChild( body );
		document.body.appendChild( win );
		const inner: Filed[] = [];
		dispose = attachCrossFrameDrop( {
			host: body,
			container: layer,
			folderId: 12,
			fileEntities: ( entities, parentId ) =>
				inner.push( { entities, parentId } ),
		} );
		bridgeHolds( { kind: 'attachment', id: 7, url: 'x', title: 'Photo' } );

		fireDrag( 'drop', body, dataTransfer( [ 'text/uri-list' ] ) );

		expect( inner ).toHaveLength( 1 );
		expect( inner[ 0 ].parentId ).toBe( 12 );
	} );

	// ------------------------------------------------------------
	// Filing the drop
	// ------------------------------------------------------------

	test( 'a bridge attachment drop files a shortcut in this folder', () => {
		bridgeHolds( {
			kind: 'attachment',
			id: 42,
			url: 'https://example.test/a.png',
			title: 'A photo',
			mime: 'image/png',
		} );

		const ev = fireDrag( 'drop', host, dataTransfer( [ 'text/uri-list' ] ) );

		expect( ev.defaultPrevented ).toBe( true );
		expect( filed ).toEqual( [
			{
				entities: [ { kind: 'attachment', ref: '42', title: 'A photo' } ],
				parentId: 0,
			},
		] );
	} );

	test( 'the DataTransfer record is the fallback when no bridge ran', () => {
		const dt = dataTransfer( [ ATTACHMENT_DROP_MIME ], {
			[ ATTACHMENT_DROP_MIME ]: JSON.stringify( {
				id: 9,
				url: 'https://example.test/b.jpg',
				title: 'B',
			} ),
		} );

		fireDrag( 'drop', host, dt );

		expect( filed ).toEqual( [
			{ entities: [ { kind: 'attachment', ref: '9', title: 'B' } ], parentId: 0 },
		] );
	} );

	test( 'post and user bridge payloads file too', () => {
		bridgeHolds( {
			kind: 'post',
			id: 5,
			postType: 'page',
			url: 'https://example.test/p',
			title: 'About',
		} );

		fireDrag( 'drop', host, dataTransfer( [ 'text/uri-list' ] ) );

		expect( filed[ 0 ].entities[ 0 ] ).toEqual( {
			kind: 'post',
			ref: '5',
			title: 'About',
		} );
	} );

	test( 'a bridge kind with no file type is refused, not guessed', () => {
		bridgeHolds( { kind: 'comment', id: 3, url: 'x', title: 'Nope' } );

		const ev = fireDrag( 'drop', host, dataTransfer( [ 'text/plain' ] ) );

		expect( ev.defaultPrevented ).toBe( false );
		expect( filed ).toHaveLength( 0 );
	} );

	test( 'a malformed DataTransfer record does not create a placement', () => {
		const dt = dataTransfer( [ ATTACHMENT_DROP_MIME ], {
			[ ATTACHMENT_DROP_MIME ]: '{ not json',
		} );

		fireDrag( 'drop', host, dt );

		expect( filed ).toHaveLength( 0 );
	} );

	// ------------------------------------------------------------
	// Folder tiles
	// ------------------------------------------------------------

	test( 'dropping on a closed folder tile files into that folder', () => {
		bridgeHolds( { kind: 'attachment', id: 42, url: 'x', title: 'A photo' } );
		const tile = folderTile( '31' );
		container.appendChild( tile );

		fireDrag( 'drop', tile, dataTransfer( [ 'text/uri-list' ] ) );

		expect( filed ).toHaveLength( 1 );
		expect( filed[ 0 ].parentId ).toBe( 31 );
	} );

	test( 'a hovered folder tile gets the drop-target class, then loses it', () => {
		bridgeHolds( { kind: 'attachment', id: 42, url: 'x', title: 'A photo' } );
		const tile = folderTile( '31' );
		container.appendChild( tile );

		fireDrag( 'dragover', tile, dataTransfer( [ 'text/uri-list' ] ) );
		expect( tile.classList.contains( 'os-file-tile--drop-target' ) ).toBe(
			true,
		);

		fireDrag( 'dragover', host, dataTransfer( [ 'text/uri-list' ] ) );
		expect( tile.classList.contains( 'os-file-tile--drop-target' ) ).toBe(
			false,
		);
	} );

	test( 'a non-folder tile files into the canvas, not into itself', () => {
		bridgeHolds( { kind: 'attachment', id: 42, url: 'x', title: 'A photo' } );
		const tile = folderTile( '31' );
		tile.dataset.fileType = 'post';
		container.appendChild( tile );

		fireDrag( 'drop', tile, dataTransfer( [ 'text/uri-list' ] ) );

		expect( filed[ 0 ].parentId ).toBe( 0 );
	} );

	// ------------------------------------------------------------
	// Teardown
	// ------------------------------------------------------------

	test( 'leaving the host clears the affordance', () => {
		bridgeHolds( { kind: 'attachment', id: 42, url: 'x', title: 'A photo' } );
		fireDrag( 'dragover', host, dataTransfer( [ 'text/uri-list' ] ) );
		expect( host.hasAttribute( 'data-files-drop-active' ) ).toBe( true );

		fireDrag( 'dragleave', host, dataTransfer( [ 'text/uri-list' ] ), {
			relatedTarget: document.body,
		} );

		expect( host.hasAttribute( 'data-files-drop-active' ) ).toBe( false );
	} );

	test( 'dragleave onto a child of the host is not an exit', () => {
		bridgeHolds( { kind: 'attachment', id: 42, url: 'x', title: 'A photo' } );
		fireDrag( 'dragover', host, dataTransfer( [ 'text/uri-list' ] ) );

		fireDrag( 'dragleave', host, dataTransfer( [ 'text/uri-list' ] ), {
			relatedTarget: container,
		} );

		expect( host.hasAttribute( 'data-files-drop-active' ) ).toBe( true );
	} );

	test( 'dispose unbinds every listener', () => {
		bridgeHolds( { kind: 'attachment', id: 42, url: 'x', title: 'A photo' } );
		dispose();

		const ev = fireDrag( 'drop', host, dataTransfer( [ 'text/uri-list' ] ) );

		expect( ev.defaultPrevented ).toBe( false );
		expect( filed ).toHaveLength( 0 );
	} );

	test( 'a bridge that throws does not break the canvas', () => {
		( window as { wp?: unknown } ).wp = {
			os: {
				dragBridge: {
					getPayload: vi.fn( () => {
						throw new Error( 'bridge exploded' );
					} ),
				},
			},
		};

		expect( () =>
			fireDrag( 'dragover', host, dataTransfer( [ 'text/plain' ] ) ),
		).not.toThrow();
		expect( filed ).toHaveLength( 0 );
	} );
} );
