/**
 * Unit tests for `src/os-file-drop/upload.ts`.
 *
 * Verifies the wp/v2/media multipart POST shape and the
 * `before-upload` / `after-upload` / `upload-failed` hook
 * surface.
 *
 * @since 0.30.0
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	clearHooksStub,
	installHooksStub,
} from './helpers/hooks-stub';
import { uploadFile, UploadCancelledError } from '../../src/os-file-drop/upload';
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

describe( 'os-file-drop/upload', () => {
	beforeEach( () => {
		installHooksStub();
		( window as unknown as { wp?: { desktop?: { fetch?: unknown } } } ).wp = {
			...( window as unknown as { wp?: unknown } ).wp ?? {},
			hooks: window.wp!.hooks,
			desktop: {
				fetch: ( _input: RequestInfo, init?: RequestInit ) => {
					// Capture the multipart body in a closure via the test.
					return Promise.resolve(
						new Response(
							JSON.stringify( {
								id: 42,
								source_url: 'https://example.test/uploads/test.png',
								mime_type: 'image/png',
								title: { rendered: 'Test' },
								media_details: { file: 'test.png' },
							} ),
							{
								status: 201,
								headers: { 'content-type': 'application/json' },
							},
						),
					);
				},
			},
		} as unknown as typeof window.wp;
	} );

	afterEach( () => {
		clearHooksStub();
		vi.restoreAllMocks();
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
		( window as unknown as { wp: { desktop: { fetch: unknown } } } ).wp.desktop.fetch =
			() =>
				Promise.resolve(
					new Response( JSON.stringify( { message: 'Forbidden' } ), {
						status: 403,
						headers: { 'content-type': 'application/json' },
					} ),
				);
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
} );
