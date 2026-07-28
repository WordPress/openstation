/**
 * Unit tests for `src/os-file-drop/upload.ts`.
 *
 * Verifies the wp/v2/media multipart POST shape, the
 * `before-upload` / `upload-started` / `upload-progress` /
 * `after-upload` / `upload-failed` hook surface, and the
 * `abort()` handle wired through `upload-started`.
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
	static instances: FakeXhr[] = [];
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
	aborted = false;
	private headers: Record< string, string > = {};

	constructor() {
		FakeXhr.lastInstance = this;
		FakeXhr.instances.push( this );
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
		this.aborted = true;
		queueMicrotask( () => this.emit( 'abort', new Event( 'abort' ) ) );
	}
	send( _body: unknown ): void {
		const cfg = FakeXhr.nextConfig;
		// DELETE requests (the late-cancel cleanup path) don't drive
		// the upload-progress event stream and respond with 200 OK.
		if ( this.method === 'DELETE' ) {
			queueMicrotask( () => {
				this.status = 200;
				this.responseText = '{}';
				this.emit( 'loadend', new Event( 'loadend' ) );
			} );
			return;
		}
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
		FakeXhr.instances = [];
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
		const seen: Array< { file: File; result: { id: number } } > = [];
		window.wp!.hooks!.addAction(
			FILE_DROP_HOOKS.AFTER_UPLOAD,
			'test/after',
			( p: { file: File; result: { id: number } } ) => seen.push( p ),
		);
		const result = await uploadFile( defaultArgs( file, 'image/png' ) );
		expect( result.id ).toBe( 42 );
		expect( result.url ).toContain( '/uploads/' );
		expect( seen ).toHaveLength( 1 );
		// The File ref must travel through so per-file UIs (HUD,
		// My WordPress live-refresh) can match by identity rather
		// than filename — two `photo.jpg` drops from different
		// folders would otherwise collide.
		expect( seen[ 0 ].file ).toBe( file );
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

	test( 'upload-failed carries the filtered File identity (post-BEFORE_UPLOAD swap)', async () => {
		// Regression: every UPLOAD_FAILED branch (network, HTTP,
		// JSON parse, early abort, late cancel) used to pass
		// `args.file` (the pre-filter File) while UPLOAD_STARTED /
		// _PROGRESS / AFTER_UPLOAD passed `filtered.file`. A HUD
		// keyed on the started-File would then drop the failure
		// event and leave the row stuck in "running".
		const original = makeFile( 'original.png', 'image/png' );
		const swapped = makeFile( 'swapped.png', 'image/png' );
		window.wp!.hooks!.addFilter(
			FILE_DROP_HOOKS.BEFORE_UPLOAD,
			'test/swap-file',
			( payload: { file: File; mime: string; fields: unknown } ) => ( {
				...payload,
				file: swapped,
			} ),
		);
		FakeXhr.nextConfig = {
			status: 500,
			responseText: JSON.stringify( { message: 'Server error' } ),
		};
		const failures: Array< { file: File } > = [];
		window.wp!.hooks!.addAction(
			FILE_DROP_HOOKS.UPLOAD_FAILED,
			'test/failed-identity',
			( p: { file: File } ) => failures.push( p ),
		);
		await expect(
			uploadFile( defaultArgs( original, 'image/png' ) ),
		).rejects.toThrow( /Server error/ );
		expect( failures ).toHaveLength( 1 );
		expect( failures[ 0 ].file ).toBe( swapped );
		expect( failures[ 0 ].file ).not.toBe( original );
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
		// Body never made it to the server → no cleanup DELETE.
		expect( FakeXhr.instances.some( ( i ) => i.method === 'DELETE' ) ).toBe(
			false,
		);
	} );

	test( 'late abort() — after body is fully sent — DELETEs the created attachment', async () => {
		const file = makeFile( 'test.png', 'image/png' );
		// Defer the abort to `UPLOAD_PROGRESS` at 100% so it fires
		// AFTER `xhr.upload.load` has flipped `bodyFullySent`. By
		// that point `xhr.abort()` would be too late — the server
		// will respond 201 with the new attachment, and the
		// production code is supposed to DELETE it before
		// surfacing the failure.
		let abortHandle: ( () => void ) | null = null;
		window.wp!.hooks!.addAction(
			FILE_DROP_HOOKS.UPLOAD_STARTED,
			'test/late-abort/capture',
			( p: { abort: () => void } ) => {
				abortHandle = p.abort;
			},
		);
		window.wp!.hooks!.addAction(
			FILE_DROP_HOOKS.UPLOAD_PROGRESS,
			'test/late-abort/trigger',
			( p: { loaded: number; total: number } ) => {
				if ( p.loaded === p.total && abortHandle ) {
					abortHandle();
					abortHandle = null;
				}
			},
		);
		const failures: Array< { error: Error } > = [];
		window.wp!.hooks!.addAction(
			FILE_DROP_HOOKS.UPLOAD_FAILED,
			'test/late-abort/fail',
			( p: { error: Error } ) => failures.push( p ),
		);

		await expect(
			uploadFile( defaultArgs( file, 'image/png' ) ),
		).rejects.toBeInstanceOf( UploadAbortedError );

		// The upload XHR must NOT have been wire-aborted — the
		// production code lets it complete so it knows the
		// attachment id to clean up.
		const uploadXhr = FakeXhr.instances.find(
			( i ) => i.method === 'POST',
		);
		expect( uploadXhr ).toBeDefined();
		expect( uploadXhr!.aborted ).toBe( false );

		// A DELETE must follow, pointing at the attachment the
		// server reported (id=42 in the default fixture) with
		// `force=true` so it skips trash.
		const deleteXhr = FakeXhr.instances.find(
			( i ) => i.method === 'DELETE',
		);
		expect( deleteXhr ).toBeDefined();
		expect( deleteXhr!.url ).toContain( '/wp/v2/media/42' );
		expect( deleteXhr!.url ).toContain( 'force=true' );

		// And the failure surface must report an abort (not a
		// generic failure) so HUDs can distinguish cancellation
		// from a real error.
		expect( failures ).toHaveLength( 1 );
		expect( failures[ 0 ].error ).toBeInstanceOf( UploadAbortedError );
	} );
} );
