<?php
/**
 * OpenStation — Media dimension filtering for REST.
 *
 * Adds two opt-in query parameters to `/wp/v2/media`:
 *
 *   - `open_station_min_width`  — only return images at least this many pixels wide.
 *   - `open_station_min_height` — only return images at least this many pixels tall.
 *
 * The OS Settings wallpaper picker uses these to keep a site with thousands
 * of small product images from burying the handful of desktop-worthy HD
 * shots under an infinite-scroll slog. The client still applies the same
 * filter locally as a belt-and-suspenders safeguard — if the server-side
 * filter ever ships mis-stamped meta, the UI still hides too-small images.
 *
 * Why not `meta_query` on `_wp_attachment_metadata` directly? That key is
 * stored serialized, so SQL can't compare its `width`/`height` members
 * reliably. We stamp two flat numeric meta keys on every new attachment
 * (and opportunistically backfill existing ones) so `WP_Meta_Query` can
 * use a normal NUMERIC `>=` comparison.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Numeric post-meta keys stamped on every image attachment. */
const OPEN_STATION_META_WIDTH  = '_desktop_mode_width';
const OPEN_STATION_META_HEIGHT = '_desktop_mode_height';

/** Option key flipped to `1` once every image has been backfilled. */
const OPEN_STATION_BACKFILL_DONE_OPTION = 'desktop_mode_media_dims_backfilled';

/** How many legacy attachments to backfill per filtered REST request. */
const OPEN_STATION_MEDIA_BACKFILL_BATCH = 50;

/**
 * Stamp numeric dimension meta whenever an attachment's metadata is
 * generated or updated. Hooked on both `wp_generate_attachment_metadata`
 * (new uploads) and `wp_update_attachment_metadata` (regenerated
 * thumbnails, image editor saves) so the stamp stays in sync with
 * whatever Core thinks the canonical dimensions are.
 *
 * @param array $metadata       Attachment metadata.
 * @param int   $attachment_id  Attachment post ID.
 * @return array The metadata, unchanged — we only read from it.
 */
function open_station_stamp_media_dimensions( $metadata, $attachment_id ) {
	if ( ! is_array( $metadata ) ) {
		return $metadata;
	}

	$width  = isset( $metadata['width'] ) ? (int) $metadata['width'] : 0;
	$height = isset( $metadata['height'] ) ? (int) $metadata['height'] : 0;

	// Stamp zero for images we can't measure (SVGs, broken files) so the
	// backfill sweep knows we've already inspected this row and doesn't
	// re-check it on every subsequent filtered request.
	update_post_meta( $attachment_id, OPEN_STATION_META_WIDTH, max( 0, $width ) );
	update_post_meta( $attachment_id, OPEN_STATION_META_HEIGHT, max( 0, $height ) );

	return $metadata;
}
add_filter( 'wp_generate_attachment_metadata', 'open_station_stamp_media_dimensions', 10, 2 );
add_filter( 'wp_update_attachment_metadata', 'open_station_stamp_media_dimensions', 10, 2 );

/**
 * Register the `open_station_min_width` / `open_station_min_height` query parameters on
 * the media collection so Core sanitizes them before they reach our
 * query filter. Without this, the params would still work but would
 * show up as unknown to any REST consumer introspecting the schema.
 *
 * @param array $params Existing collection params.
 * @return array
 */
function open_station_register_media_query_params( $params ) {
	$params['open_station_min_width'] = array(
		'description' => __( 'Only return images at least this many pixels wide.', 'desktop-mode' ),
		'type'        => 'integer',
		'minimum'     => 1,
	);
	$params['open_station_min_height'] = array(
		'description' => __( 'Only return images at least this many pixels tall.', 'desktop-mode' ),
		'type'        => 'integer',
		'minimum'     => 1,
	);
	return $params;
}
add_filter( 'rest_attachment_collection_params', 'open_station_register_media_query_params' );

/**
 * Inject meta_query clauses on the attachment REST query when either
 * dimension filter is present. Triggers a bounded backfill first so
 * legacy attachments (uploaded before this filter existed) start
 * participating without a one-shot CLI command.
 *
 * @param array           $args    WP_Query args built by the REST controller.
 * @param WP_REST_Request $request The REST request.
 * @return array The query args, possibly with extra meta_query entries.
 */
function open_station_filter_media_by_dimensions( $args, $request ) {
	$min_width  = absint( $request->get_param( 'open_station_min_width' ) );
	$min_height = absint( $request->get_param( 'open_station_min_height' ) );

	if ( ! $min_width && ! $min_height ) {
		return $args;
	}

	// Chip away at any remaining unstamped attachments before the query
	// runs, so a site upgrading into this feature gets useful results on
	// roughly the first few picker opens rather than after a CLI run.
	// Logged-in users only — anonymous REST readers can still use the
	// dimension filters, but must never trigger database writes (or the
	// NOT EXISTS sweep query) on a public, unauthenticated endpoint.
	if ( is_user_logged_in() ) {
		open_station_backfill_media_dimensions( OPEN_STATION_MEDIA_BACKFILL_BATCH );
	}

	$meta_query = isset( $args['meta_query'] ) && is_array( $args['meta_query'] )
		? $args['meta_query']
		: array();

	$clauses = array();
	if ( $min_width ) {
		$clauses[] = array(
			'key'     => OPEN_STATION_META_WIDTH,
			'value'   => $min_width,
			'compare' => '>=',
			'type'    => 'NUMERIC',
		);
	}
	if ( $min_height ) {
		$clauses[] = array(
			'key'     => OPEN_STATION_META_HEIGHT,
			'value'   => $min_height,
			'compare' => '>=',
			'type'    => 'NUMERIC',
		);
	}

	if ( count( $clauses ) > 1 ) {
		$clauses['relation'] = 'AND';
	}

	// Compose with any existing meta_query so we don't stomp other
	// filters (Core's own, or anything plugins have layered on).
	if ( empty( $meta_query ) ) {
		$args['meta_query'] = $clauses; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- NUMERIC >= dimension filter on indexed meta keys; canonical WP pattern for picker filtering.
	} else {
		$args['meta_query'] = array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- composed AND clause merging caller meta_query with our dimension filter.
			'relation' => 'AND',
			$meta_query,
			$clauses,
		);
	}

	return $args;
}
add_filter( 'rest_attachment_query', 'open_station_filter_media_by_dimensions', 10, 2 );

/**
 * Stamp dimension meta on up to $batch image attachments that don't
 * have it yet. Returns early once a site has been fully backfilled so
 * filtered REST requests don't keep paying for an empty sweep query.
 *
 * Ordering by `ID DESC` so newest attachments get stamped first — the
 * user is most likely to be looking for something they uploaded
 * recently, so we prioritize the tail they're staring at.
 *
 * @param int $batch Maximum attachments to stamp this pass.
 * @return int Number of attachments stamped (0 when nothing remained).
 */
function open_station_backfill_media_dimensions( $batch ) {
	if ( get_option( OPEN_STATION_BACKFILL_DONE_OPTION ) ) {
		return 0;
	}

	$ids = get_posts(
		array(
			'post_type'              => 'attachment',
			'post_status'            => 'inherit',
			'post_mime_type'         => 'image',
			'posts_per_page'         => (int) $batch,
			'orderby'                => 'ID',
			'order'                  => 'DESC',
			'fields'                 => 'ids',
			'no_found_rows'          => true,
			'update_post_term_cache' => false,
			// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- one-shot backfill targeting the small subset of attachments that lack our dimension stamp; runs at most $batch rows per filtered request and stops once the site option flips.
			'meta_query'             => array(
				array(
					'key'     => OPEN_STATION_META_WIDTH,
					'compare' => 'NOT EXISTS',
				),
			),
		)
	);

	if ( empty( $ids ) ) {
		// Flip the flag so future filtered requests skip this query.
		// If a plugin ever adds new images via a back door that bypasses
		// `wp_generate_attachment_metadata`, those can be picked up by
		// manually deleting this option.
		update_option( OPEN_STATION_BACKFILL_DONE_OPTION, 1, false );
		return 0;
	}

	foreach ( $ids as $id ) {
		// `wp_get_attachment_metadata()` hits the object cache if it was
		// primed by the enclosing query; otherwise it's a single meta
		// lookup per id. We're bounded at $batch per request so the
		// per-request overhead stays predictable.
		$metadata = wp_get_attachment_metadata( $id );

		$width  = is_array( $metadata ) && isset( $metadata['width'] ) ? (int) $metadata['width'] : 0;
		$height = is_array( $metadata ) && isset( $metadata['height'] ) ? (int) $metadata['height'] : 0;

		// Always stamp, even when zero — that's how the sweep query
		// knows to skip this row on the next pass.
		update_post_meta( $id, OPEN_STATION_META_WIDTH, max( 0, $width ) );
		update_post_meta( $id, OPEN_STATION_META_HEIGHT, max( 0, $height ) );
	}

	return count( $ids );
}
