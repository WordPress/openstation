<?php
/**
 * OpenStation — AI Copilot: media library abilities.
 *
 * `search_media` lists where an item is used, from WP Explorer's "Used in"
 * route. `find_unused_media` lists the items nothing on the site points at.
 * It reads the site once instead of running that route per item, and counts
 * anything that might be a reference as one: the costly mistake is an image
 * deleted while a page still shows it.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Registers the media abilities.
 *
 * @return void
 */
function openstation_ai_register_media_abilities() {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	$meta   = array(
		'annotations'  => array(
			'readonly'   => true,
			'idempotent' => true,
		),
		'show_in_rest' => true,
	);
	$offset = array(
		'type'        => 'integer',
		'description' => 'Zero-based starting position. Use 0 for the first batch, 10 for the second, and so on.',
	);

	wp_register_ability(
		'desktop-mode/search-media',
		array(
			'label'               => __( 'Search media', 'desktop-mode' ),
			'description'         => 'Searches the media library by title or file name and returns each item with where it is used: `used_in_count`, and up to 5 `used_in` rows with the post title and `usedAs` (featured image or content). Use it for "where is this image used?" or "have I used this photo a lot?". Pass one distinctive word as `query`; an empty one lists the newest items. It only sees featured images and post content of posts the user can read, so never call an item unused from it: use find_unused_media. If has_more is true, call again with offset + 10.',
			'category'            => OPENSTATION_AI_ABILITY_CATEGORY,
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'query', 'offset' ),
				'properties'           => array(
					'query'  => array( 'type' => 'string' ),
					'offset' => $offset,
				),
			),
			'output_schema'       => openstation_ai_ability_output_schema( array( 'items' => array( 'type' => 'array' ) ) ),
			'execute_callback'    => 'openstation_ai_search_media',
			'permission_callback' => static function () {
				return current_user_can( 'upload_files' );
			},
			'meta'                => $meta,
		)
	);

	wp_register_ability(
		'desktop-mode/find-unused-media',
		array(
			'label'               => __( 'Find unused media', 'desktop-mode' ),
			'description'         => 'Lists the media library items nothing on the site points at, newest first, for "which images aren\'t used?" or "what can I delete?". It checks featured images, the content of every post, page, template and pattern in any status (drafts and trash too), widgets, the site logo and icon, the header and background images, and WooCommerce galleries. It cannot see custom fields, page-builder data kept outside post content, or files a theme or plugin loads from its own code, so a listed item is "not found anywhere I checked": say so, and leave deleting to the user. `total` is how many are unused out of `library_total`. If has_more is true, call again with offset + 10.',
			'category'            => OPENSTATION_AI_ABILITY_CATEGORY,
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'offset' ),
				'properties'           => array(
					'offset' => $offset,
					'type'   => array(
						'type'        => 'string',
						'enum'        => array( 'image', 'video', 'audio', 'any' ),
						'description' => 'Which items to check. Defaults to image.',
					),
				),
			),
			'output_schema'       => openstation_ai_ability_output_schema( array( 'items' => array( 'type' => 'array' ) ) ),
			'execute_callback'    => 'openstation_ai_find_unused_media',
			// "Unused" counts posts the caller may not be able to read, so an image
			// used only in someone else's draft is never listed. That tells the caller
			// something about those posts, so only Editors and Administrators may ask.
			'permission_callback' => static function () {
				return current_user_can( 'delete_others_posts' );
			},
			'meta'                => $meta,
		)
	);
}
add_action( 'wp_abilities_api_init', 'openstation_ai_register_media_abilities' );

/**
 * The fields both abilities return for a media item, or null when the caller
 * cannot read the post it is attached to.
 *
 * @param WP_Post $attachment Attachment.
 * @return array|null
 */
function openstation_ai_media_item( WP_Post $attachment ) {
	$parent = $attachment->post_parent ? get_post( $attachment->post_parent ) : null;
	if ( $parent && ! openstation_ai_can_read_post( $parent ) ) {
		return null;
	}
	return array(
		'id'       => $attachment->ID,
		'title'    => $attachment->post_title,
		'filename' => wp_basename( (string) get_attached_file( $attachment->ID ) ),
		'mime'     => $attachment->post_mime_type,
		'date'     => substr( $attachment->post_date, 0, 10 ),
		'edit_url' => get_edit_post_link( $attachment->ID, 'raw' ),
	);
}

/**
 * `desktop-mode/search-media`. Items the caller cannot read are dropped after
 * the query, so `total` counts them, as in the content searches.
 *
 * @param array $input Validated input.
 * @return array
 */
function openstation_ai_search_media( $input ) {
	$offset = max( 0, (int) $input['offset'] );
	add_filter( 'wp_allow_query_attachment_by_filename', '__return_true' );
	$query = new WP_Query(
		array(
			'post_type'      => 'attachment',
			'post_status'    => 'inherit',
			's'              => sanitize_text_field( $input['query'] ),
			'posts_per_page' => OPENSTATION_AI_SEARCH_BATCH_SIZE,
			'offset'         => $offset,
		)
	);

	$items = array();
	foreach ( $query->posts as $attachment ) {
		$item = openstation_ai_media_item( $attachment );
		if ( $item ) {
			$used_in = rest_do_request( '/desktop-mode/v1/media-usage/' . $attachment->ID )->get_data()['usedIn'] ?? array();
			$items[] = $item + array(
				'used_in_count' => count( $used_in ),
				'used_in'       => array_slice( $used_in, 0, 5 ),
			);
		}
	}

	return array(
		'items'    => $items,
		'total'    => $query->found_posts,
		'has_more' => $offset + OPENSTATION_AI_SEARCH_BATCH_SIZE < $query->found_posts,
	);
}

/**
 * `desktop-mode/find-unused-media`.
 *
 * @param array $input Validated input.
 * @return array
 */
function openstation_ai_find_unused_media( $input ) {
	global $wpdb;

	$offset  = max( 0, (int) $input['offset'] );
	$type    = $input['type'] ?? 'image';
	$library = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT p.*, m.meta_value AS file FROM {$wpdb->posts} p
			 LEFT JOIN {$wpdb->postmeta} m ON m.post_id = p.ID AND m.meta_key = '_wp_attached_file'
			 WHERE p.post_type = 'attachment' AND p.post_status = 'inherit' AND p.post_mime_type LIKE %s
			 ORDER BY p.post_date DESC",
			'any' === $type ? '%' : $wpdb->esc_like( $type ) . '/%'
		)
	);

	$refs   = openstation_ai_media_references();
	$unused = array();
	foreach ( $library as $row ) {
		if ( ! isset( $refs[ (int) $row->ID ] ) && ! isset( $refs[ openstation_ai_media_file_key( (string) $row->file ) ] ) ) {
			$unused[] = openstation_ai_media_item( get_post( $row ) );
		}
	}
	$unused = array_values( array_filter( $unused ) );

	return array(
		'items'         => array_slice( $unused, $offset, OPENSTATION_AI_SEARCH_BATCH_SIZE ),
		'total'         => count( $unused ),
		'library_total' => count( $library ),
		'has_more'      => $offset + OPENSTATION_AI_SEARCH_BATCH_SIZE < count( $unused ),
	);
}

/**
 * Every media item the site points at, keyed by attachment id and by file key.
 * Post content is read in every status but auto-draft: a draft is about to use
 * an image, and a trashed post can come back.
 *
 * @return array<int|string,true>
 */
function openstation_ai_media_references() {
	global $wpdb;

	$refs = array_fill_keys( array( (int) get_option( 'site_icon' ), (int) get_theme_mod( 'custom_logo' ) ), true );
	foreach ( $wpdb->get_col( "SELECT meta_value FROM {$wpdb->postmeta} WHERE meta_key IN ( '_thumbnail_id', '_product_image_gallery' )" ) as $ids ) {
		$refs += array_fill_keys( array_map( 'intval', explode( ',', $ids ) ), true );
	}

	$texts   = $wpdb->get_col( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name LIKE %s", 'widget\_%' ) );
	$texts[] = get_theme_mod( 'header_image' ) . ' ' . get_theme_mod( 'background_image' );
	foreach ( $texts as $text ) {
		openstation_ai_media_collect_references( $text, $refs );
	}

	$last = 0;
	do {
		$posts = $wpdb->get_results( $wpdb->prepare( "SELECT ID, post_content FROM {$wpdb->posts} WHERE ID > %d AND post_type NOT IN ( 'attachment', 'revision' ) AND post_status <> 'auto-draft' ORDER BY ID LIMIT 500", $last ) );
		foreach ( $posts as $post ) {
			$last = (int) $post->ID;
			openstation_ai_media_collect_references( $post->post_content, $refs );
		}
		$fetched = count( $posts );
	} while ( 500 === $fetched );

	return $refs;
}

/**
 * Adds the media references in stored markup (post content, block attributes,
 * a serialized widget) to `$refs`. A number that only looks like an attachment
 * id keeps that item off the unused list, which is the safe way to be wrong.
 *
 * @param string $text Stored markup.
 * @param array  $refs References so far.
 * @return void
 */
function openstation_ai_media_collect_references( $text, array &$refs ) {
	// Image classes, captions, gallery markup, block attributes, media widgets, [gallery ids=""].
	preg_match_all( '/(?:wp-image-|attachment_|data-(?:attachment-)?id=["\']|"(?:id|mediaId)":|"attachment_id";i:|"ids":\[|\bids=["\'])([\d,]+)/', $text, $m );
	foreach ( $m[1] as $ids ) {
		$refs += array_fill_keys( array_map( 'intval', explode( ',', $ids ) ), true );
	}
	// File names at the end of any path: src, srcset, CSS, block JSON (whose slashes may be escaped).
	preg_match_all( '#[/\\\\]([^/\\\\\s"\'()<>?\#]+\.[a-z0-9]{2,5})(?![a-z0-9])#i', $text, $m );
	foreach ( $m[1] as $file ) {
		$refs[ openstation_ai_media_file_key( $file ) ] = true;
	}
}

/**
 * The name a media file is matched on: its lower-cased basename without the
 * suffixes WordPress gives copies of an upload (`-300x200`, `-scaled`,
 * `-rotated`, an edit's `-e1700000000`), since content can point at any copy.
 *
 * @param string $file File path, URL or name.
 * @return string
 */
function openstation_ai_media_file_key( $file ) {
	return (string) preg_replace( '/(?:-(?:\d+x\d+|scaled|rotated|e\d{10,}))+(\.\w+)$/', '$1', strtolower( rawurldecode( wp_basename( $file ) ) ) );
}
