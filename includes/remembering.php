<?php
/**
 * OpenStation — An `X-Remembering` response header for Eric Binnion.
 *
 * The plugin-side version of the nginx line Matt shared
 * (https://ma.tt/2026/10/rip-eric/):
 *
 *     add_header X-Remembering "Eric Binnion <https://friendsofericbinnion.wordpress.com/>" always;
 *
 * Sent on `init`, so it reaches every response WordPress builds: the front
 * end, wp-admin, the REST API, admin-ajax and wp-login. Files the web server
 * serves on its own (images, CSS, JS) never reach PHP and go without it,
 * which only a server-level rule can change.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Send the `X-Remembering` header.
 */
function openstation_send_remembering_header() {
	if ( headers_sent() ) {
		return;
	}
	header( 'X-Remembering: Eric Binnion <https://friendsofericbinnion.wordpress.com/>' );
}
add_action( 'init', 'openstation_send_remembering_header' );
