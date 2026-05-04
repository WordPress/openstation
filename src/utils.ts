/**
 * Desktop Mode — Shared Utilities.
 *
 * @since 6.9.0
 */

/**
 * Query args that meaningfully differentiate admin pages.
 *
 * `post_type` separates Posts from Pages (both are edit.php). `page` is
 * the plugin-routed admin.php entry point. `taxonomy` distinguishes
 * Categories from Tags (both are edit-tags.php). Everything else —
 * pagination, nonces, action-feedback flags, our internal desktop_mode_chromeless
 * marker — is considered transient and stripped, so a direct-URL land
 * and a dock click resolve to the same window ID.
 */
const IDENTITY_PARAMS: readonly string[] = [ 'post_type', 'page', 'taxonomy' ];

/**
 * Collapse a URL path (plus its significant query params) into a clean
 * slug that is safe to use as a DOM id attribute.
 */
function slugify( path: string ): string {
	return path
		.replace( /\.php/g, '-php' )
		.replace( /[?&=]/g, '-' )
		.replace( /[^a-zA-Z0-9_-]/g, '' )
		.replace( /-+/g, '-' )
		.replace( /^-|-$/g, '' ) || 'index';
}

/**
 * Derive a window ID from an admin page URL.
 *
 * The ID is the admin filename plus any query params that distinguish
 * one admin page from another (see IDENTITY_PARAMS). Transient params —
 * desktop_mode_chromeless, _wpnonce, paged, message — are discarded so the same
 * logical page always maps to the same window, whether reached via
 * direct URL or via the dock.
 *
 * @param url      The full admin page URL.
 * @param adminUrl The base admin URL (e.g., 'http://localhost/wp-admin/').
 * @return A sanitized window ID string.
 */
export function deriveWindowId( url: string, adminUrl: string ): string {
	let parsed: URL | null = null;
	try {
		parsed = new URL( url, adminUrl );
	} catch ( err ) {
		parsed = null;
	}

	if ( parsed ) {
		const basePath = new URL( adminUrl ).pathname;
		const filename = parsed.pathname.replace( basePath, '' ).replace( /^\/+/, '' );

		const significant = new URLSearchParams();
		for ( const key of IDENTITY_PARAMS ) {
			const value = parsed.searchParams.get( key );
			if ( value ) {
				significant.set( key, value );
			}
		}

		const query = significant.toString();
		return slugify( query ? `${ filename }?${ query }` : filename );
	}

	// Fallback for inputs that don't parse as URLs.
	let path = url.replace( adminUrl, '' );
	if ( path.startsWith( '/' ) ) {
		path = path.substring( 1 );
	}
	return slugify( path );
}

/**
 * Sanitize a string for safe use as a CSS class name.
 *
 * Strips any characters that are not alphanumeric, hyphens, or underscores.
 *
 * @param value The raw class name value.
 * @return The sanitized class name.
 */
export function sanitizeClassName( value: string ): string {
	return value.replace( /[^a-zA-Z0-9_-]/g, '' );
}

/**
 * Returns a comparable key for two admin URLs so equality checks work
 * regardless of the chromeless flag, the portal flag, or trailing
 * slashes. Used by the window class to match submenu tabs against
 * iframe navigation, and by the shell to compare a window's URL
 * against the default-window preference.
 *
 * Falls back to the raw URL if parsing fails — the caller will just
 * see a stricter equality check than desired, not a crash.
 */
export function urlMatchKey( url: string ): string {
	try {
		const parsed = new URL( url, window.location.origin );
		parsed.searchParams.delete( 'desktop_mode_chromeless' );
		parsed.searchParams.delete( 'desktop_mode_portal' );
		return parsed.pathname.replace( /\/+$/, '' ) + '?' + parsed.searchParams.toString();
	} catch {
		return url;
	}
}

/**
 * Sanitize an SVG string before injecting it via `innerHTML`.
 *
 * The iframe command bridge forwards `@wordpress/icons` React elements
 * through `renderToString` → postMessage → parent. The payload is
 * same-origin by construction — only a script already running with
 * admin privileges in the iframe could forge it — but "same-origin"
 * is not "safe": a compromised or malicious plugin inside the iframe
 * could register a command whose icon renders script / event-handler
 * SVG. Strip the well-known dangerous subset so a future extension of
 * the bridge (a plugin-authored icon pipeline, user-supplied themes)
 * can't turn a layout glyph into an XSS primitive.
 *
 * The policy is intentionally strict: discard anything that doesn't
 * parse into a single root `<svg>` element, drop `<script>` / `<style>`
 * / `<foreignObject>` subtrees, strip any attribute whose name starts
 * with `on`, and drop any attribute value containing `javascript:`.
 * Falls back to an empty string when the DOM parser isn't available
 * (SSR, unit tests without jsdom) — callers treat empty as "no SVG,
 * use the dashicon fallback".
 */
export function sanitizeIconSvg( svg: string ): string {
	if ( typeof svg !== 'string' || svg === '' ) {
		return '';
	}
	if ( typeof DOMParser === 'undefined' ) {
		return '';
	}
	let doc: Document;
	try {
		doc = new DOMParser().parseFromString( svg, 'image/svg+xml' );
	} catch {
		return '';
	}
	const root = doc.documentElement;
	if ( ! root || root.nodeName.toLowerCase() !== 'svg' ) {
		return '';
	}
	// Bail on any parsererror node the browser inserts on malformed input.
	if ( doc.getElementsByTagName( 'parsererror' ).length > 0 ) {
		return '';
	}

	const BANNED_TAGS = new Set( [ 'script', 'style', 'foreignobject', 'iframe', 'object', 'embed' ] );
	const walk = ( el: Element ): void => {
		// Snapshot first — we mutate siblings during traversal.
		const children = Array.from( el.children );
		for ( const child of children ) {
			if ( BANNED_TAGS.has( child.nodeName.toLowerCase() ) ) {
				child.remove();
				continue;
			}
			// Strip event-handler attributes and javascript: URLs.
			for ( const attr of Array.from( child.attributes ) ) {
				const name = attr.name.toLowerCase();
				const value = attr.value.trim().toLowerCase();
				if ( name.startsWith( 'on' ) ) {
					child.removeAttribute( attr.name );
					continue;
				}
				if ( value.startsWith( 'javascript:' ) ) {
					child.removeAttribute( attr.name );
				}
			}
			walk( child );
		}
	};
	walk( root );

	// Root attributes need the same treatment.
	for ( const attr of Array.from( root.attributes ) ) {
		const name = attr.name.toLowerCase();
		const value = attr.value.trim().toLowerCase();
		if ( name.startsWith( 'on' ) || value.startsWith( 'javascript:' ) ) {
			root.removeAttribute( attr.name );
		}
	}

	return root.outerHTML;
}
