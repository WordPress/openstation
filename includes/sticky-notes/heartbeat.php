<?php
/**
 * OpenStation — Sticky notes Heartbeat sync.
 *
 * Gutenberg's Guidelines experiment owns the `wp_guideline` CPT and
 * `wp_guideline_type` taxonomy. OpenStation only mirrors sticky
 * artifacts into the shell: the client subscribes with the sticky term
 * id, known guideline ids, and a high-water modified timestamp; the
 * server responds with changed sticky guidelines plus removals.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

const OPEN_STATION_STICKY_NOTES_POST_TYPE = 'wp_guideline';
const OPEN_STATION_STICKY_NOTES_TAXONOMY  = 'wp_guideline_type';

/**
 * Whether the sticky-notes surface is available on this site.
 *
 * Sticky notes are backed by Gutenberg's Guidelines experiment, which
 * registers the `wp_guideline` CPT and `wp_guideline_type` taxonomy
 * (exposed at `wp/v2/guidelines` + `wp/v2/wp_guideline_type`) only when
 * the experiment is enabled — Gutenberg plugin 22.7+, opt-in under
 * Gutenberg → Experiments. Without it those REST routes return 404, so
 * the shell skips booting the sticky-notes layer entirely and the
 * Heartbeat handler short-circuits.
 *
 * @return bool True when both the guideline CPT and taxonomy are registered.
 */
function open_station_sticky_notes_is_available() {
	$available = post_type_exists( OPEN_STATION_STICKY_NOTES_POST_TYPE )
		&& taxonomy_exists( OPEN_STATION_STICKY_NOTES_TAXONOMY );

	/**
	 * Filters whether the sticky-notes surface is available.
	 *
	 * Lets a site force sticky notes off (return `false`) or wire the
	 * layer up to a different guidelines-compatible backend.
	 *
	 * @param bool $available Whether the guideline CPT + taxonomy are registered.
	 */
	return (bool) apply_filters( 'open_station_sticky_notes_available', $available );
}

/**
 * Add sticky-note deltas to the Heartbeat response.
 *
 * @param array $response Pre-filtered response.
 * @param array $data     Client-sent payload.
 * @return array
 */
function open_station_sticky_notes_heartbeat_received( $response, $data ) {
	if ( ! is_array( $response ) ) {
		$response = array();
	}
	if ( empty( $data['open_station_sticky_notes_subscribe'] ) || ! is_array( $data['open_station_sticky_notes_subscribe'] ) ) {
		return $response;
	}
	if ( ! function_exists( 'open_station_is_enabled' ) || ! open_station_is_enabled() ) {
		return $response;
	}
	if ( ! open_station_sticky_notes_is_available() ) {
		return $response;
	}

	$sub            = $data['open_station_sticky_notes_subscribe'];
	$sticky_term_id = isset( $sub['stickyTermId'] ) ? absint( $sub['stickyTermId'] ) : 0;
	if ( $sticky_term_id <= 0 || ! term_exists( $sticky_term_id, OPEN_STATION_STICKY_NOTES_TAXONOMY ) ) {
		return $response;
	}

	$known_ids = isset( $sub['knownIds'] ) && is_array( $sub['knownIds'] )
		? array_values( array_unique( array_filter( array_map( 'absint', $sub['knownIds'] ) ) ) )
		: array();
	$known_ids = array_slice( $known_ids, 0, 500 );

	$version = isset( $sub['version'] ) ? max( 0, (int) $sub['version'] ) : 0;

	$response['open_station_sticky_notes'] = open_station_sticky_notes_compute_heartbeat_delta(
		$sticky_term_id,
		$known_ids,
		$version,
		100
	);

	return $response;
}
add_filter( 'heartbeat_received', 'open_station_sticky_notes_heartbeat_received', 5, 2 );

/**
 * Compute sticky-note Heartbeat deltas.
 *
 * @param int   $sticky_term_id Sticky term id.
 * @param int[] $known_ids      Guideline ids currently known by the client.
 * @param int   $version        Last-seen modified timestamp in milliseconds.
 * @param int   $cap            Maximum notes to send in one tick.
 * @return array
 */
function open_station_sticky_notes_compute_heartbeat_delta( $sticky_term_id, $known_ids, $version, $cap ) {
	$cap       = max( 1, (int) $cap );
	$query_ids = open_station_sticky_notes_query_changed_ids( $sticky_term_id, $version, $cap + 1 );
	$truncated = count( $query_ids ) > $cap;
	if ( $truncated ) {
		$query_ids = array_slice( $query_ids, 0, $cap );
	}

	$notes = array();
	foreach ( $query_ids as $post_id ) {
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			continue;
		}
		$post = get_post( $post_id );
		if ( $post instanceof WP_Post ) {
			$notes[] = open_station_sticky_notes_shape_guideline( $post );
		}
	}

	$alive_ids = open_station_sticky_notes_alive_known_ids( $sticky_term_id, $known_ids );
	$removed   = array_values( array_diff( array_map( 'intval', $known_ids ), $alive_ids ) );

	return array(
		'notes'        => $notes,
		'removed'      => $removed,
		'serverTimeMs' => (int) floor( microtime( true ) * 1000 ),
		'truncated'    => $truncated,
	);
}

/**
 * Query sticky guideline ids modified since the client's high-water mark.
 *
 * @param int $sticky_term_id Sticky term id.
 * @param int $version        Last-seen modified timestamp in milliseconds.
 * @param int $limit          Max ids to return.
 * @return int[]
 */
function open_station_sticky_notes_query_changed_ids( $sticky_term_id, $version, $limit ) {
	$args = array(
		'post_type'      => OPEN_STATION_STICKY_NOTES_POST_TYPE,
		'post_status'    => 'private',
		'posts_per_page' => max( 1, (int) $limit ),
		'fields'         => 'ids',
		'orderby'        => 'modified',
		'order'          => 'ASC',
		'no_found_rows'  => true,
		'tax_query'      => array(
			array(
				'taxonomy' => OPEN_STATION_STICKY_NOTES_TAXONOMY,
				'field'    => 'term_id',
				'terms'    => array( (int) $sticky_term_id ),
			),
		),
	);
	if ( $version > 0 ) {
		$args['date_query'] = array(
			array(
				'column'    => 'post_modified_gmt',
				'after'     => gmdate( 'Y-m-d H:i:s', (int) floor( $version / 1000 ) ),
				'inclusive' => true,
			),
		);
	}

	$query = new WP_Query( $args );
	$ids   = array_map( 'intval', (array) $query->posts );
	wp_reset_postdata();

	return $ids;
}

/**
 * Return the subset of known ids that still point at visible sticky notes.
 *
 * @param int   $sticky_term_id Sticky term id.
 * @param int[] $known_ids      Client-known guideline ids.
 * @return int[]
 */
function open_station_sticky_notes_alive_known_ids( $sticky_term_id, $known_ids ) {
	$known_ids = array_values( array_unique( array_filter( array_map( 'absint', (array) $known_ids ) ) ) );
	if ( empty( $known_ids ) ) {
		return array();
	}

	$query = new WP_Query(
		array(
			'post_type'      => OPEN_STATION_STICKY_NOTES_POST_TYPE,
			'post_status'    => 'private',
			'post__in'       => $known_ids,
			'posts_per_page' => count( $known_ids ),
			'fields'         => 'ids',
			'no_found_rows'  => true,
			'tax_query'      => array(
				array(
					'taxonomy' => OPEN_STATION_STICKY_NOTES_TAXONOMY,
					'field'    => 'term_id',
					'terms'    => array( (int) $sticky_term_id ),
				),
			),
		)
	);
	$ids = array();
	foreach ( (array) $query->posts as $post_id ) {
		$post_id = (int) $post_id;
		if ( current_user_can( 'edit_post', $post_id ) ) {
			$ids[] = $post_id;
		}
	}
	wp_reset_postdata();

	return $ids;
}

/**
 * Shape a guideline like the Gutenberg REST endpoint's edit context.
 *
 * @param WP_Post $post Guideline post.
 * @return array
 */
function open_station_sticky_notes_shape_guideline( $post ) {
	$term_ids = wp_get_object_terms(
		$post->ID,
		OPEN_STATION_STICKY_NOTES_TAXONOMY,
		array( 'fields' => 'ids' )
	);
	if ( is_wp_error( $term_ids ) ) {
		$term_ids = array();
	}

	return array(
		'id'                       => (int) $post->ID,
		'slug'                     => (string) $post->post_name,
		'status'                   => (string) get_post_status( $post ),
		'title'                    => array(
			'raw' => (string) get_post_field( 'post_title', $post, 'raw' ),
		),
		'content'                  => array(
			'raw' => (string) get_post_field( 'post_content', $post, 'raw' ),
		),
		'excerpt'                  => array(
			'raw' => (string) get_post_field( 'post_excerpt', $post, 'raw' ),
		),
		'modified'                 => mysql_to_rfc3339( $post->post_modified ),
		'open_station_modified_ms' => open_station_sticky_notes_modified_ms( $post ),
		'link'                     => (string) get_permalink( $post ),
		'wp_guideline_type'        => array_values( array_map( 'intval', (array) $term_ids ) ),
	);
}

/**
 * Modified timestamp in milliseconds, derived from GMT post time.
 *
 * @param WP_Post $post Post.
 * @return int
 */
function open_station_sticky_notes_modified_ms( $post ) {
	return (int) get_post_modified_time( 'U', true, $post ) * 1000;
}
