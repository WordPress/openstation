/**
 * Unit tests for `src/utils.ts` — pure helper functions. No hooks
 * stub needed; these functions only touch DOM-parser primitives
 * (URL) and string methods.
 */
import { describe, expect, test } from 'vitest';
import {
	deriveWindowId,
	sanitizeClassName,
	sanitizeIconSvg,
	urlMatchKey,
} from '../../src/utils';

const ADMIN = 'http://localhost/wp-admin/';

describe( 'utils/deriveWindowId', () => {
	test( 'returns the admin page filename for a simple URL', () => {
		expect( deriveWindowId( `${ ADMIN }edit.php`, ADMIN ) ).toBe(
			'edit-php'
		);
	} );

	test( 'separates Posts from Pages by post_type query arg', () => {
		const posts = deriveWindowId(
			`${ ADMIN }edit.php?post_type=post`,
			ADMIN,
		);
		const pages = deriveWindowId(
			`${ ADMIN }edit.php?post_type=page`,
			ADMIN,
		);
		expect( posts ).not.toBe( pages );
	} );

	test( 'separates custom post types by post_type', () => {
		expect(
			deriveWindowId( `${ ADMIN }edit.php?post_type=product`, ADMIN ),
		).toBe( 'edit-php-post_type-product' );
	} );

	test( 'strips transient query args (wp_desktop, _wpnonce, paged, message)', () => {
		const clean = deriveWindowId( `${ ADMIN }edit.php`, ADMIN );
		const noisy = deriveWindowId(
			`${ ADMIN }edit.php?wp_desktop=1&_wpnonce=abc&paged=3&message=1`,
			ADMIN,
		);
		expect( noisy ).toBe( clean );
	} );

	test( 'separates taxonomies on edit-tags.php by taxonomy', () => {
		const cats = deriveWindowId(
			`${ ADMIN }edit-tags.php?taxonomy=category`,
			ADMIN,
		);
		const tags = deriveWindowId(
			`${ ADMIN }edit-tags.php?taxonomy=post_tag`,
			ADMIN,
		);
		expect( cats ).not.toBe( tags );
	} );

	test( 'separates plugin-routed pages by the `page` query arg', () => {
		const one = deriveWindowId(
			`${ ADMIN }admin.php?page=my-plugin`,
			ADMIN,
		);
		const two = deriveWindowId(
			`${ ADMIN }admin.php?page=other-plugin`,
			ADMIN,
		);
		expect( one ).not.toBe( two );
	} );

	test( 'falls back to slugify for non-URL input', () => {
		expect( deriveWindowId( 'index.php', ADMIN ) ).toBe( 'index-php' );
	} );

	test( 'returns a default slug for empty paths', () => {
		expect( deriveWindowId( ADMIN, ADMIN ) ).toBe( 'index' );
	} );
} );

describe( 'utils/sanitizeClassName', () => {
	test( 'strips invalid characters', () => {
		expect( sanitizeClassName( 'hello world!' ) ).toBe( 'helloworld' );
	} );

	test( 'preserves letters, digits, hyphens, underscores', () => {
		expect( sanitizeClassName( 'dashicons-admin-post_1' ) ).toBe(
			'dashicons-admin-post_1',
		);
	} );

	test( 'handles empty string without crashing', () => {
		expect( sanitizeClassName( '' ) ).toBe( '' );
	} );
} );

describe( 'utils/urlMatchKey', () => {
	test( 'equates admin URLs that differ only in the wp_desktop flag', () => {
		const plain = urlMatchKey( `${ ADMIN }edit.php?post_type=post` );
		const chromeless = urlMatchKey(
			`${ ADMIN }edit.php?post_type=post&wp_desktop=1`,
		);
		expect( plain ).toBe( chromeless );
	} );

	test( 'equates URLs that differ in the portal flag', () => {
		const plain = urlMatchKey( `${ ADMIN }index.php` );
		const portal = urlMatchKey( `${ ADMIN }index.php?wp_desktop_portal=1` );
		expect( plain ).toBe( portal );
	} );

	test( 'distinguishes URLs that differ in identity args', () => {
		expect(
			urlMatchKey( `${ ADMIN }edit.php?post_type=post` ),
		).not.toBe( urlMatchKey( `${ ADMIN }edit.php?post_type=page` ) );
	} );

	test( 'trailing slash does not affect the key', () => {
		expect( urlMatchKey( `${ ADMIN }edit.php` ) ).toBe(
			urlMatchKey( `${ ADMIN }edit.php/` ),
		);
	} );

	test( 'unparseable input falls back to the raw string', () => {
		// `new URL()` throws on a malformed string with no base-relative
		// interpretation available; the function promises to return the
		// input as-is rather than bubbling up a TypeError.
		const weird = 'not a\0 url';
		expect( urlMatchKey( weird ) ).toBeTypeOf( 'string' );
	} );
} );

describe( 'utils/sanitizeIconSvg', () => {
	test( 'round-trips a clean <svg> through the parser', () => {
		const input = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';
		const out = sanitizeIconSvg( input );
		expect( out ).toContain( '<svg' );
		expect( out ).toContain( '<path' );
		expect( out ).toContain( 'viewBox="0 0 24 24"' );
	} );

	test( 'strips <script> children', () => {
		const input = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M0 0"/></svg>';
		const out = sanitizeIconSvg( input );
		expect( out ).not.toContain( '<script' );
		expect( out ).not.toContain( 'alert' );
		expect( out ).toContain( '<path' );
	} );

	test( 'strips <foreignObject> subtrees', () => {
		const input = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="x"></iframe></foreignObject></svg>';
		const out = sanitizeIconSvg( input );
		expect( out.toLowerCase() ).not.toContain( 'foreignobject' );
		expect( out ).not.toContain( '<iframe' );
	} );

	test( 'strips on* event-handler attributes', () => {
		const input = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path onclick="x" d="M0"/></svg>';
		const out = sanitizeIconSvg( input );
		expect( out ).not.toContain( 'onload' );
		expect( out ).not.toContain( 'onclick' );
		expect( out ).toContain( '<path' );
	} );

	test( 'strips javascript: URL attribute values', () => {
		const input = '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><path d="M0"/></a></svg>';
		const out = sanitizeIconSvg( input );
		expect( out.toLowerCase() ).not.toContain( 'javascript:' );
	} );

	test( 'returns empty string when root is not an <svg>', () => {
		expect( sanitizeIconSvg( '<div>nope</div>' ) ).toBe( '' );
	} );

	test( 'returns empty string for empty input', () => {
		expect( sanitizeIconSvg( '' ) ).toBe( '' );
	} );

	test( 'returns empty string for malformed markup', () => {
		// Parse error path — the function bails rather than returning
		// partially-recovered output.
		const out = sanitizeIconSvg( '<svg><path' );
		expect( out ).toBe( '' );
	} );
} );
