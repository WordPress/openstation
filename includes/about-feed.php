<?php
/**
 * OpenStation — About-tab journal feed.
 *
 * Fetches the public OpenStation RSS feed on demand, normalizes it to
 * plain-text card data, and serves it through an authenticated admin-AJAX
 * request. Keeping the request lazy means opening the shell never waits on
 * the remote blog; the network is touched only when someone visits About.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

const OPENSTATION_ABOUT_FEED_URL         = 'https://openstation.blog/feed/';
const OPENSTATION_ABOUT_SITE_URL         = 'https://openstation.blog/';
const OPENSTATION_ABOUT_FEED_CACHE_KEY   = 'desktop_mode_about_feed_v1';
const OPENSTATION_ABOUT_FEED_STALE_KEY   = 'desktop_mode_about_feed_stale_v1';
const OPENSTATION_ABOUT_FEED_FAILURE_KEY = 'desktop_mode_about_feed_failure_v1';

/**
 * Give this one feed a shorter cache than WordPress' default 12 hours.
 *
 * The callback is installed only around our own `fetch_feed()` call and
 * removed immediately afterwards, so dashboard RSS widgets keep their own
 * cache policy.
 *
 * @param int    $seconds Existing cache lifetime.
 * @param string $url     Feed URL.
 * @return int Cache lifetime in seconds.
 */
function openstation_about_feed_cache_lifetime( $seconds, $url ) {
	return OPENSTATION_ABOUT_FEED_URL === $url ? 30 * MINUTE_IN_SECONDS : $seconds;
}

/**
 * Bound the cold-feed request so an unavailable journal cannot pin the tab.
 *
 * @param SimplePie $feed Feed parser instance.
 * @param string    $url  Feed URL.
 */
function openstation_about_feed_options( $feed, $url ) {
	if ( OPENSTATION_ABOUT_FEED_URL === $url && is_callable( array( $feed, 'set_timeout' ) ) ) {
		$feed->set_timeout( 5 );
	}
}

/**
 * Collapse remote feed text to one safe, readable line.
 *
 * @param mixed $value Remote feed value.
 * @return string Plain text.
 */
function openstation_about_feed_text( $value ) {
	$text = html_entity_decode(
		wp_strip_all_tags( (string) $value, true ),
		ENT_QUOTES | ENT_HTML5,
		'UTF-8'
	);
	$text = preg_replace( '/\s+/u', ' ', $text );
	return sanitize_text_field( trim( (string) $text ) );
}

/**
 * Convert a parsed SimplePie feed into the small JSON shape the About tab uses.
 *
 * No remote HTML crosses the boundary: titles, author names and excerpts are
 * flattened to text, URLs pass through WordPress' URL sanitizer, and the list
 * is capped before it reaches the browser.
 *
 * @param SimplePie $feed Parsed feed instance.
 * @return array Normalized feed payload.
 */
function openstation_normalize_about_feed( $feed ) {
	$items      = array();
	$feed_items = $feed->get_items( 0, 5 );

	foreach ( $feed_items as $item ) {
		$title = openstation_about_feed_text( $item->get_title() );
		$url   = esc_url_raw( (string) $item->get_permalink() );
		if ( '' === $title || '' === $url ) {
			continue;
		}

		$author      = $item->get_author();
		$author_name = $author ? openstation_about_feed_text( $author->get_name() ) : '';
		$excerpt     = openstation_about_feed_text( $item->get_description() );

		$items[] = array(
			'title'       => $title,
			'url'         => $url,
			'author'      => $author_name,
			'publishedAt' => sanitize_text_field( (string) $item->get_date( 'c' ) ),
			'excerpt'     => wp_trim_words( $excerpt, 36, '…' ),
		);
	}

	$title       = openstation_about_feed_text( $feed->get_title() );
	$description = openstation_about_feed_text( $feed->get_description() );
	$home_url    = esc_url_raw( (string) $feed->get_link() );

	return array(
		'title'       => '' !== $title ? $title : 'OpenStation',
		'description' => '' !== $description
			? $description
			: 'A public dev diary — building a desktop OS for wp-admin.',
		'homeUrl'     => '' !== $home_url ? $home_url : OPENSTATION_ABOUT_SITE_URL,
		'feedUrl'     => OPENSTATION_ABOUT_FEED_URL,
		'items'       => $items,
		'stale'       => false,
	);
}

/**
 * Return the cached journal payload, fetching RSS only when the cache is cold.
 *
 * A last-known-good copy survives for a week. If the blog has a temporary
 * outage, the About tab can still show useful posts and quietly mark the data
 * stale instead of replacing the whole page with an error.
 *
 * @return array|WP_Error Feed payload or a private fetch error.
 */
function openstation_get_about_feed() {
	$cached = get_transient( OPENSTATION_ABOUT_FEED_CACHE_KEY );
	if ( is_array( $cached ) ) {
		return $cached;
	}

	$stale = get_transient( OPENSTATION_ABOUT_FEED_STALE_KEY );
	if ( false !== get_transient( OPENSTATION_ABOUT_FEED_FAILURE_KEY ) ) {
		if ( is_array( $stale ) ) {
			$stale['stale'] = true;
			return $stale;
		}
		return new WP_Error( 'openstation_about_feed_unavailable' );
	}

	require_once ABSPATH . WPINC . '/feed.php';
	add_filter( 'wp_feed_cache_transient_lifetime', 'openstation_about_feed_cache_lifetime', 10, 2 );
	add_action( 'wp_feed_options', 'openstation_about_feed_options', 10, 2 );
	$feed = fetch_feed( OPENSTATION_ABOUT_FEED_URL );
	remove_filter( 'wp_feed_cache_transient_lifetime', 'openstation_about_feed_cache_lifetime', 10 );
	remove_action( 'wp_feed_options', 'openstation_about_feed_options', 10 );

	if ( is_wp_error( $feed ) ) {
		set_transient( OPENSTATION_ABOUT_FEED_FAILURE_KEY, '1', 5 * MINUTE_IN_SECONDS );
		if ( is_array( $stale ) ) {
			$stale['stale'] = true;
			return $stale;
		}
		return new WP_Error( 'openstation_about_feed_unavailable' );
	}

	$payload = openstation_normalize_about_feed( $feed );
	set_transient( OPENSTATION_ABOUT_FEED_CACHE_KEY, $payload, 30 * MINUTE_IN_SECONDS );
	set_transient( OPENSTATION_ABOUT_FEED_STALE_KEY, $payload, WEEK_IN_SECONDS );
	delete_transient( OPENSTATION_ABOUT_FEED_FAILURE_KEY );
	return $payload;
}

/**
 * Serve the latest OpenStation journal posts to the current shell user.
 */
function openstation_ajax_about_feed() {
	check_ajax_referer( 'openstation_about_feed', 'nonce' );

	if ( ! current_user_can( 'read' ) || ! openstation_is_enabled() ) {
		wp_send_json_error(
			array( 'message' => __( 'You cannot load OpenStation updates.', 'desktop-mode' ) ),
			403
		);
	}

	$feed = openstation_get_about_feed();
	if ( is_wp_error( $feed ) ) {
		wp_send_json_error(
			array( 'message' => __( 'The OpenStation journal is temporarily unavailable.', 'desktop-mode' ) ),
			502
		);
	}

	wp_send_json_success( $feed );
}
add_action( 'wp_ajax_openstation_about_feed', 'openstation_ajax_about_feed' );
