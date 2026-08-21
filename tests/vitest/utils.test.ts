/**
 * Unit tests for `src/utils.ts` — pure helper functions. No hooks
 * stub needed; these functions only touch DOM-parser primitives
 * (URL) and string methods.
 */
import { describe, expect, test } from 'vitest';
import {
	deriveWindowId,
	pageIdentityKey,
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

	test( 'strips transient query args (openstation_chromeless, _wpnonce, paged, message)', () => {
		const clean = deriveWindowId( `${ ADMIN }edit.php`, ADMIN );
		const noisy = deriveWindowId(
			`${ ADMIN }edit.php?openstation_chromeless=1&_wpnonce=abc&paged=3&message=1`,
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

	test( 'separates individual post edit URLs by the `post` query arg', () => {
		// Regression: without `post` in the identity set, every
		// post.php?post=X&action=edit URL collapses to `post-php`, so
		// clicking a second post in the Posts window just refocuses
		// the first post's window.
		const first = deriveWindowId(
			`${ ADMIN }post.php?post=123&action=edit`,
			ADMIN,
		);
		const second = deriveWindowId(
			`${ ADMIN }post.php?post=456&action=edit`,
			ADMIN,
		);
		expect( first ).not.toBe( second );
		expect( first ).toBe( 'post-php-post-123' );
	} );

	test( 'keeps the generic `id` query arg transient (plugin row actions)', () => {
		// `admin.php?page=foo&action=duplicate&id=3` is a row action on
		// the foo LIST screen — it must resolve to the list window's id
		// so the action navigates in place instead of spawning a window.
		const list = deriveWindowId( `${ ADMIN }admin.php?page=foo`, ADMIN );
		const action = deriveWindowId(
			`${ ADMIN }admin.php?page=foo&action=duplicate&id=3`,
			ADMIN,
		);
		expect( action ).toBe( list );
	} );

	test( 'separates individual term edit URLs by the `tag_ID` query arg', () => {
		// Regression: without `tag_ID` in the identity set, every
		// term.php URL of the same taxonomy collapses to one window, so
		// opening a second category from a post's Related menu just
		// refocuses the first term's window.
		const first = deriveWindowId(
			`${ ADMIN }term.php?taxonomy=category&tag_ID=3`,
			ADMIN,
		);
		const second = deriveWindowId(
			`${ ADMIN }term.php?taxonomy=category&tag_ID=7`,
			ADMIN,
		);
		expect( first ).not.toBe( second );
	} );

	test( 'separates media detail deep links by the `item` query arg', () => {
		// Regression: without `item` in the identity set, every
		// upload.php?item=X URL collapses to `upload-php`, so opening a
		// second image from a post's Related menu refocuses the first.
		const first = deriveWindowId( `${ ADMIN }upload.php?item=5`, ADMIN );
		const second = deriveWindowId( `${ ADMIN }upload.php?item=9`, ADMIN );
		expect( first ).not.toBe( second );
		expect( first ).not.toBe( deriveWindowId( `${ ADMIN }upload.php`, ADMIN ) );
	} );

	test( 'separates individual comment edit URLs by the `c` query arg', () => {
		// Regression: without `c` in the identity set, every
		// comment.php?action=editcomment&c=X URL collapses to
		// `comment-php`, so opening a second comment replaces the first
		// comment's window instead of opening its own.
		const first = deriveWindowId(
			`${ ADMIN }comment.php?action=editcomment&c=500`,
			ADMIN,
		);
		const second = deriveWindowId(
			`${ ADMIN }comment.php?action=editcomment&c=501`,
			ADMIN,
		);
		expect( first ).not.toBe( second );
		expect( first ).toBe( 'comment-php-c-500' );
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

	test( 'separates site-editor entities by the `p` route', () => {
		const home = deriveWindowId(
			`${ ADMIN }site-editor.php?p=/wp_template/twentytwentyfive//home`,
			ADMIN,
		);
		const footer = deriveWindowId(
			`${ ADMIN }site-editor.php?p=/wp_template_part/twentytwentyfive//footer`,
			ADMIN,
		);
		expect( home ).not.toBe( footer );
	} );

	test( 'falls back to slugify for non-URL input', () => {
		expect( deriveWindowId( 'index.php', ADMIN ) ).toBe( 'index-php' );
	} );

	test( 'returns a default slug for empty paths', () => {
		expect( deriveWindowId( ADMIN, ADMIN ) ).toBe( 'index' );
	} );
} );

describe( 'utils/pageIdentityKey', () => {
	test( 'collapses a screen’s own sub-views onto one key', () => {
		expect( pageIdentityKey( `${ ADMIN }nav-menus.php?action=locations` ) ).toBe(
			pageIdentityKey( `${ ADMIN }nav-menus.php` ),
		);
	} );

	test( 'keeps genuinely different pages apart', () => {
		expect(
			pageIdentityKey( `${ ADMIN }edit-tags.php?taxonomy=category` ),
		).not.toBe(
			pageIdentityKey( `${ ADMIN }edit-tags.php?taxonomy=post_tag` ),
		);
	} );

	test( 'ignores the site editor’s `p` route', () => {
		// `p` separates WINDOWS (two templates are two windows) but not
		// PAGES: `site-editor.php` is one screen with a router behind
		// it, and WordPress redirects the bare URL to `?p=/` on arrival.
		// Counting it as page identity blanked the Appearance window's
		// tab strip the moment the editor loaded.
		const bare = pageIdentityKey( `${ ADMIN }site-editor.php` );
		expect( pageIdentityKey( `${ ADMIN }site-editor.php?p=/` ) ).toBe( bare );
		expect(
			pageIdentityKey(
				`${ ADMIN }site-editor.php?p=/wp_template/twentytwentyfive//home`,
			),
		).toBe( bare );
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
	test( 'equates admin URLs that differ only in the openstation_chromeless flag', () => {
		const plain = urlMatchKey( `${ ADMIN }edit.php?post_type=post` );
		const chromeless = urlMatchKey(
			`${ ADMIN }edit.php?post_type=post&openstation_chromeless=1`,
		);
		expect( plain ).toBe( chromeless );
	} );

	test( 'equates URLs that differ in the portal flag', () => {
		const plain = urlMatchKey( `${ ADMIN }index.php` );
		const portal = urlMatchKey( `${ ADMIN }index.php?desktop_mode_portal=1` );
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
