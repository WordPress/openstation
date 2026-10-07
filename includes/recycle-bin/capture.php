<?php

defined( 'ABSPATH' ) || exit;

function openstation_recycle_bin_capture_post_types() {
	$types = array( 'post', 'page', 'attachment' );

	$custom = get_post_types(
		array(
			'show_ui'  => true,
			'_builtin' => false,
		),
		'names'
	);
	$types  = array_merge( $types, array_values( (array) $custom ) );

	$types = apply_filters( 'openstation_recycle_bin_capture_post_types', $types );

	return array_values( array_unique( array_filter( array_map( 'strval', (array) $types ) ) ) );
}

function openstation_recycle_bin_on_trash_post( $post_id ) {
	$post = get_post( $post_id );
	if ( ! $post ) {
		return;
	}
	if ( ! in_array( $post->post_type, openstation_recycle_bin_capture_post_types(), true ) ) {
		return;
	}
	openstation_recycle_bin_record_capture( $post_id );
}

function openstation_recycle_bin_record_capture( $post_id ) {
	$user_id = get_current_user_id();
	$now_gmt = current_time( 'mysql', true );

	update_post_meta( $post_id, '_desktop_mode_trash_user_id', (int) $user_id );
	update_post_meta( $post_id, '_desktop_mode_trash_time_gmt', $now_gmt );

	do_action( 'openstation_recycle_bin_item_captured', $post_id, $user_id, $now_gmt );
}

add_action( 'wp_trash_post', 'openstation_recycle_bin_on_trash_post', 10, 1 );

function openstation_recycle_bin_on_trash_comment( $comment_id ) {
	$comment_id = (int) $comment_id;
	$user_id    = get_current_user_id();
	$now_gmt    = current_time( 'mysql', true );

	update_comment_meta( $comment_id, '_desktop_mode_trash_user_id', $user_id );
	update_comment_meta( $comment_id, '_desktop_mode_trash_time_gmt', $now_gmt );

	do_action( 'openstation_recycle_bin_comment_captured', $comment_id, $user_id, $now_gmt );
}
add_action( 'trashed_comment', 'openstation_recycle_bin_on_trash_comment', 10, 1 );
