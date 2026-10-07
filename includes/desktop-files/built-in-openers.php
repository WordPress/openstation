<?php

defined( 'ABSPATH' ) || exit;

function openstation_register_builtin_file_openers() {
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
		openstation_register_file_opener(
			$args['id'],
			array(
				'label'      => $args['label'],
				'types'      => $args['types'],
				'is_default' => true,
				'sort'       => $args['sort'],
			)
		);
	}
}
add_action( 'init', 'openstation_register_builtin_file_openers', 6 );
