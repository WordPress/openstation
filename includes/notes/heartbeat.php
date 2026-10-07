<?php

defined( 'ABSPATH' ) || exit;

function openstation_notes_heartbeat_received( $response, $data ) {
	if ( ! is_array( $response ) ) {
		$response = array();
	}
	if ( empty( $data['openstation_notes_subscribe'] ) || ! is_array( $data['openstation_notes_subscribe'] ) ) {
		return $response;
	}
	if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
		return $response;
	}

	$sub       = $data['openstation_notes_subscribe'];
	$known_ids = isset( $sub['knownIds'] ) && is_array( $sub['knownIds'] )
		? array_values( array_unique( array_filter( array_map( 'absint', $sub['knownIds'] ) ) ) )
		: array();
	$known_ids = array_slice( $known_ids, 0, 500 );
	$since_ms  = isset( $sub['sinceMs'] ) ? max( 0, (int) $sub['sinceMs'] ) : 0;

	$response['openstation_notes'] = openstation_notes_compute_heartbeat_delta( $known_ids, $since_ms, 100 );

	return $response;
}
add_filter( 'heartbeat_received', 'openstation_notes_heartbeat_received', 5, 2 );

function openstation_notes_compute_heartbeat_delta( $known_ids, $since_ms, $cap ) {
	$cap       = max( 1, (int) $cap );
	$query_ids = openstation_notes_query_changed_ids( $since_ms, $cap + 1 );
	$truncated = count( $query_ids ) > $cap;
	if ( $truncated ) {
		$query_ids = array_slice( $query_ids, 0, $cap );
	}

	$notes = array();
	foreach ( $query_ids as $post_id ) {
		$post = get_post( $post_id );
		if ( $post instanceof WP_Post ) {
			$notes[] = openstation_notes_prepare( $post );
		}
	}

	$alive_ids = openstation_notes_alive_known_ids( $known_ids );
	$removed   = array_values( array_diff( array_map( 'intval', $known_ids ), $alive_ids ) );

	return array(
		'notes'        => $notes,
		'removed'      => $removed,
		'serverTimeMs' => (int) floor( microtime( true ) * 1000 ),
		'truncated'    => $truncated,
	);
}

function openstation_notes_query_visible_ids( $extra ) {
	$user_id = get_current_user_id();
	$base    = array(
		'post_type'     => OPENSTATION_NOTES_POST_TYPE,
		'fields'        => 'ids',
		'no_found_rows' => true,
	);

	$own = new WP_Query(
		array_merge(
			$base,
			$extra,
			array(
				'post_status' => array( 'private', 'publish' ),
				'author'      => $user_id,
			)
		)
	);

	$public = new WP_Query(
		array_merge(
			$base,
			$extra,
			array(
				'post_status'    => 'publish',
				'author__not_in' => array( $user_id ),
			)
		)
	);

	$ids = array_map( 'intval', array_merge( (array) $own->posts, (array) $public->posts ) );
	wp_reset_postdata();

	return array_values( array_unique( $ids ) );
}

function openstation_notes_query_changed_ids( $since_ms, $limit ) {
	$extra = array(
		'posts_per_page' => max( 1, (int) $limit ),
		'orderby'        => 'modified',
		'order'          => 'ASC',
	);
	if ( $since_ms > 0 ) {
		$extra['date_query'] = array(
			array(
				'column'    => 'post_modified_gmt',
				'after'     => gmdate( 'Y-m-d H:i:s', (int) floor( $since_ms / 1000 ) ),
				'inclusive' => true,
			),
		);
	}
	return openstation_notes_query_visible_ids( $extra );
}

function openstation_notes_alive_known_ids( $known_ids ) {
	$known_ids = array_values( array_unique( array_filter( array_map( 'absint', (array) $known_ids ) ) ) );
	if ( empty( $known_ids ) ) {
		return array();
	}
	return openstation_notes_query_visible_ids(
		array(
			'post__in'       => $known_ids,
			'posts_per_page' => count( $known_ids ),
		)
	);
}
