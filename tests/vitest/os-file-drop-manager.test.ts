/**
 * Unit tests for the OS-file drop manager
 * (`src/os-file-drop/manager.ts`).
 *
 * Exercises:
 *
 *   - The mime / size policy (`partitionByPolicy`) — accepts allowed
 *     mimes, rejects with the right reason for size / mime / empty
 *     files, falls back to extension when `file.type` is blank.
 *   - The default field generator (`defaultFields`) — title, alt-text,
 *     and filename are pre-filled, alt-text is non-empty only for
 *     images, filename is sanitized.
 *   - The hook pipeline — `desktop-mode.drop.files-detected` and
 *     `desktop-mode.drop.dialog-fields` mutate the entries before the
 *     dialog opens.
 *
 * @since 0.30.0
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	clearHooksStub,
	installHooksStub,
} from './helpers/hooks-stub';
import {
	defaultFields,
	handleFiles,
	humanize,
	mountOsFileDropManager,
	partitionByPolicy,
	resolveAllowedMime,
	sanitizeFilename,
} from '../../src/os-file-drop/manager';
import { FILE_DROP_HOOKS } from '../../src/os-file-drop/hooks';
import type {
	DropContext,
	DropFileEntry,
} from '../../src/os-file-drop/types';

const IMAGE_MIMES = [ 'image/jpeg', 'image/png', 'image/gif' ];

function makeFile(
	name: string,
	type: string,
	size = 1024,
): File {
	// Construct via Blob — jsdom's `File` accepts `BlobPart[]`.
	const blob = new Blob( [ new Uint8Array( size ) ], { type } );
	return new File( [ blob ], name, { type } );
}

describe( 'os-file-drop/manager', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
		// Tear down any manager mounted during a test so the
		// window-level sentinel + listeners don't leak across
		// tests.
		const host = window as unknown as {
			__desktopModeOsFileDropMounted?: { dispose: () => void };
		};
		host.__desktopModeOsFileDropMounted?.dispose();
	} );

	describe( 'partitionByPolicy', () => {
		const config = {
			enabled: true,
			allowedMimes: IMAGE_MIMES,
			maxSize: 5 * 1024 * 1024,
		};

		test( 'accepts a file whose MIME matches the allow-list', () => {
			const file = makeFile( 'photo.png', 'image/png' );
			const { accepted, rejected } = partitionByPolicy(
				[ file ],
				config,
			);
			expect( accepted ).toHaveLength( 1 );
			expect( accepted[ 0 ].mime ).toBe( 'image/png' );
			expect( rejected ).toHaveLength( 0 );
		} );

		test( 'rejects a file whose MIME is not allowed', () => {
			const file = makeFile( 'app.exe', 'application/octet-stream' );
			const { accepted, rejected } = partitionByPolicy(
				[ file ],
				config,
			);
			expect( accepted ).toHaveLength( 0 );
			expect( rejected ).toHaveLength( 1 );
			expect( rejected[ 0 ].reason ).toBe( 'mime' );
		} );

		test( 'rejects a file that exceeds the size cap', () => {
			const file = makeFile(
				'huge.png',
				'image/png',
				6 * 1024 * 1024,
			);
			const { accepted, rejected } = partitionByPolicy(
				[ file ],
				config,
			);
			expect( accepted ).toHaveLength( 0 );
			expect( rejected[ 0 ].reason ).toBe( 'size' );
		} );

		test( 'rejects an empty file', () => {
			const file = makeFile( 'empty.png', 'image/png', 0 );
			const { rejected } = partitionByPolicy( [ file ], config );
			expect( rejected[ 0 ].reason ).toBe( 'empty' );
		} );

		test( 'maxSize=0 disables the client-side cap', () => {
			const file = makeFile(
				'huge.png',
				'image/png',
				6 * 1024 * 1024,
			);
			const { accepted } = partitionByPolicy( [ file ], {
				enabled: true,
				allowedMimes: IMAGE_MIMES,
				maxSize: 0,
			} );
			expect( accepted ).toHaveLength( 1 );
		} );
	} );

	describe( 'resolveAllowedMime', () => {
		test( 'falls back to extension when file.type is blank', () => {
			const file = makeFile( 'photo.HEIC', '' );
			const mime = resolveAllowedMime( file, [ 'image/heic' ] );
			expect( mime ).toBe( 'image/heic' );
		} );

		test( 'returns null when neither type nor extension matches', () => {
			const file = makeFile( 'data.bin', '' );
			expect( resolveAllowedMime( file, IMAGE_MIMES ) ).toBeNull();
		} );
	} );

	describe( 'sanitizeFilename', () => {
		test( 'collapses whitespace + trims', () => {
			expect( sanitizeFilename( '  My  Photo.png  ' ) ).toBe(
				'My Photo.png',
			);
		} );

		test( 'replaces path separators and trims leading dots', () => {
			// `/` and `\` collapse to `-`; leading `.` runs are
			// stripped (defends against accidental hidden-file
			// names + path-traversal pre-fill).
			expect( sanitizeFilename( '..\\Windows\\evil.exe' ) ).toBe(
				'Windows-evil.exe',
			);
			expect( sanitizeFilename( '../etc/passwd' ) ).toBe(
				'etc-passwd',
			);
		} );

		test( 'preserves Unicode (accents, CJK, emoji)', () => {
			expect( sanitizeFilename( 'café.png' ) ).toBe( 'café.png' );
			expect( sanitizeFilename( '写真.png' ) ).toBe( '写真.png' );
		} );

		test( 'never returns empty', () => {
			expect( sanitizeFilename( '' ) ).toBe( 'upload' );
			expect( sanitizeFilename( '....' ) ).toBe( 'upload' );
		} );

		test( 'strips C0 control characters', () => {
			expect( sanitizeFilename( 'file\x00name.png' ) ).toBe(
				'filename.png',
			);
		} );
	} );

	describe( 'resolveAllowedMime — server ext→mime map', () => {
		test( 'matches WordPress-style `jpg|jpeg|jpe` keys', () => {
			const file = makeFile( 'photo.jpe', '' );
			const mime = resolveAllowedMime(
				file,
				[ 'image/jpeg' ],
				{ 'jpg|jpeg|jpe': 'image/jpeg' },
			);
			expect( mime ).toBe( 'image/jpeg' );
		} );

		test( 'rejects unmapped extensions when server map is present', () => {
			const file = makeFile( 'photo.heic', '' );
			expect(
				resolveAllowedMime(
					file,
					[ 'image/jpeg' ],
					{ 'jpg|jpeg|jpe': 'image/jpeg' },
				),
			).toBeNull();
		} );
	} );

	describe( 'humanize', () => {
		test( 'replaces separators + capitalises', () => {
			expect( humanize( 'my-cool_photo' ) ).toBe( 'My cool photo' );
		} );
	} );

	describe( 'defaultFields', () => {
		test( 'pre-fills title + altText for an image', () => {
			const file = makeFile( 'sunset-beach.jpg', 'image/jpeg' );
			const fields = defaultFields( file, 'image/jpeg' );
			expect( fields.title ).toBe( 'Sunset beach' );
			expect( fields.altText ).toBe( 'Sunset beach' );
			expect( fields.filename.endsWith( '.jpg' ) ).toBe( true );
		} );

		test( 'leaves altText blank for non-images', () => {
			const file = makeFile(
				'doc.pdf',
				'application/pdf',
			);
			const fields = defaultFields( file, 'application/pdf' );
			expect( fields.altText ).toBe( '' );
		} );
	} );

	describe( 'handleFiles', () => {
		test( 'runs files-detected and dialog-fields hooks before opening dialog', async () => {
			const file = makeFile( 'photo.png', 'image/png' );
			const openDialog = vi.fn().mockResolvedValue( undefined );

			let detectedSeen: File[] | null = null;
			window.wp!.hooks!.addFilter(
				FILE_DROP_HOOKS.FILES_DETECTED,
				'test/detected',
				( files: unknown ) => {
					detectedSeen = files as File[];
					return files;
				},
			);

			window.wp!.hooks!.addFilter(
				FILE_DROP_HOOKS.DIALOG_FIELDS,
				'test/fields',
				( entry: unknown ) => {
					const e = entry as DropFileEntry;
					return {
						...e,
						fields: { ...e.fields, title: 'Overridden' },
					};
				},
			);

			const ctx: DropContext = { surface: 'wallpaper', x: 0, y: 0 };
			await handleFiles( [ file ], ctx, {
				config: {
					enabled: true,
					allowedMimes: IMAGE_MIMES,
					maxSize: 0,
				},
				mediaUrl: 'https://example.test/wp-json/wp/v2/media',
				restNonce: 'nonce',
				openDialog,
			} );

			expect( detectedSeen ).toEqual( [ file ] );
			expect( openDialog ).toHaveBeenCalledTimes( 1 );
			const entries = ( openDialog.mock.calls[ 0 ] as unknown[] )[ 0 ] as DropFileEntry[];
			expect( entries[ 0 ].fields.title ).toBe( 'Overridden' );
		} );

		test( 'a files-detected filter returning [] aborts the drop', async () => {
			const openDialog = vi.fn().mockResolvedValue( undefined );
			window.wp!.hooks!.addFilter(
				FILE_DROP_HOOKS.FILES_DETECTED,
				'test/veto',
				() => [],
			);
			await handleFiles(
				[ makeFile( 'a.png', 'image/png' ) ],
				{ surface: 'wallpaper', x: 0, y: 0 },
				{
					config: {
						enabled: true,
						allowedMimes: IMAGE_MIMES,
						maxSize: 0,
					},
					mediaUrl: '',
					restNonce: '',
					openDialog,
				},
			);
			expect( openDialog ).not.toHaveBeenCalled();
		} );

		test( 'window-level drop bails when a nested handler already preventDefault-ed', async () => {
			// Inner drop target (e.g. the Plugins .zip upload
			// dropzone) is a child of the body and calls
			// preventDefault on the drop. The window-level
			// manager must NOT also process the file — that's
			// what was opening the Media Library uploader on top
			// of the Plugins upload dialog.
			const openDialog = vi.fn().mockResolvedValue( undefined );
			mountOsFileDropManager( {
				config: {
					enabled: true,
					allowedMimes: IMAGE_MIMES,
					maxSize: 0,
				},
				mediaUrl: '',
				restNonce: '',
				openDialog,
			} );

			const inner = document.createElement( 'div' );
			document.body.appendChild( inner );
			inner.addEventListener( 'drop', ( ev ) => ev.preventDefault() );

			const file = makeFile( 'photo.png', 'image/png' );
			const dataTransfer = {
				types: [ 'Files' ],
				files: [ file ],
				dropEffect: 'copy',
			};
			const drop = new Event( 'drop', {
				bubbles: true,
				cancelable: true,
			} );
			Object.defineProperty( drop, 'dataTransfer', {
				value: dataTransfer,
			} );
			inner.dispatchEvent( drop );

			expect( openDialog ).not.toHaveBeenCalled();
		} );

		test( 'fires files-rejected when a file fails the policy', async () => {
			const openDialog = vi.fn().mockResolvedValue( undefined );
			const rejected: unknown[] = [];
			window.wp!.hooks!.addAction(
				FILE_DROP_HOOKS.FILES_REJECTED,
				'test/rejected',
				( payload: unknown ) => rejected.push( payload ),
			);
			await handleFiles(
				[ makeFile( 'bad.exe', 'application/octet-stream' ) ],
				{ surface: 'wallpaper', x: 0, y: 0 },
				{
					config: {
						enabled: true,
						allowedMimes: IMAGE_MIMES,
						maxSize: 0,
					},
					mediaUrl: '',
					restNonce: '',
					openDialog,
				},
			);
			expect( rejected ).toHaveLength( 1 );
			expect( openDialog ).not.toHaveBeenCalled();
		} );
	} );
} );
