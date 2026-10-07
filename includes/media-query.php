<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_META_WIDTH = '_desktop_mode_width';

const OPENSTATION_META_HEIGHT = '_desktop_mode_height';

const OPENSTATION_BACKFILL_DONE_OPTION = 'desktop_mode_media_dims_backfilled';

const OPENSTATION_MEDIA_BACKFILL_BATCH = 50;

function openstation_stamp_media_dimensions( $metadata, $attachment_id ) {
	if ( ! is_array( $metadata ) ) {
		return $metadata;
	}

	$width  = isset( $metadata['width'] ) ? (int) $metadata['width'] : 0;
	$height = isset( $metadata['height'] ) ? (int) $metadata['height'] : 0;

	update_post_meta( $attachment_id, OPENSTATION_META_WIDTH, max( 0, $width ) );
	update_post_meta( $attachment_id, OPENSTATION_META_HEIGHT, max( 0, $height ) );

	return $metadata;
}
add_filter( 'wp_generate_attachment_metadata', 'openstation_stamp_media_dimensions', 10, 2 );
add_filter( 'wp_update_attachment_metadata', 'openstation_stamp_media_dimensions', 10, 2 );

function openstation_register_media_query_params( $params ) {
	$params['openstation_min_width']  = array(
		'description' => __( 'Only return images at least this many pixels wide.', 'desktop-mode' ),
		'type'        => 'integer',
		'minimum'     => 1,
	);
	$params['openstation_min_height'] = array(
		'description' => __( 'Only return images at least this many pixels tall.', 'desktop-mode' ),
		'type'        => 'integer',
		'minimum'     => 1,
	);
	return $params;
}
add_filter( 'rest_attachment_collection_params', 'openstation_register_media_query_params' );

function openstation_filter_media_by_dimensions( $args, $request ) {
	$min_width  = absint( $request->get_param( 'openstation_min_width' ) );
	$min_height = absint( $request->get_param( 'openstation_min_height' ) );

	if ( ! $min_width && ! $min_height ) {
		return $args;
	}

	if ( is_user_logged_in() ) {
		openstation_backfill_media_dimensions( OPENSTATION_MEDIA_BACKFILL_BATCH );
	}

	$meta_query = isset( $args['meta_query'] ) && is_array( $args['meta_query'] )
		? $args['meta_query']
		: array();

	$clauses = array();
	if ( $min_width ) {
		$clauses[] = array(
			'key'     => OPENSTATION_META_WIDTH,
			'value'   => $min_width,
			'compare' => '>=',
			'type'    => 'NUMERIC',
		);
	}
	if ( $min_height ) {
		$clauses[] = array(
			'key'     => OPENSTATION_META_HEIGHT,
			'value'   => $min_height,
			'compare' => '>=',
			'type'    => 'NUMERIC',
		);
	}

	if ( count( $clauses ) > 1 ) {
		$clauses['relation'] = 'AND';
	}

	if ( empty( $meta_query ) ) {
		$args['meta_query'] = $clauses;
	} else {
		$args['meta_query'] = array(
			'relation' => 'AND',
			$meta_query,
			$clauses,
		);
	}

	return $args;
}
add_filter( 'rest_attachment_query', 'openstation_filter_media_by_dimensions', 10, 2 );

function openstation_backfill_media_dimensions( $batch ) {
	if ( get_option( OPENSTATION_BACKFILL_DONE_OPTION ) ) {
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

			'meta_query'             => array(
				array(
					'key'     => OPENSTATION_META_WIDTH,
					'compare' => 'NOT EXISTS',
				),
			),
		)
	);

	if ( empty( $ids ) ) {

		update_option( OPENSTATION_BACKFILL_DONE_OPTION, 1, false );
		return 0;
	}

	foreach ( $ids as $id ) {

		$metadata = wp_get_attachment_metadata( $id );

		$width  = is_array( $metadata ) && isset( $metadata['width'] ) ? (int) $metadata['width'] : 0;
		$height = is_array( $metadata ) && isset( $metadata['height'] ) ? (int) $metadata['height'] : 0;

		update_post_meta( $id, OPENSTATION_META_WIDTH, max( 0, $width ) );
		update_post_meta( $id, OPENSTATION_META_HEIGHT, max( 0, $height ) );
	}

	return count( $ids );
}
