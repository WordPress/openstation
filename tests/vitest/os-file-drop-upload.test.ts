/**
 * Unit tests for `src/os-file-drop/upload.ts`.
 *
 * Verifies the wp/v2/media multipart POST shape, the
 * `before-upload` / `upload-started` / `upload-progress` /
 * `after-upload` / `upload-failed` hook surface, and the
 * `abort()` handle wired through `upload-started`.
 *
 * @since 0.30.0
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	clearHooksStub,
	installHooksStub,
} from './helpers/hooks-stub';
import {
	uploadFile,
	UploadAbortedError,
	UploadCancelledError,
} from '../../src/os-file-drop/upload';
import { FILE_DROP_HOOKS } from '../../src/os-file-drop/hooks';
import type { DropContext } from '../../src/os-file-drop/types';

function makeFile( name: string, type: string ): File {
	return new File( [ new Uint8Array( 16 ) ], name, { type } );
}

function defaultArgs( file: File, mime: string ) {
	const ctx: DropContext = { surface: 'wallpaper', x: 0, y: 0 };
	return {
		file,
		mime,
		fields: {
			title: 'Test',
			altText: 'Alt',
			caption: '',
			description: '',
			filename: file.name,
		},
		context: ctx,
		mediaUrl: 'https://example.test/wp-json/wp/v2/media',
		restNonce: 'nonce-abc',
	};
}

/**
 * Minimal XHR stub that mimics the order browsers fire events in:
 * `upload.progress*` → `upload.load` → `load` (with the configured
 * status + body). The instance is exposed via `lastXhr` so tests
 * can call `.simulateProgress()` / `.simulateError()` from outside.
 */
class FakeXhrUpload {
	private listeners = new Map< string, Array< ( e: ProgressEvent ) => void > >();
	addEventListener(
		name: string,
		handler: ( e: ProgressEvent ) => void,
	): void {
		const arr = this.listeners.get( name ) ?? [];
		arr.push( handler );
		this.listeners.set( name, arr );
	}
	emit( name: string, event: ProgressEvent ): void {
		for ( const fn of this.listeners.get( name ) ?? [] ) {
			fn( event );
		}
	}
}

interface FakeXhrConfig {
	status: number;
	responseText: string;
	failMode?: 'network' | 'none';
}

class FakeXhr {
	static lastInstance: FakeXhr | null = null;
	static nextConfig: FakeXhrConfig = {
		status: 201,
		responseText: '',
	};

	upload = new FakeXhrUpload();
	private listeners = new Map< string, Array< ( e: Event ) => void > >();
	status = 0;
	responseText = '';
	responseType = '';
	withCredentials = false;
	method = '';
	url = '';
	private headers: Record< string, string > = {};

	constructor() {
		FakeXhr.lastInstance = this;
	}

	open( method: string, url: string ): void {
		this.method = method;
		this.url = url;
	}
	setRequestHeader( key: string, value: string ): void {
		this.headers[ key ] = value;
	}
	addEventListener( name: string, handler: ( e: Event ) => void ): void {
		const arr = this.listeners.get( name ) ?? [];
		arr.push( handler );
		this.listeners.set( name, arr );
	}
	abort(): void {
		queueMicrotask( () => this.emit( 'abort', new Event( 'abort' ) ) );
	}
	send( _body: unknown ): void {
		const cfg = FakeXhr.nextConfig;
		queueMicrotask( () => {
			// Simulate one upload progress tick + the synthetic
			// `upload.load` the production code listens for.
			this.upload.emit(
				'progress',
				new ProgressEvent( 'progress', {
					lengthComputable: true,
					loaded: 8,
					total: 16,
				} ),
			);
			this.upload.emit(
				'load',
				new ProgressEvent( 'load', {
					lengthComputable: true,
					loaded: 16,
					total: 16,
				} ),
			);
			if ( cfg.failMode === 'network' ) {
				this.emit( 'error', new Event( 'error' ) );
				return;
			}
			this.status = cfg.status;
			this.responseText = cfg.responseText;
			this.emit( 'load', new Event( 'load' ) );
		} );
	}
	private emit( name: string, e: Event ): void {
		for ( const fn of this.listeners.get( name ) ?? [] ) {
			fn( e );
		}
	}
}

describe( 'os-file-drop/upload', () => {
	let realXhr: typeof XMLHttpRequest;
	beforeEach( () => {
		installHooksStub();
		realXhr = ( globalThis as { XMLHttpRequest: typeof XMLHttpRequest } )
			.XMLHttpRequest;
		( globalThis as unknown as { XMLHttpRequest: unknown } ).XMLHttpRequest =
			FakeXhr;
		FakeXhr.lastInstance = null;
		FakeXhr.nextConfig = {
			status: 201,
			responseText: JSON.stringify( {
				id: 42,
				source_url: 'https://example.test/uploads/test.png',
				mime_type: 'image/png',
				title: { rendered: 'Test' },
				media_details: { file: 'test.png' },
			} ),
		};
	} );

	afterEach( () => {
		clearHooksStub();
		vi.restoreAllMocks();
		( globalThis as unknown as { XMLHttpRequest: unknown } ).XMLHttpRequest =
			realXhr;
	} );

	test( 'POSTs multipart form-data and emits after-upload', async () => {
		const file = makeFile( 'test.png', 'image/png' );
		const seen: unknown[] = [];
		window.wp!.hooks!.addAction(
			FILE_DROP_HOOKS.AFTER_UPLOAD,
			'test/after',
			( p: unknown ) => seen.push( p ),
		);
		const result = await uploadFile( defaultArgs( file, 'image/png' ) );
		expect( result.id ).toBe( 42 );
		expect( result.url ).toContain( '/uploads/' );
		expect( seen ).toHaveLength( 1 );
		expect( FakeXhr.lastInstance?.method ).toBe( 'POST' );
	} );

	test( 'emits upload-started before send with an abort handle', async () => {
		const file = makeFile( 'test.png', 'image/png' );
		const startedPayloads: Array< { abort: () => void } > = [];
		window.wp!.hooks!.addAction(
			FILE_DROP_HOOKS.UPLOAD_STARTED,
			'test/started',
			( p: { abort: () => void } ) => startedPayloads.push( p ),
		);
		await uploadFile( defaultArgs( file, 'image/png' ) );
		expect( startedPayloads ).toHaveLength( 1 );
		expect( typeof startedPayloads[ 0 ].abort ).toBe( 'function' );
	} );

	test( 'emits upload-progress as bytes flow + synthetic 100% on stream load', async () => {
		const file = makeFile( 'test.png', 'image/png' );
		const ticks: Array< { loaded: number; total: number } > = [];
		window.wp!.hooks!.addAction(
			FILE_DROP_HOOKS.UPLOAD_PROGRESS,
			'test/progress',
			( p: { loaded: number; total: number } ) => ticks.push( p ),
		);
		await uploadFile( defaultArgs( file, 'image/png' ) );
		// One real progress tick (8/16) + the synthetic full event
		// the production code dispatches on `upload.load`.
		expect( ticks.length ).toBeGreaterThanOrEqual( 2 );
		expect( ticks[ 0 ].loaded ).toBe( 8 );
		expect( ticks[ 1 ].loaded ).toBe( ticks[ 1 ].total );
	} );

	test( 'before-upload returning null cancels the upload', async () => {
		window.wp!.hooks!.addFilter(
			FILE_DROP_HOOKS.BEFORE_UPLOAD,
			'test/cancel',
			() => null,
		);
		const file = makeFile( 'test.png', 'image/png' );
		await expect(
			uploadFile( defaultArgs( file, 'image/png' ) ),
		).rejects.toBeInstanceOf( UploadCancelledError );
	} );

	test( 'a non-OK response fires upload-failed', async () => {
		FakeXhr.nextConfig = {
			status: 403,
			responseText: JSON.stringify( { message: 'Forbidden' } ),
		};
		const failures: unknown[] = [];
		window.wp!.hooks!.addAction(
			FILE_DROP_HOOKS.UPLOAD_FAILED,
			'test/fail',
			( p: unknown ) => failures.push( p ),
		);
		const file = makeFile( 'test.png', 'image/png' );
		await expect(
			uploadFile( defaultArgs( file, 'image/png' ) ),
		).rejects.toThrow( /Forbidden/ );
		expect( failures ).toHaveLength( 1 );
	} );

	test( 'network error fires upload-failed with a generic message', async () => {
		FakeXhr.nextConfig = { status: 0, responseText: '', failMode: 'network' };
		const file = makeFile( 'test.png', 'image/png' );
		await expect(
			uploadFile( defaultArgs( file, 'image/png' ) ),
		).rejects.toThrow( /Network error/i );
	} );

	test( 'abort() from the started payload rejects with UploadAbortedError', async () => {
		const file = makeFile( 'test.png', 'image/png' );
		window.wp!.hooks!.addAction(
			FILE_DROP_HOOKS.UPLOAD_STARTED,
			'test/abort',
			( p: { abort: () => void } ) => p.abort(),
		);
		await expect(
			uploadFile( defaultArgs( file, 'image/png' ) ),
		).rejects.toBeInstanceOf( UploadAbortedError );
	} );
} );
