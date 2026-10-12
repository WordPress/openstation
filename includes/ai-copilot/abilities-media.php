<?php
/**
 * OpenStation — AI Copilot: media library abilities.
 *
 * Two read-only abilities, so the assistant can answer "where is this
 * image used?" and "which images aren't used anywhere?":
 *
 *   search_media        library items by name, each with where it is used
 *   find_unused_media   the items nothing on the site points at
 *
 * `search_media` reads WP Explorer's "Used in" scan
 * (`includes/my-wordpress/media-usage.php`), so the assistant and the
 * window list the same places. `find_unused_media` cannot run that scan
 * per item (a LIKE pass over every post, for every attachment), so it
 * reads the site once and checks the whole library against what it
 * found. Its rules are wider than the scan's on purpose: anything that
 * might be a reference counts as one, because the wrong answer here is
 * an image someone deletes while a page still shows it.
 *
 * Neither ability can delete anything, and the model is told so.
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

	$readonly_meta = array(
		'annotations'  => array(
			'readonly'   => true,
			'idempotent' => true,
		),
		'show_in_rest' => true,
	);

	$list_output = openstation_ai_ability_output_schema(
		array(
			'items'    => array( 'type' => 'array' ),
			'count'    => array( 'type' => 'integer' ),
			'total'    => array( 'type' => 'integer' ),
			'has_more' => array( 'type' => 'boolean' ),
		)
	);

	wp_register_ability(
		'desktop-mode/search-media',
		array(
			'label'               => __( 'Search media', 'desktop-mode' ),
			'description'         => 'Keyword-searches the media library (images, video, audio, documents) by title and file name, and returns each item with where it is used: `used_in_count`, and up to 5 `used_in` places with the post title, its type and whether the item is its featured image or sits in its content. Use it for "where is this image used?" or "have I used this photo a lot?". An empty `query` lists the newest items. Places are featured images and post content of the posts the user can read, so an item with no places can still be used elsewhere (a template, a widget, the site logo): never call an item unused from this tool, use find_unused_media for that. If has_more is true, call again with the next offset.',
			'category'            => OPENSTATION_AI_ABILITY_CATEGORY,
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'query', 'offset' ),
				'properties'           => array(
					'query'  => array(
						'type'        => 'string',
						'description' => 'One distinctive word from the item\'s title or file name, e.g. "paella". An empty string lists the newest items.',
					),
					'offset' => array(
						'type'        => 'integer',
						'description' => 'Zero-based starting position. Use 0 for the first batch, 10 for the second, and so on.',
					),
				),
			),
			'output_schema'       => $list_output,
			'execute_callback'    => 'openstation_ai_search_media',
			'permission_callback' => 'openstation_ai_media_can_search',
			'meta'                => $readonly_meta,
		)
	);

	wp_register_ability(
		'desktop-mode/find-unused-media',
		array(
			'label'               => __( 'Find unused media', 'desktop-mode' ),
			'description'         => 'Lists the media library items nothing on the site points at, newest first. Use it for "which images aren\'t used?" or "what can I delete from the media library?". It checks featured images, the content of every post, page, template, template part and synced pattern (drafts, private posts and trash included), widgets, the site logo and icon, the header and background images, and WooCommerce product galleries. It cannot see custom fields, page-builder data kept outside post content, or images a theme or plugin loads from its own code. So a listed item is "not found anywhere I checked", not proof that nothing uses it: say that, and leave deleting to the user. `total` is how many unused items there are, `library_total` how many items of that type the library holds. If has_more is true, call again with the next offset.',
			'category'            => OPENSTATION_AI_ABILITY_CATEGORY,
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'offset' ),
				'properties'           => array(
					'offset' => array(
						'type'        => 'integer',
						'description' => 'Zero-based starting position. Use 0 for the first batch, 10 for the second, and so on.',
					),
					'type'   => array(
						'type'        => 'string',
						'enum'        => array( 'image', 'video', 'audio', 'any' ),
						'description' => 'Which items to check. Defaults to `image`.',
					),
				),
			),
			'output_schema'       => $list_output,
			'execute_callback'    => 'openstation_ai_find_unused_media',
			'permission_callback' => 'openstation_ai_media_can_find_unused',
			'meta'                => $readonly_meta,
		)
	);
}
add_action( 'wp_abilities_api_init', 'openstation_ai_register_media_abilities' );

/**
 * `desktop-mode/search-media` permission callback: the capability the
 * Media Library itself requires. Each item is then gated on its parent,
 * and each place it is used in on `read_post`.
 *
 * @return bool
 */
function openstation_ai_media_can_search() {
	return current_user_can( 'upload_files' );
}

/**
 * `desktop-mode/find-unused-media` permission callback.
 *
 * "Unused" is worked out over every post, including ones the caller may
 * not be able to open, so an image used only in someone else's draft is
 * never listed as unused. That makes the answer an oracle for posts the
 * caller cannot read, so the ability is held at `delete_others_posts`
 * (Editors and Administrators): the caller who can delete any upload,
 * which is what the answer is for, and who reads nearly every one of
 * those posts anyway.
 *
 * @return bool
 */
function openstation_ai_media_can_find_unused() {
	return current_user_can( 'delete_others_posts' );
}

/**
 * Whether the current user may see a media item, judged on the post it
 * is attached to. The rule, and why it skips the parent's password, is
 * documented on the permission callback of `desktop-mode/get-media`
 * (`includes/agents/abilities.php`), which shares it.
 *
 * @param WP_Post $attachment Attachment post.
 * @return bool
 */
function openstation_ai_can_read_media_parent( WP_Post $attachment ) {
	$parent_id = (int) $attachment->post_parent;
	if ( $parent_id <= 0 || (int) $attachment->ID === $parent_id ) {
		return true;
	}
	$parent = get_post( $parent_id );
	if ( ! ( $parent instanceof WP_Post ) ) {
		return true;
	}

	if ( ! current_user_can( 'read_post', $parent->ID ) ) {
		return false;
	}
	$parent_type = get_post_type_object( $parent->post_type );
	if ( ! $parent_type || ! is_post_type_viewable( $parent_type ) ) {
		return current_user_can( 'edit_post', $parent->ID );
	}
	return true;
}

/**
 * The fields both abilities return for a media item.
 *
 * @param WP_Post $attachment Attachment post.
 * @return array
 */
function openstation_ai_media_item( WP_Post $attachment ) {
	return array(
		'id'       => (int) $attachment->ID,
		'title'    => wp_strip_all_tags( $attachment->post_title ),
		'filename' => wp_basename( (string) get_post_meta( $attachment->ID, '_wp_attached_file', true ) ),
		'mime'     => (string) $attachment->post_mime_type,
		'date'     => substr( (string) $attachment->post_date, 0, 10 ),
		'url'      => (string) wp_get_attachment_url( $attachment->ID ),
		'edit_url' => (string) get_edit_post_link( $attachment->ID, 'raw' ),
	);
}

/**
 * `desktop-mode/search-media` execute callback.
 *
 * Items whose parent the caller cannot read are dropped after the
 * query, so `total` counts them: the same trade the content searches
 * make.
 *
 * @param array $input Validated input.
 * @return array
 */
function openstation_ai_search_media( $input ) {
	$input  = (array) $input;
	$query  = isset( $input['query'] ) ? sanitize_text_field( (string) $input['query'] ) : '';
	$offset = max( 0, (int) ( $input['offset'] ?? 0 ) );

	// What the Media Library's own search does, so a file name finds its item.
	add_filter( 'wp_allow_query_attachment_by_filename', '__return_true' );
	$wp_query = new WP_Query(
		array(
			'post_type'              => 'attachment',
			'post_status'            => 'inherit',
			's'                      => $query,
			'posts_per_page'         => OPENSTATION_AI_SEARCH_BATCH_SIZE,
			'offset'                 => $offset,
			'update_post_term_cache' => false,
		)
	);

	$items = array();
	foreach ( $wp_query->posts as $attachment ) {
		if ( ! openstation_ai_can_read_media_parent( $attachment ) ) {
			continue;
		}
		$usage   = openstation_my_wordpress_media_usage_payload( $attachment );
		$used_in = isset( $usage['usedIn'] ) && is_array( $usage['usedIn'] ) ? $usage['usedIn'] : array();
		$places  = array();
		foreach ( array_slice( $used_in, 0, 5 ) as $row ) {
			$places[] = array(
				'title'    => (string) ( $row['title'] ?? '' ),
				'type'     => (string) ( $row['postTypeLabel'] ?? '' ),
				'used_as'  => (string) ( $row['usedAs'] ?? '' ),
				'edit_url' => (string) ( $row['editLink'] ?? '' ),
			);
		}
		$items[] = openstation_ai_media_item( $attachment ) + array(
			'used_in_count' => count( $used_in ),
			'used_in'       => $places,
		);
	}

	$total = (int) $wp_query->found_posts;

	return array(
		'tool'        => 'search_media',
		'query'       => $query,
		'offset'      => $offset,
		'items'       => $items,
		'count'       => count( $items ),
		'total'       => $total,
		'has_more'    => ( $offset + OPENSTATION_AI_SEARCH_BATCH_SIZE ) < $total,
		'next_offset' => $offset + OPENSTATION_AI_SEARCH_BATCH_SIZE,
	);
}

/**
 * `desktop-mode/find-unused-media` execute callback.
 *
 * @param array $input Validated input.
 * @return array
 */
function openstation_ai_find_unused_media( $input ) {
	global $wpdb;

	$input  = (array) $input;
	$offset = max( 0, (int) ( $input['offset'] ?? 0 ) );
	$type   = isset( $input['type'] ) && in_array( $input['type'], array( 'image', 'video', 'audio', 'any' ), true )
		? (string) $input['type']
		: 'image';

	$library = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT p.ID, p.post_parent, m.meta_value AS file
			 FROM {$wpdb->posts} p
			 LEFT JOIN {$wpdb->postmeta} m ON m.post_id = p.ID AND m.meta_key = '_wp_attached_file'
			 WHERE p.post_type = 'attachment' AND p.post_status = 'inherit' AND p.post_mime_type LIKE %s
			 ORDER BY p.post_date DESC, p.ID DESC",
			'any' === $type ? '%' : $wpdb->esc_like( $type . '/' ) . '%'
		)
	);

	$refs   = openstation_ai_media_references();
	$unused = array();
	foreach ( (array) $library as $row ) {
		$parent = (int) $row->post_parent;
		if (
			isset( $refs['ids'][ (int) $row->ID ] )
			|| ( $parent > 0 && isset( $refs['gallery_parents'][ $parent ] ) )
			|| ( ! empty( $row->file ) && isset( $refs['files'][ openstation_ai_media_file_key( $row->file ) ] ) )
		) {
			continue;
		}
		$unused[ (int) $row->ID ] = $parent;
	}

	// Gate before counting, so `total` covers the same set as the items.
	_prime_post_caches( array_merge( array_keys( $unused ), array_filter( $unused ) ), false, false );
	$extended = has_filter( 'openstation_my_wordpress_media_usage' );
	$readable = array();
	foreach ( array_keys( $unused ) as $id ) {
		$attachment = get_post( $id );
		if ( ! ( $attachment instanceof WP_Post ) || ! openstation_ai_can_read_media_parent( $attachment ) ) {
			continue;
		}
		// A reference a plugin reports to WP Explorer's "Used in" list counts too.
		if ( $extended ) {
			/** This filter is documented in includes/my-wordpress/media-usage.php */
			$usage = apply_filters( 'openstation_my_wordpress_media_usage', openstation_my_wordpress_media_usage_build( $attachment, array() ), $id );
			if ( ! empty( $usage['usedIn'] ) ) {
				continue;
			}
		}
		$readable[] = $attachment;
	}

	$items = array_map( 'openstation_ai_media_item', array_slice( $readable, $offset, OPENSTATION_AI_SEARCH_BATCH_SIZE ) );
	$total = count( $readable );

	return array(
		'tool'          => 'find_unused_media',
		'type'          => $type,
		'offset'        => $offset,
		'items'         => $items,
		'count'         => count( $items ),
		'total'         => $total,
		'library_total' => count( (array) $library ),
		'has_more'      => ( $offset + OPENSTATION_AI_SEARCH_BATCH_SIZE ) < $total,
		'next_offset'   => $offset + OPENSTATION_AI_SEARCH_BATCH_SIZE,
	);
}

/**
 * Everything on the site that points at a media item: attachment ids,
 * file names (see {@see openstation_ai_media_file_key()}), and the
 * posts whose `[gallery]` shortcode shows the files attached to them.
 *
 * The posts half is the expensive one, so it is cached against the
 * posts `last_changed` key, which every post and post meta write bumps:
 * paging through the results reads the site once. Site settings are
 * cheap and are read every time.
 *
 * @return array{ids: array<int,true>, files: array<string,true>, gallery_parents: array<int,true>}
 */
function openstation_ai_media_references() {
	global $wpdb;

	$cache_key = 'media_references:' . wp_cache_get_last_changed( 'posts' );
	$refs      = wp_cache_get( $cache_key, 'openstation_ai' );
	if ( ! is_array( $refs ) ) {
		$refs = array(
			'ids'             => array(),
			'files'           => array(),
			'gallery_parents' => array(),
		);

		// Featured images, WooCommerce product galleries (a comma list),
		// and the header and background images a theme can rotate through.
		$meta = $wpdb->get_results(
			"SELECT post_id, meta_key, meta_value FROM {$wpdb->postmeta}
			 WHERE meta_key IN ( '_thumbnail_id', '_product_image_gallery', '_wp_attachment_is_custom_header', '_wp_attachment_is_custom_background' )"
		);
		foreach ( (array) $meta as $row ) {
			$ids = 0 === strpos( $row->meta_key, '_wp_attachment_is_' ) ? array( $row->post_id ) : explode( ',', (string) $row->meta_value );
			foreach ( $ids as $id ) {
				$refs['ids'][ (int) $id ] = true;
			}
		}

		// The content of every post type, drafts and trash included: a
		// draft is about to use the image, and a trashed post can come back.
		$last_id = 0;
		do {
			$posts = (array) $wpdb->get_results(
				$wpdb->prepare(
					"SELECT ID, post_content FROM {$wpdb->posts}
					 WHERE ID > %d AND post_type NOT IN ( 'attachment', 'revision' )
					   AND post_status <> 'auto-draft' AND post_content <> ''
					 ORDER BY ID ASC LIMIT 500",
					$last_id
				)
			);
			foreach ( $posts as $post ) {
				$last_id = (int) $post->ID;
				openstation_ai_media_collect_references( (string) $post->post_content, $refs );
				if ( false !== strpos( $post->post_content, '[gallery' ) ) {
					$refs['gallery_parents'][ $last_id ] = true;
				}
			}
			$fetched = count( $posts );
		} while ( 500 === $fetched );

		wp_cache_set( $cache_key, $refs, 'openstation_ai', HOUR_IN_SECONDS );
	}

	// Widgets keep their markup and media in options.
	$widgets = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT option_value FROM {$wpdb->options} WHERE option_name LIKE %s",
			$wpdb->esc_like( 'widget_' ) . '%'
		)
	);
	foreach ( (array) $widgets as $value ) {
		openstation_ai_media_collect_references( (string) $value, $refs );
	}

	// The site logo and icon, and the active theme's header and background.
	foreach ( array( get_option( 'site_icon' ), get_option( 'site_logo' ), get_theme_mod( 'custom_logo' ) ) as $id ) {
		$refs['ids'][ (int) $id ] = true;
	}
	$header = (array) get_theme_mod( 'header_image_data' );
	if ( isset( $header['attachment_id'] ) ) {
		$refs['ids'][ (int) $header['attachment_id'] ] = true;
	}
	openstation_ai_media_collect_references( get_theme_mod( 'header_image' ) . ' ' . get_theme_mod( 'background_image' ), $refs );

	unset( $refs['ids'][0] );
	return $refs;
}

/**
 * Adds every media reference found in a piece of stored markup (post
 * content, a block's JSON attributes, a serialized widget) to `$refs`.
 *
 * Over-matching is safe and under-matching is not: a block attribute
 * `"id"` that names something other than an attachment only keeps an
 * item off the unused list.
 *
 * @param string $text Stored markup.
 * @param array  $refs References so far, see {@see openstation_ai_media_references()}.
 * @return void
 */
function openstation_ai_media_collect_references( $text, array &$refs ) {
	if ( '' === $text ) {
		return;
	}

	$id_patterns = array(
		'/wp-image-(\d+)/',                       // Image blocks, classic-editor images.
		'/attachment_(\d+)/',                     // Classic captions, [caption id="attachment_N"].
		'/data-(?:attachment-)?id=["\'](\d+)/',   // Gallery markup.
		'/"(?:id|mediaId|attachment_id)":(\d+)/', // Block attributes: cover, video, file, media & text.
		'/"attachment_id";i:(\d+)/',              // Serialized media widgets.
	);
	foreach ( $id_patterns as $pattern ) {
		if ( preg_match_all( $pattern, $text, $m ) ) {
			foreach ( $m[1] as $id ) {
				$refs['ids'][ (int) $id ] = true;
			}
		}
	}

	// Id lists: gallery blocks ("ids":[1,2]), [gallery ids="1,2"], [playlist ids="1,2"].
	if ( preg_match_all( '/(?:"ids":\[|\bids=["\'])([\d,\s]+)/', $text, $m ) ) {
		foreach ( $m[1] as $list ) {
			foreach ( explode( ',', $list ) as $id ) {
				$refs['ids'][ (int) $id ] = true;
			}
		}
	}

	// File names at the end of any path: src, href, srcset, CSS, block JSON (whose slashes may be escaped).
	if ( preg_match_all( '#[/\\\\]([^/\\\\\s"\'()<>?\#]+\.[a-z0-9]{2,5})(?![a-z0-9])#i', $text, $m ) ) {
		foreach ( $m[1] as $name ) {
			$refs['files'][ openstation_ai_media_file_key( $name ) ] = true;
		}
	}
}

/**
 * The name a media file is matched on: its lower-cased basename with the
 * suffixes WordPress adds to copies of an upload removed. A sized copy
 * (`-300x200`), the big-image copy (`-scaled`), a rotated one and an
 * edited one (`-e1700000000`) are all the same item, and content can
 * point at any of them. Two uploads that share a name in different
 * months share a key, which can only keep one off the unused list.
 *
 * @param string $file File path, URL or name.
 * @return string
 */
function openstation_ai_media_file_key( $file ) {
	$name = strtolower( rawurldecode( wp_basename( (string) $file ) ) );
	do {
		$before = $name;
		$name   = (string) preg_replace( '/-(?:\d+x\d+|scaled|rotated|e\d{10,})(\.[a-z0-9]+)$/', '$1', $name );
	} while ( $name !== $before );
	return $name;
}
