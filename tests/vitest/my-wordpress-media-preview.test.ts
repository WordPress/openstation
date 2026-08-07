/**
 * Media preview pane — MIME-aware rendering + plugin action surface.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import {
	dashiconForMime,
	renderMediaPreview,
	resolvePreviewActions,
} from '../../src/my-wordpress/media-preview';
import type { MediaListItem, MediaPreviewAction } from '../../src/my-wordpress/types';

function makeMedia(
	overrides: Partial< MediaListItem > = {},
): MediaListItem {
	return {
		id: 42,
		title: { rendered: 'My photo' },
		date: '2026-01-02T03:04:05',
		mime_type: 'image/jpeg',
		source_url: 'https://example.test/wp-content/uploads/2026/01/photo.jpg',
		alt_text: 'A photo',
		caption: { rendered: '<p>Holiday snap</p>' },
		description: { rendered: '' },
		media_details: {
			width: 1600,
			height: 1200,
			filesize: 250000,
			file: '2026/01/photo.jpg',
			sizes: {
				thumbnail: { source_url: 'https://example.test/thumb.jpg' },
				large: { source_url: 'https://example.test/large.jpg' },
			},
		},
		...overrides,
	};
}

describe( 'media-preview', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'dashiconForMime picks the right icon per MIME group', () => {
		expect( dashiconForMime( 'image/png' ) ).toBe( 'dashicons-format-image' );
		expect( dashiconForMime( 'video/mp4' ) ).toBe( 'dashicons-format-video' );
		expect( dashiconForMime( 'audio/mpeg' ) ).toBe( 'dashicons-format-audio' );
		expect( dashiconForMime( 'application/pdf' ) ).toBe( 'dashicons-media-document' );
		expect( dashiconForMime( 'application/unknown' ) ).toBe( 'dashicons-media-default' );
	} );

	test( 'image preview renders <img> with large variant', () => {
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		renderMediaPreview( host, makeMedia(), {
			entityId: 'media',
			previewActions: [],
		} );
		const img = host.querySelector< HTMLImageElement >(
			'.os-my-wordpress__media-image',
		);
		expect( img ).not.toBeNull();
		expect( img!.src ).toBe( 'https://example.test/large.jpg' );
	} );

	test( 'video preview emits a <video> element with controls', () => {
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		renderMediaPreview(
			host,
			makeMedia( { mime_type: 'video/mp4', source_url: 'https://example.test/v.mp4' } ),
			{ entityId: 'media', previewActions: [] },
		);
		const v = host.querySelector< HTMLVideoElement >( 'video' );
		expect( v ).not.toBeNull();
		expect( v!.controls ).toBe( true );
		expect( v!.src ).toBe( 'https://example.test/v.mp4' );
	} );

	test( 'document preview falls back to a dashicon and an Open link', () => {
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		renderMediaPreview(
			host,
			makeMedia( { mime_type: 'application/pdf', source_url: 'https://x/doc.pdf' } ),
			{ entityId: 'media', previewActions: [] },
		);
		expect(
			host.querySelector( '.os-my-wordpress__media-fallback-icon' ),
		).not.toBeNull();
		const link = host.querySelector< HTMLAnchorElement >(
			'.os-my-wordpress__media-doc-link',
		);
		expect( link?.href ).toBe( 'https://x/doc.pdf' );
	} );

	test( 'resolvePreviewActions filters by section and MIME', () => {
		const actions: MediaPreviewAction[] = [
			{ id: 'a', label: 'A', sections: [ 'media' ] },
			{ id: 'b', label: 'B', sections: [ 'posts' ] },
			{ id: 'c', label: 'C', mime: '^image/' },
			{ id: 'd', label: 'D', mime: '^video/' },
		];
		const out = resolvePreviewActions( actions, {
			entityId: 'media',
			kind: 'media',
			mime: 'image/png',
			item: {},
		} );
		const ids = out.map( ( a ) => a.id );
		expect( ids ).toContain( 'a' );
		expect( ids ).not.toContain( 'b' );
		expect( ids ).toContain( 'c' );
		expect( ids ).not.toContain( 'd' );

		// MIME-scoped actions must NOT leak into a non-media
		// context (no `ctx.mime` provided). Fail-closed semantics.
		const nonMediaOut = resolvePreviewActions( actions, {
			entityId: 'posts',
			kind: 'post',
			item: {},
		} );
		const nonMediaIds = nonMediaOut.map( ( a ) => a.id );
		expect( nonMediaIds ).not.toContain( 'c' );
		expect( nonMediaIds ).not.toContain( 'd' );
		// Section-scoped to 'posts' still allowed.
		expect( nonMediaIds ).toContain( 'b' );
	} );

	test( 'JS preview-actions filter can attach onSelect handlers', async () => {
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		const onSelect = vi.fn();
		// Attach a filter that wires a handler onto the server descriptor.
		window.wp!.hooks!.addFilter(
			'os.my-wordpress.preview-actions',
			'test/wire',
			( actions: MediaPreviewAction[] ) =>
				actions.map( ( a ) =>
					a.id === 'compress'
						? { ...a, onSelect }
						: a,
				),
		);
		renderMediaPreview( host, makeMedia(), {
			entityId: 'media',
			previewActions: [
				{ id: 'compress', label: 'Compress', icon: 'dashicons-image-rotate' },
			],
		} );
		const btn = host.querySelector< HTMLElement >( '[data-action-id="compress"]' );
		expect( btn ).not.toBeNull();
		btn!.dispatchEvent( new Event( 'click', { bubbles: true } ) );
		expect( onSelect ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'preview-extras action fires for each slot', () => {
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		const slots: string[] = [];
		window.wp!.hooks!.addAction(
			'os.my-wordpress.preview-extras',
			'test/extras',
			( ctx: { slot: string } ) => {
				slots.push( ctx.slot );
			},
		);
		renderMediaPreview( host, makeMedia(), {
			entityId: 'media',
			previewActions: [],
		} );
		expect( slots ).toEqual( expect.arrayContaining( [ 'header', 'meta', 'footer' ] ) );
	} );
} );
