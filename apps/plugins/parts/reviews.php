<?php
/**
 * Plugins app — the wp.org reviews scrape.
 *
 * Part of the `desktop-mode-plugins` app: required by `plugins.os.php`,
 * plain `.php` on purpose — only `*.os.php` files are app entries to
 * the framework loader. `plugins_api()` ships no review text, so the
 * Reviews tab reads the top of a plugin's wp.org reviews page over
 * admin-ajax (`wp_ajax_openstation_plugins_reviews`) and parses it
 * with DOMDocument — best effort: any failure answers `parsed: false`
 * and the client shows the histogram with a link instead.
 *
 * @package OpenStation
 */

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/**
 * `wp_ajax_openstation_plugins_reviews` — best-effort scrape of the
 * top reviews from a plugin's wp.org page.
 *
 * Body params:
 *   - slug  string, required
 *
 * Returns either `{ items: [...], parsed: true }` or
 * `{ items: [], parsed: false, reason: '<code>' }`. Success is cached
 * 1h, failure 15m so wp.org can recover quickly.
 */
function openstation_plugins_window_ajax_reviews() {
	$guard = openstation_plugins_window_ajax_guard( 'install_plugins' );
	if ( is_wp_error( $guard ) ) {
		openstation_plugins_window_ajax_error( $guard );
		return;
	}

	$slug = openstation_plugins_window_ajax_slug();
	if ( '' === $slug ) {
		return;
	}

	$cache_key = 'dm_pwreviews_' . md5( $slug );
	$cached    = get_transient( $cache_key );
	if ( false !== $cached && is_array( $cached ) ) {
		wp_send_json_success( $cached );
		return;
	}

	/**
	 * Filter to swap out the default DOMDocument-based review parser.
	 *
	 * Return an array of items to short-circuit; return `null` to
	 * fall through to the default parser. Items must each be an
	 * associative array with `author`, `stars` (int 1–5), `excerpt`,
	 * `date`, and (optional) `url` keys.
	 *
	 * @param array|null $items Override list, or null for default behaviour.
	 * @param string     $slug  Plugin slug.
	 */
	$override = apply_filters( 'openstation_plugins_window_review_parser', null, $slug );
	if ( is_array( $override ) ) {
		openstation_plugins_window_send_reviews( $cache_key, array_values( $override ) );
		return;
	}

	$response = wp_remote_get(
		'https://wordpress.org/plugins/' . $slug . '/#reviews',
		array(
			'timeout'   => 5,
			'sslverify' => true,
			'headers'   => array( 'Accept-Language' => get_locale() ),
		)
	);
	if ( is_wp_error( $response ) ) {
		openstation_plugins_window_send_reviews( $cache_key, null, 'fetch_failed' );
		return;
	}
	$status = (int) wp_remote_retrieve_response_code( $response );
	if ( $status < 200 || $status >= 300 ) {
		openstation_plugins_window_send_reviews( $cache_key, null, 'http_' . $status );
		return;
	}
	$body = (string) wp_remote_retrieve_body( $response );
	if ( '' === $body ) {
		openstation_plugins_window_send_reviews( $cache_key, null, 'empty_body' );
		return;
	}

	$items = openstation_plugins_window_parse_reviews_html( $body );
	if ( null === $items ) {
		openstation_plugins_window_send_reviews( $cache_key, null, 'parse_failed' );
		return;
	}
	openstation_plugins_window_send_reviews( $cache_key, $items );
}
add_action( 'wp_ajax_openstation_plugins_reviews', 'openstation_plugins_window_ajax_reviews' );

/**
 * Cache and send the reviews payload — the parsed items, or the
 * failure with its reason.
 *
 * @param string     $cache_key Transient key.
 * @param array|null $items     Parsed items, or null on failure.
 * @param string     $reason    Failure code when `$items` is null.
 * @return void
 */
function openstation_plugins_window_send_reviews( $cache_key, $items, $reason = '' ) {
	if ( null === $items ) {
		$payload = array(
			'items'  => array(),
			'parsed' => false,
			'reason' => $reason,
		);
		set_transient( $cache_key, $payload, 15 * MINUTE_IN_SECONDS );
	} else {
		$payload = array(
			'items'  => $items,
			'parsed' => true,
		);
		set_transient( $cache_key, $payload, HOUR_IN_SECONDS );
	}
	wp_send_json_success( $payload );
}

/**
 * Default DOMDocument-based parser for the wp.org plugin reviews
 * page. Returns an array of `{ author, stars, excerpt, date, url }`
 * on success, or `null` when parsing fails.
 *
 * The wp.org review HTML may change without notice — every navigation
 * is inside one `try`, and any failure bails to `null` so the client
 * falls back to the histogram-only view.
 *
 * @param string $html The page.
 * @return array<int,array<string,mixed>>|null
 */
function openstation_plugins_window_parse_reviews_html( $html ) {
	if ( ! class_exists( 'DOMDocument' ) ) {
		return null;
	}

	try {
		$prev = libxml_use_internal_errors( true );
		$doc  = new DOMDocument();
		// Force UTF-8 — wp.org output is UTF-8 but loadHTML defaults
		// to ISO-8859-1.
		$doc->loadHTML( '<?xml encoding="UTF-8">' . $html, LIBXML_NOERROR | LIBXML_NOWARNING );
		libxml_clear_errors();
		libxml_use_internal_errors( $prev );

		$xpath = new DOMXPath( $doc );

		// wp.org wraps each review in `<div class="review">` with a
		// reviewer block, a body paragraph, star-rating spans and a
		// permalink. The first 5.
		$reviews = $xpath->query( '//*[contains(concat(" ", normalize-space(@class), " "), " review ")]' );
		if ( ! $reviews instanceof DOMNodeList || 0 === $reviews->length ) {
			return null;
		}

		$out = array();
		foreach ( $reviews as $review ) {
			if ( count( $out ) >= 5 ) {
				break;
			}
			if ( ! $review instanceof DOMNode ) {
				continue;
			}
			$item = openstation_plugins_window_parse_review( $xpath, $review );
			if ( null !== $item ) {
				$out[] = $item;
			}
		}
		return $out;
	} catch ( Throwable $e ) {
		// Malformed HTML, libxml gone — the histogram-only fallback.
		return null;
	}
}

/**
 * One review node → `{ author, stars, excerpt, date, url }`, or null
 * when it carries neither an author nor a body.
 *
 * @param DOMXPath $xpath  The document's XPath.
 * @param DOMNode  $review The `.review` node.
 * @return array<string,mixed>|null
 */
function openstation_plugins_window_parse_review( DOMXPath $xpath, DOMNode $review ) {
	$class = static function ( $name ) {
		return 'contains(concat(" ", normalize-space(@class), " "), " ' . $name . ' ")';
	};
	$text  = static function ( $nodes ) {
		return $nodes instanceof DOMNodeList && $nodes->length > 0 ? trim( (string) $nodes->item( 0 )->textContent ) : '';
	};

	$author  = $text( $xpath->query( './/*[' . $class( 'reviewer-name' ) . ']', $review ) );
	$excerpt = $text( $xpath->query( './/p', $review ) );
	if ( '' !== $excerpt && function_exists( 'mb_strimwidth' ) ) {
		$excerpt = mb_strimwidth( $excerpt, 0, 320, '…' );
	}
	$date = $text( $xpath->query( './/*[' . $class( 'review-date' ) . ']', $review ) );

	$stars        = 0;
	$rating_nodes = $xpath->query( './/*[' . $class( 'wporg-ratings' ) . ' or ' . $class( 'star-rating' ) . ']', $review );
	if ( $rating_nodes instanceof DOMNodeList && $rating_nodes->length > 0 ) {
		$rating_text = (string) $rating_nodes->item( 0 )->textContent;
		if ( preg_match( '/(\d+(?:\.\d+)?)\s*\/\s*5/', $rating_text, $m ) ) {
			$stars = (int) round( (float) $m[1] );
		} elseif ( preg_match( '/(\d+)\s*star/i', $rating_text, $m ) ) {
			$stars = (int) $m[1];
		} else {
			// Fall back to counting filled-star elements.
			$filled = $xpath->query( './/*[' . $class( 'star' ) . ' and ' . $class( 'filled' ) . ']', $rating_nodes->item( 0 ) );
			if ( $filled instanceof DOMNodeList ) {
				$stars = (int) $filled->length;
			}
		}
	}

	$url        = '';
	$link_nodes = $xpath->query( './/a[contains(@href, "/topic/")]', $review );
	if ( $link_nodes instanceof DOMNodeList && $link_nodes->length > 0 ) {
		$href = $link_nodes->item( 0 );
		if ( $href instanceof DOMElement ) {
			$url = (string) $href->getAttribute( 'href' );
		}
	}

	if ( '' === $author && '' === $excerpt ) {
		return null;
	}
	return array(
		'author'  => $author,
		'stars'   => max( 0, min( 5, $stars ) ),
		'excerpt' => $excerpt,
		'date'    => $date,
		'url'     => $url,
	);
}
