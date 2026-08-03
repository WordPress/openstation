<?php
/**
 * OpenStation — built-in file-opener registrations.
 *
 * Ships one default opener per built-in file type so the user can
 * double-click any tile and have something happen out of the box.
 * Each entry registers PHP-side metadata; the actual handler that
 * builds the URL or opens the window lives in the JS bundle (see
 * `src/desktop-files/built-in-openers.ts`).
 *
 * Hooked on `init` priority 6 — after the file-type registry
 * (priority 5) and before the shell config is built. Same ordering
 * as the wallpapers / icons modules.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Registers the built-in openers (one per file type).
 */
function open_station_register_builtin_file_openers() {
	$openers = array(
		array(
			'id'    => 'wp-post-editor',
			'label' => __( 'Block Editor', 'desktop-mode' ),
			'types' => array( 'post' ),
			'sort'  => 10,
		),
		array(
			'id'    => 'wp-media-editor',
			'label' => __( 'Media editor', 'desktop-mode' ),
			'types' => array( 'attachment' ),
			'sort'  => 10,
		),
		array(
			'id'    => 'wp-user-profile',
			'label' => __( 'User profile', 'desktop-mode' ),
			'types' => array( 'user' ),
			'sort'  => 10,
		),
		array(
			'id'    => 'wp-term-editor',
			'label' => __( 'Term editor', 'desktop-mode' ),
			'types' => array( 'term' ),
			'sort'  => 10,
		),
		array(
			'id'    => 'wp-comment-editor',
			'label' => __( 'Comment editor', 'desktop-mode' ),
			'types' => array( 'comment' ),
			'sort'  => 10,
		),
		array(
			'id'    => 'browser-navigate',
			'label' => __( 'Open in browser', 'desktop-mode' ),
			'types' => array( 'bookmark' ),
			'sort'  => 10,
		),
		array(
			'id'    => 'desktop-mode-link-opener',
			'label' => __( 'Open in browser', 'desktop-mode' ),
			'types' => array( 'link' ),
			'sort'  => 10,
		),
		array(
			'id'    => 'desktop-mode-embed-opener',
			'label' => __( 'Open as window', 'desktop-mode' ),
			'types' => array( 'embed' ),
			'sort'  => 10,
		),
	);

	foreach ( $openers as $args ) {
		open_station_register_file_opener( $args['id'], array(
			'label'      => $args['label'],
			'types'      => $args['types'],
			'is_default' => true,
			'sort'       => $args['sort'],
		) );
	}
}
add_action( 'init', 'open_station_register_builtin_file_openers', 6 );
