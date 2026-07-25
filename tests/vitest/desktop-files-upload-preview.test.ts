/**
 * Tests for the upload preview pane: inline media rendering via
 * the authenticated download URL, the no-preview fallback with a
 * Download action, and the `desktop-mode.files.preview` filter
 * that lets plugins take over (the PDF-extension seam).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

async function load() {
	vi.resetModules();
	const rest = await import( '../../src/desktop-files/rest' );
	rest.installRestDeps( {
		baseUrl: 'https://example.test/wp-json/desktop-mode/v1/files',
		nonce: 'abc',
	} );
	return await import( '../../src/desktop-files/preview' );
}

const uploadPlacement = ( kind: string, mime: string ) => ( {
	id: 1,
	parentId: 0,
	x: 0,
	y: 0,
	sortOrder: 0,
	updatedAtMs: 1,
	meta: null,
	file: {
		type: 'upload',
		ref: '7',
		title: 'holiday.jpg',
		icon: 'dashicons-format-image',
		previewUrl: '',
		exists: true,
		mime,
		sizeBytes: 2048,
		kind,
	},
} );

const tick = () => new Promise( ( r ) => setTimeout( r, 0 ) );

describe( 'upload preview', () => {
	beforeEach( () => {
		installHooksStub();
		document.body.innerHTML = '';
	} );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'image uploads render inline from the download URL', async () => {
		const preview = await load();
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		preview.renderPlacementPreview( uploadPlacement( 'image', 'image/jpeg' ), host );
		await tick();
		const img = host.querySelector< HTMLImageElement >( 'img' );
		expect( img ).not.toBeNull();
		expect( img!.src ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/files/uploads/7/download?_wpnonce=abc',
		);
		// Meta line carries mime + human size.
		expect( host.textContent ).toContain( 'image/jpeg · 2.0 KB' );
		// Download action is present.
		expect( host.querySelector( 'wpd-button' )?.textContent ).toBe( 'Download' );
	} );

	test( 'video and audio kinds render playable elements', async () => {
		const preview = await load();
		const host = document.createElement( 'div' );
		preview.renderPlacementPreview( uploadPlacement( 'video', 'video/mp4' ), host );
		await tick();
		expect( host.querySelector( 'video[controls]' ) ).not.toBeNull();

		preview.renderPlacementPreview( uploadPlacement( 'audio', 'audio/mpeg' ), host );
		await tick();
		expect( host.querySelector( 'audio[controls]' ) ).not.toBeNull();
	} );

	test( 'non-media kinds fall back to a note plus Download', async () => {
		const preview = await load();
		const host = document.createElement( 'div' );
		preview.renderPlacementPreview(
			uploadPlacement( 'pdf', 'application/pdf' ),
			host,
		);
		await tick();
		expect( host.querySelector( 'img, video, audio' ) ).toBeNull();
		expect( host.textContent ).toContain( 'No preview available for this file type.' );
		expect( host.querySelector( 'wpd-button' )?.textContent ).toBe( 'Download' );
	} );

	test( 'an undecodable image degrades to the no-preview note', async () => {
		const preview = await load();
		const host = document.createElement( 'div' );
		preview.renderPlacementPreview( uploadPlacement( 'image', 'image/heic' ), host );
		await tick();
		const img = host.querySelector< HTMLImageElement >( 'img' )!;
		img.dispatchEvent( new Event( 'error' ) );
		expect( host.querySelector( 'img' ) ).toBeNull();
		expect( host.textContent ).toContain( 'No preview available for this file type.' );
	} );

	test( 'the desktop-mode.files.preview filter lets a plugin take over (PDF seam)', async () => {
		const preview = await load();
		const hooks = await import( '../../src/hooks' );
		hooks.addFilter(
			'desktop-mode.files.preview',
			'my-plugin/pdf-preview',
			( node: unknown, placement: { file: { mime?: string } } ) => {
				if ( placement.file.mime === 'application/pdf' ) {
					const el = document.createElement( 'div' );
					el.className = 'my-plugin-pdf-viewer';
					el.textContent = 'PDF.js viewer here';
					return el;
				}
				return node;
			},
		);
		const host = document.createElement( 'div' );
		preview.renderPlacementPreview(
			uploadPlacement( 'pdf', 'application/pdf' ),
			host,
		);
		// Filter path is synchronous — no tick needed.
		expect( host.querySelector( '.my-plugin-pdf-viewer' )?.textContent ).toBe(
			'PDF.js viewer here',
		);
		// Non-PDF uploads keep the built-in renderer.
		const host2 = document.createElement( 'div' );
		preview.renderPlacementPreview( uploadPlacement( 'image', 'image/jpeg' ), host2 );
		await tick();
		expect( host2.querySelector( 'img' ) ).not.toBeNull();
	} );
} );
