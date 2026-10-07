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

function mountCanvas() {
	const host = document.createElement( 'div' );
	host.id = 'os-area';
	const container = document.createElement( 'div' );
	container.className = 'os-files-layer';
	host.appendChild( container );
	document.body.appendChild( host );
	return { host, container };
}

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

	function bridgeHolds( payload: unknown ): void {
		( window as { wp?: unknown } ).wp = {
			os: { dragBridge: { getPayload: () => payload } },
		};
	}

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

		bridgeHolds( { kind: 'attachment', id: 7, url: 'x', title: 'Photo' } );
		const dt = dataTransfer( [ 'Files', ATTACHMENT_DROP_MIME ] );

		const ev = fireDrag( 'dragover', host, dt );

		expect( ev.defaultPrevented ).toBe( false );
		expect( host.hasAttribute( 'data-files-drop-active' ) ).toBe( false );
	} );

	test( 'a file dropped from the OS still reaches the upload manager', () => {

		bridgeHolds( { kind: 'attachment', id: 7, url: 'x', title: 'Photo' } );
		const uploadManager = vi.fn();
		window.addEventListener( 'drop', uploadManager );

		const ev = fireDrag( 'drop', host, dataTransfer( [ 'Files' ] ) );

		window.removeEventListener( 'drop', uploadManager );
		expect( uploadManager ).toHaveBeenCalledTimes( 1 );
		expect( ev.defaultPrevented ).toBe( false );
		expect( filed ).toHaveLength( 0 );
	} );

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
