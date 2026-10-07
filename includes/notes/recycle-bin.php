<?php

defined( 'ABSPATH' ) || exit;

function openstation_notes_recycle_bin_capture_types( $types ) {
	$types   = (array) $types;
	$types[] = OPENSTATION_NOTES_POST_TYPE;
	return $types;
}
add_filter( 'openstation_recycle_bin_capture_post_types', 'openstation_notes_recycle_bin_capture_types' );

function openstation_notes_recycle_bin_owns( $post ) {
	return get_current_user_id() === (int) $post->post_author;
}

function openstation_notes_recycle_bin_gate( $can, $post ) {
	if ( OPENSTATION_NOTES_POST_TYPE !== $post->post_type ) {
		return $can;
	}
	return openstation_notes_recycle_bin_owns( $post );
}
add_filter( 'openstation_recycle_bin_user_can_view', 'openstation_notes_recycle_bin_gate', 10, 2 );
add_filter( 'openstation_recycle_bin_user_can_restore', 'openstation_notes_recycle_bin_gate', 10, 2 );
add_filter( 'openstation_recycle_bin_user_can_purge', 'openstation_notes_recycle_bin_gate', 10, 2 );

function openstation_notes_recycle_bin_item( $item, $post ) {
	if ( OPENSTATION_NOTES_POST_TYPE !== $post->post_type ) {
		return $item;
	}
	$item['type_label'] = __( 'Note', 'desktop-mode' );
	$item['icon']       = 'dashicons-sticky';
	$item['subtitle']   = openstation_recycle_bin_excerpt( (string) $post->post_content );

	$item['edit_link'] = '';

	if ( '' === (string) $item['deleted_by'] ) {
		$owner = get_userdata( (int) $post->post_author );
		if ( $owner instanceof WP_User ) {
			$item['deleted_by']    = $owner->display_name;
			$item['deleted_by_id'] = (int) $post->post_author;
		}
	}

	return $item;
}
add_filter( 'openstation_recycle_bin_item', 'openstation_notes_recycle_bin_item', 10, 2 );

function openstation_notes_recycle_bin_trashed_count( $author_id = null ) {
	$args = array(
		'post_type'      => OPENSTATION_NOTES_POST_TYPE,
		'post_status'    => 'trash',
		'posts_per_page' => 1,
		'fields'         => 'ids',
		'no_found_rows'  => false,
	);
	if ( null !== $author_id ) {
		$args['author'] = (int) $author_id;
	}
	$query = new WP_Query( $args );
	return (int) $query->found_posts;
}

function openstation_notes_recycle_bin_count( $total ) {
	$total = (int) $total;
	$own   = openstation_notes_recycle_bin_trashed_count( get_current_user_id() );

	if ( current_user_can( 'edit_others_posts' ) ) {

		$total = $total - openstation_notes_recycle_bin_trashed_count() + $own;
	} elseif ( ! current_user_can( 'edit_posts' ) ) {

		$total = $total + $own;
	}

	return max( 0, $total );
}
add_filter( 'openstation_recycle_bin_count', 'openstation_notes_recycle_bin_count' );
