<?php
/**
 * OpenStation: Media Library grid query cleanup.
 *
 * The Media Library grid stops live-updating after an upload when the
 * window's `openstation_chromeless=1` flag reaches its media query.
 *
 * `wp-admin/upload.php` seeds the grid from `$_GET`: it runs the whole
 * query string through `wp_edit_attachments_query_vars()`, drops a
 * hardcoded `mode` / `post_type` / `post_status` / `posts_per_page`
 * ignore list, and localizes whatever survives as
 * `_wpMediaGridSettings.queryVars`. Unknown keys pass straight
 * through, so our flag lands in the grid's `wp.media.model.Query`
 * args.
 *
 * That is enough to break uploads. `Query`'s constructor only calls
 * `this.observe( wp.Uploader.queue )` when EVERY arg is in a fixed
 * allowlist (`s`, `order`, `orderby`, `posts_per_page`,
 * `post_mime_type`, `post_parent`, `author`). Anything else means
 * the query has filters the client can't evaluate, so watching the
 * upload queue would show false positives. `openstation_chromeless`
 * is not in that list, the observer is never attached, and a finished
 * upload never enters the collection: the file lands on the server,
 * the grid shows nothing, and the new item only appears once the
 * window is reopened and the collection re-fetches.
 *
 * Core exposes no filter on that array, so the fix re-localizes
 * `_wpMediaGridSettings` after upload.php with our key removed. The
 * later assignment wins in JS, and reading back what core actually
 * produced (rather than recomputing it) keeps this from drifting if
 * core changes the shape.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Strips the chromeless flag from the Media Library grid's query vars.
 *
 * Runs late on `admin_enqueue_scripts` for two reasons: `upload.php`
 * localizes at file scope, before `admin-header.php` fires this hook,
 * and `wp_localize_script()` appends rather than replaces, so the last
 * writer is the one the grid sees.
 *
 * Bails silently whenever the data isn't in the shape we expect. A
 * grid that still doesn't refresh is a lesser failure than a grid that
 * doesn't render.
 *
 * @return void
 */
function openstation_strip_chromeless_flag_from_media_grid() {
	$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
	if ( ! $screen || 'upload' !== $screen->id ) {
		return;
	}

	$scripts = wp_scripts();
	$data    = $scripts->get_data( 'media-grid', 'data' );
	if ( ! is_string( $data ) || '' === $data ) {
		return;
	}

	// `WP_Scripts::localize()` writes one `var <name> = <json>;`
	// statement per call, newline-joined. Take the last one: that's
	// the value currently winning at runtime.
	if ( ! preg_match_all( '/^var _wpMediaGridSettings = (.+);$/m', $data, $matches ) ) {
		return;
	}

	// Decoded as objects, not associative arrays. An empty JSON object
	// round-tripped through an array comes back out as `[]`, and the
	// grid reads `queryVars` by key. Decoding to stdClass keeps every
	// nested object an object, however many core grows.
	//
	// `queryVars` is core's key, so the snake_case property sniff has
	// nothing to say about it that we can act on.
	// phpcs:disable WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase
	$settings = json_decode( end( $matches[1] ) );
	if ( ! $settings instanceof stdClass || ! isset( $settings->queryVars ) || ! $settings->queryVars instanceof stdClass ) {
		return;
	}

	if ( ! isset( $settings->queryVars->openstation_chromeless ) ) {
		return;
	}

	unset( $settings->queryVars->openstation_chromeless );
	// phpcs:enable WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase

	wp_localize_script( 'media-grid', '_wpMediaGridSettings', (array) $settings );
}
add_action( 'admin_enqueue_scripts', 'openstation_strip_chromeless_flag_from_media_grid', 999 );
