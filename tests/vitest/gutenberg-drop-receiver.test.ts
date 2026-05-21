/**
 * Unit tests for the Gutenberg drop-receiver's payload → block
 * mapping. The receiver itself is a side-effect bundle that listens
 * on `window.message`, but the block-spec factory is a pure function
 * exported for test access.
 */
import { describe, expect, test } from 'vitest';
import { buildBlockSpec } from '../../src/gutenberg-drop-receiver';

describe( 'buildBlockSpec — attachment', () => {
	test( 'maps an image attachment to core/image with id + url + alt', () => {
		const spec = buildBlockSpec( {
			kind: 'attachment',
			id: 42,
			url: 'https://example.test/wp-content/uploads/cat.png',
			title: 'Cat',
			alt: 'A grey cat',
			mime: 'image/png',
		} );
		expect( spec ).toEqual( {
			name: 'core/image',
			attributes: {
				id: 42,
				url: 'https://example.test/wp-content/uploads/cat.png',
				alt: 'A grey cat',
				caption: '',
			},
		} );
	} );

	test( 'falls back to empty alt when source omitted it', () => {
		const spec = buildBlockSpec( {
			kind: 'attachment',
			id: 7,
			url: 'https://example.test/x.jpg',
			title: 'X',
			alt: '',
			mime: 'image/jpeg',
		} );
		expect( spec?.attributes.alt ).toBe( '' );
	} );

	test( 'maps a video attachment to core/video', () => {
		const spec = buildBlockSpec( {
			kind: 'attachment',
			id: 99,
			url: 'https://example.test/clip.mp4',
			title: 'Clip',
			alt: '',
			mime: 'video/mp4',
		} );
		expect( spec ).toEqual( {
			name: 'core/video',
			attributes: { id: 99, src: 'https://example.test/clip.mp4' },
		} );
	} );

	test( 'maps an audio attachment to core/audio', () => {
		const spec = buildBlockSpec( {
			kind: 'attachment',
			id: 100,
			url: 'https://example.test/song.mp3',
			title: 'Song',
			alt: '',
			mime: 'audio/mpeg',
		} );
		expect( spec ).toEqual( {
			name: 'core/audio',
			attributes: { id: 100, src: 'https://example.test/song.mp3' },
		} );
	} );

	test( 'maps a generic file attachment to core/file', () => {
		const spec = buildBlockSpec( {
			kind: 'attachment',
			id: 200,
			url: 'https://example.test/doc.pdf',
			title: 'doc.pdf',
			alt: '',
			mime: 'application/pdf',
		} );
		expect( spec ).toEqual( {
			name: 'core/file',
			attributes: {
				id: 200,
				href: 'https://example.test/doc.pdf',
				fileName: 'doc.pdf',
			},
		} );
	} );
} );

describe( 'buildBlockSpec — post / user', () => {
	test( 'maps a post payload to a paragraph anchor', () => {
		const spec = buildBlockSpec( {
			kind: 'post',
			id: 5,
			postType: 'post',
			url: 'https://example.test/hello-world/',
			title: 'Hello World',
		} );
		expect( spec ).toEqual( {
			name: 'core/paragraph',
			attributes: {
				content:
					'<a href="https://example.test/hello-world/">Hello World</a>',
			},
		} );
	} );

	test( 'maps a user payload to a paragraph anchor', () => {
		const spec = buildBlockSpec( {
			kind: 'user',
			id: 1,
			url: 'https://example.test/author/admin/',
			title: 'Admin',
		} );
		expect( spec ).toEqual( {
			name: 'core/paragraph',
			attributes: {
				content: '<a href="https://example.test/author/admin/">Admin</a>',
			},
		} );
	} );

	test( 'escapes HTML in title + href to neutralize hostile content', () => {
		const spec = buildBlockSpec( {
			kind: 'post',
			id: 9,
			postType: 'post',
			url: 'https://example.test/x?a=1&b=<script>',
			title: 'Mean & "quoted" <script>',
		} );
		// All five sensitive chars must be escaped in BOTH href and text.
		expect( spec?.attributes.content ).toBe(
			'<a href="https://example.test/x?a=1&amp;b=&lt;script&gt;">Mean &amp; &quot;quoted&quot; &lt;script&gt;</a>',
		);
	} );

	test( 'returns null when the post payload has no URL (silent no-op)', () => {
		const spec = buildBlockSpec( {
			kind: 'post',
			id: 1,
			postType: 'post',
			url: '',
			title: 'Untitled',
		} );
		expect( spec ).toBeNull();
	} );

	test( 'returns null when the user payload has no URL', () => {
		const spec = buildBlockSpec( {
			kind: 'user',
			id: 1,
			url: '',
			title: 'Admin',
		} );
		expect( spec ).toBeNull();
	} );

	test( 'falls back to the URL as anchor text when title is empty', () => {
		const spec = buildBlockSpec( {
			kind: 'post',
			id: 10,
			postType: 'post',
			url: 'https://example.test/post-10/',
			title: '',
		} );
		expect( spec?.attributes.content ).toBe(
			'<a href="https://example.test/post-10/">https://example.test/post-10/</a>',
		);
	} );
} );
