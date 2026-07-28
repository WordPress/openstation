/**
 * Tests for the desktop-storage uploader: error-message mapping
 * (web-server 413s arrive as non-JSON), the hook chain, and store
 * ingest of the returned placement.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

class FakeXhr {
	static last: FakeXhr | null = null;
	method = '';
	url = '';
	status = 200;
	responseText = '';
	responseType = '';
	withCredentials = false;
	headers: Record< string, string > = {};
	body: unknown = null;
	upload = {
		listeners: new Map< string, ( e: unknown ) => void >(),
		addEventListener( name: string, cb: ( e: unknown ) => void ) {
			this.listeners.set( name, cb );
		},
	};
	private listeners = new Map< string, () => void >();
	constructor() {
		FakeXhr.last = this;
	}
	open( method: string, url: string ) {
		this.method = method;
		this.url = url;
	}
	setRequestHeader( k: string, v: string ) {
		this.headers[ k ] = v;
	}
	addEventListener( name: string, cb: () => void ) {
		this.listeners.set( name, cb );
	}
	send( body: unknown ) {
		this.body = body;
	}
	abort() {
		this.listeners.get( 'abort' )?.();
	}
	respond( status: number, text: string ) {
		this.status = status;
		this.responseText = text;
		this.listeners.get( 'load' )?.();
	}
}

async function load() {
	vi.resetModules();
	return await import( '../../src/os-file-drop/desktop-upload' );
}

const baseArgs = () => ( {
	file: new File( [ 'abc' ], 'a.txt', { type: 'text/plain' } ),
	mime: 'text/plain',
	fields: {
		title: 'A',
		altText: '',
		caption: '',
		description: '',
		filename: 'a.txt',
	},
	context: { surface: 'wallpaper' as const, x: 0, y: 0 },
	filesUrl: 'https://example.test/wp-json/desktop-mode/v1/files',
	restNonce: 'n0nce',
	parentId: 0,
	relativePath: '',
} );

describe( 'extractMessage', () => {
	test( '413 maps to a friendly size message before JSON parsing', async () => {
		const mod = await load();
		const xhr = { status: 413, responseText: '<html>big</html>' } as XMLHttpRequest;
		expect( mod.extractMessage( xhr, 'big.bin' ) ).toContain( 'larger than' );
		expect( mod.extractMessage( xhr, 'big.bin' ) ).toContain( 'big.bin' );
	} );

	test( 'JSON error message is surfaced verbatim', async () => {
		const mod = await load();
		const xhr = {
			status: 400,
			responseText: JSON.stringify( { message: 'This file type is not allowed.' } ),
		} as XMLHttpRequest;
		expect( mod.extractMessage( xhr, 'x' ) ).toBe( 'This file type is not allowed.' );
	} );

	test( 'non-JSON body falls back to an HTTP-status message', async () => {
		const mod = await load();
		const xhr = { status: 502, responseText: 'Bad gateway' } as XMLHttpRequest;
		expect( mod.extractMessage( xhr, 'x' ) ).toBe( 'Upload failed (HTTP 502).' );
	} );
} );

describe( 'uploadFileToDesktop', () => {
	const realXhr = globalThis.XMLHttpRequest;
	beforeEach( () => {
		installHooksStub();
		( globalThis as { XMLHttpRequest: unknown } ).XMLHttpRequest = FakeXhr;
	} );
	afterEach( () => {
		( globalThis as { XMLHttpRequest: unknown } ).XMLHttpRequest = realXhr;
		clearHooksStub();
	} );

	test( 'happy path posts multipart, ingests the placement, resolves', async () => {
		const mod = await load();
		const promise = mod.uploadFileToDesktop( baseArgs() );
		const xhr = FakeXhr.last!;
		expect( xhr.method ).toBe( 'POST' );
		expect( xhr.url ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/files/uploads',
		);
		expect( xhr.headers[ 'X-WP-Nonce' ] ).toBe( 'n0nce' );
		expect( xhr.body ).toBeInstanceOf( FormData );
		const fd = xhr.body as FormData;
		expect( fd.get( 'parentId' ) ).toBe( '0' );

		const placement = {
			id: 4242,
			parentId: 0,
			x: 16,
			y: 16,
			sortOrder: 0,
			updatedAtMs: 5,
			meta: null,
			file: {
				type: 'upload',
				ref: '77',
				title: 'a.txt',
				icon: 'dashicons-media-text',
				previewUrl: '',
				exists: true,
			},
		};
		xhr.respond( 201, JSON.stringify( { placement, storedFileId: 77 } ) );
		const result = await promise;
		expect( result.storedFileId ).toBe( 77 );
		expect( result.placement.id ).toBe( 4242 );

		// The placement was ingested into the shared files store.
		const store = await import( '../../src/desktop-files/store' );
		const rows = store.getFilesState().placementsByFolder.get( 0 ) ?? [];
		expect( rows.some( ( r ) => r.id === 4242 ) ).toBe( true );
	} );

	test( 'coords ride along only when provided', async () => {
		const mod = await load();
		const args = { ...baseArgs(), coords: { x: 112, y: 126 } };
		const promise = mod.uploadFileToDesktop( args );
		const fd = FakeXhr.last!.body as FormData;
		expect( fd.get( 'x' ) ).toBe( '112' );
		expect( fd.get( 'y' ) ).toBe( '126' );
		FakeXhr.last!.respond( 500, '{}' );
		await expect( promise ).rejects.toThrow();
	} );

	test( 'server 413 rejects with the friendly message', async () => {
		const mod = await load();
		const promise = mod.uploadFileToDesktop( baseArgs() );
		FakeXhr.last!.respond( 413, '<html>nginx</html>' );
		await expect( promise ).rejects.toThrow( /larger than this server accepts/ );
	} );

	test( 'relativePath is appended for tree uploads', async () => {
		const mod = await load();
		const args = { ...baseArgs(), relativePath: 'docs/a.txt' };
		const promise = mod.uploadFileToDesktop( args );
		const fd = FakeXhr.last!.body as FormData;
		expect( fd.get( 'relativePath' ) ).toBe( 'docs/a.txt' );
		FakeXhr.last!.respond( 500, '{}' );
		await expect( promise ).rejects.toThrow();
	} );
} );
