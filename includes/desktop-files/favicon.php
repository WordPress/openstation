<?php
/**
 * OpenStation — Favicon resolver.
 *
 * Resolves the favicon for an arbitrary http(s) URL, downloads the
 * bytes server-side, and returns a base64 `data:` URI suitable for
 * stuffing into a `placement.meta.iconUrl` so the tile renderer can
 * paint it without the browser making a third-party request on
 * every render.
 *
 * Pipeline:
 *
 *   1. Fetch the page HTML via `wp_safe_remote_get()` — the `_safe_`
 *      flavour blocks loopback / private-IP fetches, which prevents
 *      this user-supplied-URL endpoint from doubling as an SSRF
 *      pivot. The download is capped via `limit_response_size` so
 *      a hostile host can't stream an unbounded body into memory.
 *   2. Parse the response with `DOMDocument` (libxml errors silenced
 *      because real-world HTML is gnarly). Walk for the first
 *      `<link rel="icon|shortcut icon|apple-touch-icon" href="…">`
 *      and resolve the href against the page URL.
 *   3. Fall back to `<scheme>://<host>/favicon.ico` when no link tag
 *      is present.
 *   4. Fetch the candidate icon via `wp_safe_remote_get()`, with
 *      the download truncated at one byte over the size cap. Reject
 *      anything that isn't `image/*`, anything bigger than the
 *      configured size cap, and anything `getimagesizefromstring()`
 *      can't recognize (catches HTML pages whose servers lie about
 *      `Content-Type`).
 *   5. Base64-encode the body, return `data:image/<subtype>;base64,…`.
 *
 * Failure at any step returns `null` — the caller treats this as
 * "no favicon, render the dashicons fallback". Never throws.
 *
 * Filter the final return value through `openstation_resolve_favicon`
 * so plugins can short-circuit (return `null` to force-skip, return
 * a synthetic data URI to override).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Maximum icon body size, in bytes. Favicons are tiny — most are
 * under 4 KB. The 256 KB cap exists to keep `placement.meta` blobs
 * sane and to avoid base64-encoding a multi-megabyte payload that
 * a malicious or sloppy host might serve at `/favicon.ico`.
 */
const OPENSTATION_FAVICON_MAX_BYTES = 256 * 1024;

/**
 * Maximum page-HTML download size, in bytes, for the step-1 page
 * fetch. The `<link rel="icon">` tags live in `<head>`, so 1 MB
 * is plenty; the cap stops a malicious or sloppy host from
 * streaming an unbounded body into memory before the parser runs.
 */
const OPENSTATION_FAVICON_MAX_PAGE_BYTES = 1024 * 1024;

/**
 * Per-request HTTP timeout, in seconds. Two fetches happen worst-
 * case (page + icon) so the user-visible wait caps around 2× this
 * value. Tune downward if QA finds the dialog "Create" button
 * sitting too long.
 */
const OPENSTATION_FAVICON_TIMEOUT = 4;

/**
 * Resolve a page URL to a base64 data URI of its favicon.
 *
 * @param string $page_url HTTP(S) URL of the target page.
 * @return string|null Data URI on success; `null` on any failure.
 */
function openstation_resolve_favicon( $page_url ) {
	$result = openstation_resolve_favicon_internal( (string) $page_url );

	/**
	 * Filters the favicon data URI before it is returned to the
	 * caller. Plugins can override (return a synthetic data URI),
	 * suppress (return `null`), or pass through.
	 *
	 * @param string|null $result   Base64 data URI, or `null` if
	 *                              the resolver could not produce one.
	 * @param string      $page_url The page URL that was resolved.
	 */
	$filtered = apply_filters( 'openstation_resolve_favicon', $result, (string) $page_url );

	if ( null === $filtered ) {
		return null;
	}
	return is_string( $filtered ) ? $filtered : null;
}

/**
 * Internal resolver — see {@see openstation_resolve_favicon}.
 *
 * Kept separate so the public function is the only place the
 * `openstation_resolve_favicon` filter runs (a plugin can't sneak
 * its filter past the validation by hooking the internal helper).
 *
 * @internal
 *
 * @param string $page_url Page URL.
 * @return string|null
 */
function openstation_resolve_favicon_internal( $page_url ) {
	$parts = wp_parse_url( $page_url );
	if ( ! is_array( $parts ) || empty( $parts['host'] ) ) {
		return null;
	}
	$scheme = isset( $parts['scheme'] ) ? strtolower( $parts['scheme'] ) : '';
	if ( 'http' !== $scheme && 'https' !== $scheme ) {
		return null;
	}

	$page_response = wp_safe_remote_get( $page_url, openstation_favicon_request_args( OPENSTATION_FAVICON_MAX_PAGE_BYTES ) );
	$page_body     = '';
	if ( ! is_wp_error( $page_response ) && 200 === (int) wp_remote_retrieve_response_code( $page_response ) ) {
		$page_body = (string) wp_remote_retrieve_body( $page_response );
	}

	$candidate_url = '' !== $page_body
		? openstation_favicon_extract_link_href( $page_body, $page_url )
		: '';
	if ( '' === $candidate_url ) {
		$candidate_url = $scheme . '://' . $parts['host'] . ( isset( $parts['port'] ) ? ':' . $parts['port'] : '' ) . '/favicon.ico';
	}

	return openstation_favicon_fetch_as_data_uri( $candidate_url );
}

/**
 * Common request args for both the page fetch and the icon fetch.
 *
 * `limit_response_size` makes WP_Http stop reading at the cap, so
 * an oversize (or maliciously unbounded) body is truncated during
 * the download instead of being buffered whole into memory before
 * the size check runs.
 *
 * @internal
 *
 * @param int $limit_response_size Maximum response body size, in
 *                                 bytes, enforced by WP_Http while
 *                                 downloading. Default one byte over
 *                                 `OPENSTATION_FAVICON_MAX_BYTES`,
 *                                 so the post-fetch size check still
 *                                 rejects truncated over-cap bodies.
 * @return array
 */
function openstation_favicon_request_args( $limit_response_size = OPENSTATION_FAVICON_MAX_BYTES + 1 ) {
	return array(
		'timeout'             => OPENSTATION_FAVICON_TIMEOUT,
		'redirection'         => 3,
		'user-agent'          => 'WP OpenStation favicon resolver/1.0',
		'limit_response_size' => (int) $limit_response_size,
		'headers'             => array(
			'Accept' => 'text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5',
		),
	);
}

/**
 * Walk a chunk of HTML for the first `<link rel="icon|shortcut
 * icon|apple-touch-icon" href="…">` and resolve `href` against
 * `$base_url`. Returns the absolute icon URL, or `''` if none
 * found.
 *
 * @internal
 *
 * @param string $html     Page body.
 * @param string $base_url URL of the page that produced `$html`.
 * @return string
 */
function openstation_favicon_extract_link_href( $html, $base_url ) {
	$dom         = new DOMDocument();
	$prev_errors = libxml_use_internal_errors( true );
	// `LIBXML_NOWARNING | LIBXML_NOERROR` suppresses libxml's stderr
	// chatter on malformed HTML; we already silence libxml errors above.
	$dom->loadHTML( '<?xml encoding="UTF-8">' . $html, LIBXML_NOWARNING | LIBXML_NOERROR );
	libxml_clear_errors();
	libxml_use_internal_errors( $prev_errors );

	$links = $dom->getElementsByTagName( 'link' );
	if ( ! $links ) {
		return '';
	}

	// Preference order: a plain `icon` rel beats `shortcut icon`
	// beats `apple-touch-icon`. We collect candidates into buckets
	// then return the highest-priority one. Higher-resolution
	// `apple-touch-icon` images are nicer for retina displays but
	// usually larger than the 256 KB cap so we only fall back to
	// them when nothing else exists.
	$buckets = array(
		'icon'              => '',
		'shortcut icon'     => '',
		'apple-touch-icon'  => '',
	);

	foreach ( $links as $link ) {
		if ( ! ( $link instanceof DOMElement ) ) {
			continue;
		}
		$rel  = strtolower( trim( (string) $link->getAttribute( 'rel' ) ) );
		$href = trim( (string) $link->getAttribute( 'href' ) );
		if ( '' === $rel || '' === $href ) {
			continue;
		}
		// `rel` may carry multiple tokens (`"shortcut icon"`,
		// `"icon mask-icon"`); match against the bucket keys.
		foreach ( $buckets as $key => $existing ) {
			if ( '' !== $existing ) {
				continue;
			}
			if ( $rel === $key || in_array( $key, preg_split( '/\s+/', $rel ), true ) ) {
				$buckets[ $key ] = $href;
				break;
			}
		}
	}

	foreach ( $buckets as $href ) {
		if ( '' === $href ) {
			continue;
		}
		$absolute = openstation_favicon_absolutize_url( $href, $base_url );
		if ( '' !== $absolute ) {
			return $absolute;
		}
	}
	return '';
}

/**
 * Resolve a possibly-relative `href` against `$base_url`. Returns
 * `''` if the result isn't an http(s) URL.
 *
 * @internal
 *
 * @param string $href     Link href (absolute, scheme-relative, or path).
 * @param string $base_url Page URL.
 * @return string
 */
function openstation_favicon_absolutize_url( $href, $base_url ) {
	$href = trim( $href );
	if ( '' === $href ) {
		return '';
	}
	if ( 0 === strpos( $href, 'data:' ) ) {
		// Inline data URI — pass straight through; the fetch step
		// would reject it. Emit empty so the caller falls back to
		// `/favicon.ico`.
		return '';
	}
	// Absolute URL.
	if ( preg_match( '#^https?://#i', $href ) ) {
		return $href;
	}
	$base = wp_parse_url( $base_url );
	if ( ! is_array( $base ) || empty( $base['scheme'] ) || empty( $base['host'] ) ) {
		return '';
	}
	$origin = $base['scheme'] . '://' . $base['host'] . ( isset( $base['port'] ) ? ':' . $base['port'] : '' );

	// Scheme-relative.
	if ( 0 === strpos( $href, '//' ) ) {
		return $base['scheme'] . ':' . $href;
	}
	// Root-relative.
	if ( 0 === strpos( $href, '/' ) ) {
		return $origin . $href;
	}
	// Path-relative — resolve against the page's directory.
	$path = isset( $base['path'] ) ? $base['path'] : '/';
	$dir  = '/' === substr( $path, -1 ) ? $path : ( '' === dirname( $path ) || '.' === dirname( $path ) ? '/' : dirname( $path ) . '/' );
	return $origin . $dir . $href;
}

/**
 * Fetch the candidate icon URL and encode it as a data URI.
 *
 * @internal
 *
 * @param string $icon_url Absolute http(s) URL of the icon.
 * @return string|null
 */
function openstation_favicon_fetch_as_data_uri( $icon_url ) {
	if ( '' === $icon_url || ! preg_match( '#^https?://#i', $icon_url ) ) {
		return null;
	}
	$response = wp_safe_remote_get( $icon_url, openstation_favicon_request_args() );
	if ( is_wp_error( $response ) ) {
		return null;
	}
	if ( 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
		return null;
	}
	$content_type = strtolower( (string) wp_remote_retrieve_header( $response, 'content-type' ) );
	// Strip charset / boundary suffix.
	$content_type = trim( explode( ';', $content_type )[0] );
	if ( 0 !== strpos( $content_type, 'image/' ) ) {
		return null;
	}
	$body = (string) wp_remote_retrieve_body( $response );
	if ( '' === $body || strlen( $body ) > OPENSTATION_FAVICON_MAX_BYTES ) {
		return null;
	}
	$subtype = openstation_favicon_subtype_from_content_type( $content_type );
	if ( null === $subtype ) {
		return null;
	}
	// Catch HTML / text bodies served with a lying `Content-Type:
	// image/png` header — `getimagesizefromstring` returns false for
	// anything it doesn't recognize as a supported image, including
	// `.ico` files in some PHP builds. SVG is XML, not a recognized
	// image format by getimagesize, so we skip the check for it.
	if ( 'svg+xml' !== $subtype ) {
		$dimensions = @getimagesizefromstring( $body );
		if ( false === $dimensions ) {
			return null;
		}
	}
	return 'data:image/' . $subtype . ';base64,' . base64_encode( $body );
}

/**
 * Map a `Content-Type` header to a known image subtype, or `null`
 * if the type isn't on the allowlist.
 *
 * @internal
 *
 * @param string $content_type Lowercased `Content-Type` value
 *                             (no parameters).
 * @return string|null
 */
function openstation_favicon_subtype_from_content_type( $content_type ) {
	$map = array(
		'image/png'                  => 'png',
		'image/jpeg'                 => 'jpeg',
		'image/jpg'                  => 'jpeg',
		'image/gif'                  => 'gif',
		'image/webp'                 => 'webp',
		'image/x-icon'               => 'x-icon',
		'image/vnd.microsoft.icon'   => 'x-icon',
		'image/ico'                  => 'x-icon',
		'image/svg+xml'              => 'svg+xml',
	);
	return isset( $map[ $content_type ] ) ? $map[ $content_type ] : null;
}
