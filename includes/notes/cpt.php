<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_NOTES_POST_TYPE = 'wpd_note';

function openstation_notes_colors() {
	$colors = array( 'butter', 'blush', 'sky', 'mint', 'lilac', 'peach' );

	$colors = apply_filters( 'openstation_notes_colors', $colors );

	return array_values( array_filter( array_map( 'sanitize_key', (array) $colors ) ) );
}

function openstation_notes_register_cpt() {
	register_post_type(
		OPENSTATION_NOTES_POST_TYPE,
		array(
			'label'               => __( 'Desktop Notes', 'desktop-mode' ),
			'public'              => false,
			'publicly_queryable'  => false,
			'exclude_from_search' => true,
			'show_ui'             => false,
			'show_in_menu'        => false,
			'show_in_rest'        => false,
			'supports'            => array( 'title', 'editor', 'author', 'custom-fields' ),
			'capability_type'     => 'post',
			'map_meta_cap'        => true,
			'delete_with_user'    => true,
			'rewrite'             => false,
			'query_var'           => false,
		)
	);

	register_post_meta(
		OPENSTATION_NOTES_POST_TYPE,
		'_wpd_note_color',
		array(
			'type'              => 'string',
			'single'            => true,
			'default'           => 'butter',
			'sanitize_callback' => 'openstation_notes_sanitize_color',
		)
	);

	register_post_meta(
		OPENSTATION_NOTES_POST_TYPE,
		'_wpd_note_x',
		array(
			'type'              => 'number',
			'single'            => true,
			'default'           => 0.1,
			'sanitize_callback' => 'openstation_notes_sanitize_fraction',
		)
	);

	register_post_meta(
		OPENSTATION_NOTES_POST_TYPE,
		'_wpd_note_y',
		array(
			'type'              => 'number',
			'single'            => true,
			'default'           => 0.1,
			'sanitize_callback' => 'openstation_notes_sanitize_fraction',
		)
	);

	register_post_meta(
		OPENSTATION_NOTES_POST_TYPE,
		'_wpd_note_z',
		array(
			'type'              => 'integer',
			'single'            => true,
			'default'           => 1,
			'sanitize_callback' => 'absint',
		)
	);

	register_post_meta(
		OPENSTATION_NOTES_POST_TYPE,
		'_wpd_note_seed',
		array(
			'type'              => 'integer',
			'single'            => true,
			'default'           => 0,
			'sanitize_callback' => 'absint',
		)
	);
}
add_action( 'init', 'openstation_notes_register_cpt' );

function openstation_notes_sanitize_color( $color ) {
	$color  = is_scalar( $color ) ? sanitize_key( (string) $color ) : '';
	$colors = openstation_notes_colors();
	if ( in_array( $color, $colors, true ) ) {
		return $color;
	}
	return isset( $colors[0] ) ? $colors[0] : 'butter';
}

function openstation_notes_sanitize_fraction( $value ) {
	return (float) min( 1, max( 0, (float) $value ) );
}

function openstation_notes_untrash_status( $new_status, $post_id, $previous_status ) {
	if ( OPENSTATION_NOTES_POST_TYPE !== get_post_type( $post_id ) ) {
		return $new_status;
	}
	if ( in_array( $previous_status, array( 'private', 'publish' ), true ) ) {
		return $previous_status;
	}
	return 'private';
}
add_filter( 'wp_untrash_post_status', 'openstation_notes_untrash_status', 10, 3 );
