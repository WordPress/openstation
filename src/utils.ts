/**
 * OpenStation — Shared Utilities.
 */

/**
 * Query args that meaningfully differentiate admin pages.
 *
 * `post_type` separates Posts from Pages (both are edit.php). `page` is
 * the plugin-routed admin.php entry point. `taxonomy` distinguishes
 * Categories from Tags (both are edit-tags.php). `post` is the post ID
 * on post.php — different posts must resolve to different windows so
 * opening a second post from the Posts list doesn't just refocus the
 * first. Everything else — pagination, nonces, action-feedback flags,
 * our internal openstation_chromeless marker — is considered transient
 * and stripped, so a direct-URL land and a dock click resolve to the
 * same window ID.
 */
const IDENTITY_PARAMS: readonly string[] = [
	'post_type',
	'page',
	'taxonomy',
	// WooCommerce (and other React-app-style plugins) register
	// SEPARATE top-level admin menus that all share `?page=wc-admin`
	// and only differ by `path` (e.g. `path=/analytics/overview`,
	// `path=/marketing`). Without `path` in the identity set, every
	// such menu collapses to the same window id — opening any one of
	// them lights up the dock indicator for ALL of them. WC's
	// /admin/path query is the most prominent example today; future
	// plugins that route inside `admin.php?page=` via a custom param
	// can either piggyback on `path` or grow this list.
	'path',
	// The post ID on `post.php?post=X&action=edit`. Without this, every
	// individual post edit URL collapses to `post-php`, so clicking a
	// second row in the Posts window just refocuses the first post's
	// window instead of opening the new one.
	'post',
	// The comment ID on `comment.php?action=editcomment&c=X` — the exact
	// analogue of `post` above. Without it every comment-edit URL
	// collapses to `comment-php`, so opening a second comment replaces
	// the first comment's window instead of opening its own (and the
	// window-links ties can only ever point at one comment at a time).
	'c',
	// NOTE: the generic `id` param is deliberately NOT identity.
	// Plugin list screens use `admin.php?page=foo&action=…&id=N` for
	// row actions; treating `id` as identity would open every such
	// action in a NEW window instead of navigating the list in place.
	// The cost: two entities of the same `admin.php?page=` screen
	// (e.g. two WooCommerce HPOS orders) can't be open side by side —
	// plugins that want that can differentiate via `path` or their own
	// window ids.
	// The term ID on `term.php?taxonomy=category&tag_ID=X` — the term
	// analogue of `post`. Without it every term-edit URL of the same
	// taxonomy collapses to one window, so opening a second category
	// from a post's Related menu just refocuses the first term's
	// window instead of opening its own.
	'tag_ID',
	// The attachment ID on `upload.php?item=X` (Media Library grid
	// with the details modal open). Without it every deep-linked media
	// item collapses to the plain `upload-php` window, so opening a
	// second image from a post's Related menu refocuses the first.
	'item',
	// Site-editor entity path: `site-editor.php?p=/wp_template_part/
	// twentytwentyfive//footer-columns`. Each template / template
	// part / pattern / navigation entity is a distinct "page" from
	// the user's perspective — picking "Header" after "Footer column"
	// should open a new window, not refocus the existing footer one.
	// Without `p` in identity, every site-editor URL collapses to
	// `site-editor-php` and the second pick is a no-op. Page identity
	// deliberately drops it — see PAGE_IDENTITY_PARAMS.
	'p',
];

/**
 * {@link IDENTITY_PARAMS} minus `p`, the site editor's own route.
 *
 * `p` separates WINDOWS — two templates are two windows — but not
 * PAGES: `site-editor.php` is one screen with a client-side router
 * behind it, the way `nav-menus.php?action=…` is one screen with
 * sub-views. WordPress also redirects a bare `site-editor.php`
 * carrying ANY query string — and ours always carries
 * `openstation_chromeless=1` — to `site-editor.php?…&p=/`, so counting
 * `p` as page identity left the URL the iframe lands on owned by no
 * tab at all, and the Appearance window's whole strip went dark the
 * moment the editor loaded.
 */
const PAGE_IDENTITY_PARAMS: readonly string[] = IDENTITY_PARAMS.filter(
	( key ) => key !== 'p',
);

/**
 * Collapse a URL path (plus its significant query params) into a clean
 * slug that is safe to use as a DOM id attribute.
 */
function slugify( path: string ): string {
	let decoded = path;
	try {
		decoded = decodeURIComponent( path );
	} catch {
		decoded = path;
	}
	return decoded
		.replace( /\.php/g, '-php' )
		.replace( /[?&=/]/g, '-' )
		.replace( /[^a-zA-Z0-9_-]/g, '' )
		.replace( /-+/g, '-' )
		.replace( /^-|-$/g, '' ) || 'index';
}

/**
 * Derive a window ID from an admin page URL.
 *
 * The ID is the admin filename plus any query params that distinguish
 * one admin page from another (see IDENTITY_PARAMS). Transient params —
 * openstation_chromeless, _wpnonce, paged, message — are discarded so the same
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
 * Apply a randomized fade-in cadence to a freshly-built file/icon
 * tile. The animation itself is declared in CSS on
 * `.os-file-tile`; this helper writes the two CSS
 * custom properties that drive the per-tile stagger:
 *
 *   - `--os-file-tile-enter-delay`: 0 → 0.25s
 *   - `--os-file-tile-enter-duration`: 0.3 → 0.55s
 *
 * Both ranges sit in the decimal-of-a-second window, so a grid of
 * tiles reads as a soft cascade rather than a uniform pop-in.
 *
 * Call once per tile, immediately after creating the element.
 *
 * @public
 */
export function applyTileEntryStagger( tile: HTMLElement ): void {
	tile.style.setProperty(
		'--os-file-tile-enter-delay',
		`${ ( Math.random() * 0.25 ).toFixed( 3 ) }s`,
	);
	tile.style.setProperty(
		'--os-file-tile-enter-duration',
		`${ ( 0.3 + Math.random() * 0.25 ).toFixed( 3 ) }s`,
	);
}

/**
 * Returns a key identifying the admin *page* a URL points at, ignoring
 * every param that only varies the view of that page — `action`,
 * `paged`, `s`, filters, nonces, feedback flags. Only
 * {@link PAGE_IDENTITY_PARAMS} survive, so `nav-menus.php`,
 * `nav-menus.php?action=locations`, and `nav-menus.php?action=edit&menu=2`
 * all collapse to the same key, while `edit-tags.php?taxonomy=category`
 * and `edit-tags.php?taxonomy=post_tag` stay apart.
 *
 * Same identity rule {@link deriveWindowId} uses to decide which window
 * owns a URL, minus the slugification and the in-screen route — this
 * variant compares URLs rather than minting DOM ids, so it keeps the
 * raw pathname and needs no `adminUrl` base. Used by the submenu tab
 * strip to keep a tab lit while the user moves around within its page.
 *
 * Falls back to the raw URL if parsing fails.
 */
export function pageIdentityKey( url: string ): string {
	try {
		const parsed = new URL( url, window.location.origin );
		const significant = new URLSearchParams();
		for ( const key of PAGE_IDENTITY_PARAMS ) {
			const value = parsed.searchParams.get( key );
			if ( value ) {
				significant.set( key, value );
			}
		}
		significant.sort();
		const query = significant.toString();
		return (
			parsed.pathname.replace( /\/+$/, '' ) + ( query ? `?${ query }` : '' )
		);
	} catch {
		return url;
	}
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
		parsed.searchParams.delete( 'openstation_chromeless' );
		parsed.searchParams.delete( 'desktop_mode_portal' );
		return parsed.pathname.replace( /\/+$/, '' ) + '?' + parsed.searchParams.toString();
	} catch {
		return url;
	}
}

/**
 * Returns a comparable identity key for deciding whether a
 * `windowManager.open()` call that matched an existing window is a
 * plain re-focus or a request to show a DIFFERENT URL in that window.
 *
 * Broader than {@link urlMatchKey}: besides the chromeless / portal
 * flags it also drops `_wp_http_referer` (the shell stamps that onto
 * cross-window links purely as a redirect hint — see
 * `stampSourceReferer` in `src/window/iframe-bridge.ts`) and sorts
 * the remaining params so semantically-equal URLs compare equal
 * regardless of param order. Everything else — `action`, `_wpnonce`,
 * `paged`, `s`, … — stays significant: an action URL (e.g.
 * `plugins.php?action=activate&plugin=…&_wpnonce=…`) and its landing
 * page (`plugins.php`) must NOT collapse to the same key.
 *
 * Falls back to the raw URL if parsing fails — the caller just sees
 * a stricter equality check than desired, not a crash.
 */
export function urlReuseKey( url: string ): string {
	try {
		const parsed = new URL( url, window.location.origin );
		parsed.searchParams.delete( 'openstation_chromeless' );
		parsed.searchParams.delete( 'desktop_mode_portal' );
		parsed.searchParams.delete( '_wp_http_referer' );
		parsed.searchParams.sort();
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

/* ----------------------------------------------------------------- *
 *  bindBackgroundActivate — "click on the bg, but only if pointer
 *  down AND pointer up land on the same background element."
 *
 *  Browsers fire the synthesized `click` event on the deepest common
 *  ancestor of `pointerdown.target` and `pointerup.target`. So a
 *  user who pointer-downs on a tile and pointer-ups on the wallpaper
 *  triggers a `click` whose target is the wallpaper — opening the
 *  wallpaper context menu even though the user was clearly trying
 *  to drag the tile.
 *
 *  This helper sidesteps the `click` event entirely and tracks the
 *  pointerdown / pointerup pair manually. The activation only fires
 *  when:
 *
 *    - Both pointerdown and pointerup land on an element that the
 *      `isBackground` predicate accepts (returns `true`).
 *    - The element receiving pointerdown is the SAME element that
 *      receives pointerup.
 *    - The pointer button is primary (left).
 *
 *  Used by every "click on the wallpaper" / "click on the canvas
 *  bg" interaction in the shell — wallpaper context menu, icon-
 *  canvas context menu, future selection-rectangle starts.
 * ----------------------------------------------------------------- */

/**
 * Result of calling {@link bindBackgroundActivate}. Call `dispose()`
 * on window close so the listeners don't leak past the host.
 *
 * @public
 */
export interface BackgroundActivateHandle {
	dispose: () => void;
}

/**
 * Subscribe to "primary-click on the host's own background" events,
 * with a strict pointerdown / pointerup co-location requirement.
 * See the comment block above for the why.
 *
 * @public
 *
 * @param host         Element to attach listeners to. Typically the
 *                     wallpaper / canvas itself.
 * @param isBackground Predicate that decides whether a given
 *                     pointer target counts as "the background"
 *                     (vs. a tile, the menu, or any other foreground
 *                     descendant). Receives the raw `EventTarget` —
 *                     return `false` for anything that isn't bg.
 * @param onActivate   Fired when both pointerdown and pointerup land
 *                     on the same background element. Receives the
 *                     viewport coords of the pointerup, so callers
 *                     can position a context menu under the cursor.
 * @return Handle with `dispose()`.
 */
export function bindBackgroundActivate(
	host: HTMLElement,
	isBackground: ( target: EventTarget | null ) => boolean,
	onActivate: ( x: number, y: number ) => void,
): BackgroundActivateHandle {
	let armed: EventTarget | null = null;

	const onPointerDown = ( e: PointerEvent ) => {
		if ( e.button !== 0 ) {
			armed = null;
			return;
		}
		armed = isBackground( e.target ) ? e.target : null;
	};

	const onPointerUp = ( e: PointerEvent ) => {
		const target = armed;
		armed = null;
		if ( e.button !== 0 || ! target ) {
			return;
		}
		if ( e.target !== target ) {
			return;
		}
		if ( ! isBackground( e.target ) ) {
			return;
		}
		onActivate( e.clientX, e.clientY );
	};

	const onPointerCancel = () => {
		armed = null;
	};

	host.addEventListener( 'pointerdown', onPointerDown );
	host.addEventListener( 'pointerup', onPointerUp );
	host.addEventListener( 'pointercancel', onPointerCancel );

	return {
		dispose() {
			host.removeEventListener( 'pointerdown', onPointerDown );
			host.removeEventListener( 'pointerup', onPointerUp );
			host.removeEventListener( 'pointercancel', onPointerCancel );
		},
	};
}

/**
 * Decode HTML entities from a string cleanly using a temporary textarea.
 */
export function decodeHTML( raw: string ): string {
	const ta = document.createElement( 'textarea' );
	ta.innerHTML = raw;
	return ta.value;
}

