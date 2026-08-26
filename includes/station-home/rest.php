<?php
/**
 * OpenStation — Station Home snapshot endpoint.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the current-user Station Home snapshot route.
 */
function openstation_station_home_register_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/station-home',
		array(
			'methods'             => 'GET',
			'callback'            => 'openstation_station_home_rest_snapshot',
			'permission_callback' => 'openstation_rest_require_enabled',
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/station-home/cards',
		array(
			'methods'             => 'POST',
			'callback'            => 'openstation_station_home_rest_update_card_preference',
			'permission_callback' => 'openstation_rest_require_enabled',
			'args'                => array(
				'id'      => array(
					'required'          => true,
					'type'              => 'string',
					'sanitize_callback' => 'sanitize_key',
				),
				'enabled' => array(
					'required'          => true,
					'type'              => 'boolean',
					'sanitize_callback' => 'rest_sanitize_boolean',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_station_home_register_rest_routes' );

/**
 * Return the current Station Home snapshot.
 *
 * @return WP_REST_Response
 */
function openstation_station_home_rest_snapshot() {
	return rest_ensure_response( openstation_station_home_build_snapshot() );
}

/**
 * Save one explicit card choice for the current user.
 *
 * Returning a fresh snapshot lets the client add or remove the card in the
 * same paint that settles the switch, without inventing a second response
 * shape for dynamic card data.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_station_home_rest_update_card_preference( WP_REST_Request $request ) {
	$id    = sanitize_key( (string) $request->get_param( 'id' ) );
	$cards = openstation_station_home_get_registered_cards();
	if ( '' === $id || ! isset( $cards[ $id ] ) ) {
		return new WP_Error(
			'openstation_station_home_card_not_found',
			__( 'That Station Home card is not available.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$user_id     = get_current_user_id();
	$preferences = openstation_station_home_get_card_preferences( $user_id );
	$enabled     = rest_sanitize_boolean( $request->get_param( 'enabled' ) );
	$preferences[ $id ] = $enabled;
	update_user_meta( $user_id, OPENSTATION_STATION_HOME_CARD_PREFERENCES_META, $preferences );

	/**
	 * Fires after a user opts in to or out of a Station Home card.
	 *
	 * @param int    $user_id User id.
	 * @param string $id      Card id.
	 * @param bool   $enabled New explicit state.
	 */
	do_action( 'openstation_station_home_card_preference_updated', $user_id, $id, $enabled );

	return rest_ensure_response( openstation_station_home_build_snapshot() );
}

/**
 * Post types that the current user can edit and that belong in recent work.
 *
 * @return string[]
 */
function openstation_station_home_editable_post_types() {
	$types = array();
	foreach ( get_post_types( array( 'show_ui' => true ), 'objects' ) as $type ) {
		if ( ! is_object( $type ) || 'attachment' === $type->name ) {
			continue;
		}
		// Core's internal editor records (`wp_navigation`, `wp_block`,
		// templates, styles) are implementation details rather than work a
		// person expects to resume from a home screen. Keep Posts and Pages,
		// then admit public UI-visible custom types.
		if ( ! in_array( $type->name, array( 'post', 'page' ), true ) && ! $type->public ) {
			continue;
		}
		if ( current_user_can( $type->cap->edit_posts ) ) {
			$types[] = $type->name;
		}
	}
	return array_values( array_unique( $types ) );
}

/**
 * Query the current user's most recently modified editable content.
 *
 * @param string[] $post_types Editable post types.
 * @return array[]
 */
function openstation_station_home_recent_work( $post_types ) {
	if ( empty( $post_types ) ) {
		return array();
	}

	$query = new WP_Query(
		array(
			'post_type'              => $post_types,
			'post_status'            => array( 'draft', 'pending', 'future', 'private', 'publish' ),
			'author'                 => get_current_user_id(),
			'posts_per_page'         => 5,
			'orderby'                => 'modified',
			'order'                  => 'DESC',
			'ignore_sticky_posts'    => true,
			'no_found_rows'          => true,
			'update_post_meta_cache' => false,
			'update_post_term_cache' => false,
		)
	);

	$items = array();
	foreach ( $query->posts as $post ) {
		$edit_url = get_edit_post_link( $post->ID, 'raw' );
		if ( ! is_string( $edit_url ) || '' === $edit_url ) {
			continue;
		}

		$type_object   = get_post_type_object( $post->post_type );
		$status_object = get_post_status_object( $post->post_status );
		$title         = get_the_title( $post );
		$modified_gmt  = (string) get_post_field( 'post_modified_gmt', $post );
		$modified_iso  = '';
		if ( '' !== $modified_gmt && '0000-00-00 00:00:00' !== $modified_gmt ) {
			$timestamp = strtotime( $modified_gmt . ' UTC' );
			if ( false !== $timestamp ) {
				$modified_iso = gmdate( 'c', $timestamp );
			}
		}

		$items[] = array(
			'id'          => (int) $post->ID,
			'title'       => '' !== trim( $title ) ? $title : __( '(Untitled)', 'desktop-mode' ),
			'typeLabel'   => $type_object ? $type_object->labels->singular_name : __( 'Content', 'desktop-mode' ),
			'icon'        => 'page' === $post->post_type ? 'dashicons-admin-page' : 'dashicons-admin-post',
			'status'      => (string) $post->post_status,
			'statusLabel' => $status_object ? $status_object->label : ucfirst( (string) $post->post_status ),
			'modifiedGmt' => $modified_iso,
			'editUrl'     => esc_url_raw( $edit_url ),
		);
	}

	return $items;
}

/**
 * Count current-user drafts across the editable Station Home types.
 *
 * @param string[] $post_types Editable post types.
 * @return int
 */
function openstation_station_home_draft_count( $post_types ) {
	if ( empty( $post_types ) ) {
		return 0;
	}
	$query = new WP_Query(
		array(
			'post_type'      => $post_types,
			'post_status'    => 'draft',
			'author'         => get_current_user_id(),
			'posts_per_page' => 1,
			'fields'         => 'ids',
			'no_found_rows'  => false,
		)
	);
	return (int) $query->found_posts;
}

/**
 * Count published posts and pages on the site.
 *
 * @return int
 */
function openstation_station_home_published_count() {
	$total = 0;
	foreach ( array( 'post', 'page' ) as $post_type ) {
		$counts = wp_count_posts( $post_type );
		$total += isset( $counts->publish ) ? (int) $counts->publish : 0;
	}
	return $total;
}

/**
 * Count image attachments whose alternative text is empty or absent.
 *
 * @return int
 */
function openstation_station_home_missing_alt_count() {
	if ( ! current_user_can( 'upload_files' ) ) {
		return 0;
	}

	$query = new WP_Query(
		array(
			'post_type'      => 'attachment',
			'post_status'    => 'inherit',
			'post_mime_type' => 'image',
			'posts_per_page' => 1,
			'fields'         => 'ids',
			'no_found_rows'  => false,
			'meta_query'     => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- one bounded dashboard count, only for users who can remediate it.
				'relation' => 'OR',
				array(
					'key'     => '_wp_attachment_image_alt',
					'compare' => 'NOT EXISTS',
				),
				array(
					'key'     => '_wp_attachment_image_alt',
					'value'   => '',
					'compare' => '=',
				),
			),
		)
	);
	return (int) $query->found_posts;
}

/**
 * Read WordPress's cached update totals without making a network request.
 *
 * @return int
 */
function openstation_station_home_update_count() {
	if ( ! current_user_can( 'update_core' ) && ! current_user_can( 'update_plugins' ) && ! current_user_can( 'update_themes' ) ) {
		return 0;
	}

	if ( ! function_exists( 'wp_get_update_data' ) ) {
		require_once ABSPATH . 'wp-admin/includes/update.php';
	}
	$data = wp_get_update_data();
	return isset( $data['counts']['total'] ) ? (int) $data['counts']['total'] : 0;
}

/**
 * Build capability-aware quick actions.
 *
 * @return array[]
 */
function openstation_station_home_quick_actions() {
	$actions = array();
	if ( current_user_can( 'edit_posts' ) ) {
		$actions[] = array(
			'id'    => 'new-post',
			'label' => __( 'New post', 'desktop-mode' ),
			'icon'  => 'dashicons-edit',
			'kind'  => 'url',
			'url'   => esc_url_raw( admin_url( 'post-new.php' ) ),
		);
	}
	if ( current_user_can( 'upload_files' ) ) {
		$actions[] = array(
			'id'    => 'upload-media',
			'label' => __( 'Upload media', 'desktop-mode' ),
			'icon'  => 'dashicons-upload',
			'kind'  => 'url',
			'url'   => esc_url_raw( admin_url( 'media-new.php' ) ),
		);
	}
	$actions[] = array(
		'id'    => 'view-site',
		'label' => __( 'View site', 'desktop-mode' ),
		'icon'  => 'dashicons-visibility',
		'kind'  => 'external',
		'url'   => esc_url_raw( home_url( '/' ) ),
	);
	if ( function_exists( 'openstation_my_wordpress_user_can_use' ) && openstation_my_wordpress_user_can_use() ) {
		$actions[] = array(
			'id'       => 'wp-explorer',
			'label'    => __( 'WP Explorer', 'desktop-mode' ),
			'icon'     => 'dashicons-open-folder',
			'kind'     => 'native',
			'windowId' => 'desktop-mode-my-wordpress',
		);
	}
	$actions[] = array(
		'id'    => 'classic-dashboard',
		'label' => __( 'Classic Dashboard', 'desktop-mode' ),
		'icon'  => 'dashicons-dashboard',
		'kind'  => 'classic',
		'url'   => esc_url_raw( add_query_arg( OPENSTATION_CLASSIC_FLAG, '1', admin_url( 'index.php' ) ) ),
	);
	return $actions;
}

/**
 * Assemble the role-aware snapshot consumed by the Station Home bundle.
 *
 * @return array<string, mixed>
 */
function openstation_station_home_build_snapshot() {
	$user         = wp_get_current_user();
	$post_types   = openstation_station_home_editable_post_types();
	$drafts       = openstation_station_home_draft_count( $post_types );
	$published    = openstation_station_home_published_count();
	$comment_data = wp_count_comments();
	$pending      = current_user_can( 'moderate_comments' ) ? (int) $comment_data->moderated : 0;
	$updates      = openstation_station_home_update_count();
	$missing_alt  = openstation_station_home_missing_alt_count();
	$first_name   = trim( (string) get_user_meta( $user->ID, 'first_name', true ) );
	$display_name = '' !== $first_name ? $first_name : $user->display_name;
	$cards         = openstation_station_home_build_cards(
		openstation_station_home_get_registered_cards(),
		openstation_station_home_get_card_preferences( $user->ID )
	);

	$attention = array();
	if ( $pending > 0 ) {
		$attention[] = array(
			'id'          => 'comments',
			'icon'        => 'dashicons-admin-comments',
			'count'       => $pending,
			'label'       => sprintf(
				/* translators: %s: pending comment count. */
				_n( '%s pending comment', '%s pending comments', $pending, 'desktop-mode' ),
				number_format_i18n( $pending )
			),
			'description' => __( 'Review and reply to keep the conversation moving.', 'desktop-mode' ),
			'url'         => esc_url_raw( admin_url( 'edit-comments.php?comment_status=moderated' ) ),
		);
	}
	if ( $updates > 0 ) {
		$attention[] = array(
			'id'          => 'updates',
			'icon'        => 'dashicons-update',
			'count'       => $updates,
			'label'       => sprintf(
				/* translators: %s: update count. */
				_n( '%s update available', '%s updates available', $updates, 'desktop-mode' ),
				number_format_i18n( $updates )
			),
			'description' => __( 'Keep WordPress, themes, and plugins current.', 'desktop-mode' ),
			'url'         => esc_url_raw( admin_url( 'update-core.php' ) ),
		);
	}
	if ( $missing_alt > 0 ) {
		$attention[] = array(
			'id'          => 'missing-alt',
			'icon'        => 'dashicons-format-image',
			'count'       => $missing_alt,
			'label'       => sprintf(
				/* translators: %s: image count. */
				_n( '%s image needs alt text', '%s images need alt text', $missing_alt, 'desktop-mode' ),
				number_format_i18n( $missing_alt )
			),
			'description' => __( 'Add a useful description for people using assistive technology.', 'desktop-mode' ),
			'url'         => esc_url_raw( admin_url( 'upload.php?mode=list' ) ),
		);
	}

	return array(
		'userName'     => $display_name,
		'siteName'     => get_bloginfo( 'name' ),
		'work'         => openstation_station_home_recent_work( $post_types ),
		'quickActions' => openstation_station_home_quick_actions(),
		'metrics'      => array(
			array(
				'id'    => 'drafts',
				'label' => __( 'Drafts', 'desktop-mode' ),
				'icon'  => 'dashicons-edit',
				'value' => $drafts,
			),
			array(
				'id'    => 'comments',
				'label' => __( 'Pending comments', 'desktop-mode' ),
				'icon'  => 'dashicons-admin-comments',
				'value' => $pending,
			),
			array(
				'id'    => 'updates',
				'label' => __( 'Updates', 'desktop-mode' ),
				'icon'  => 'dashicons-update',
				'value' => $updates,
			),
			array(
				'id'    => 'published',
				'label' => __( 'Published', 'desktop-mode' ),
				'icon'  => 'dashicons-admin-site-alt3',
				'value' => $published,
			),
		),
		'attention'       => $attention,
		'cards'           => $cards['cards'],
		'cardPreferences' => $cards['preferences'],
	);
}
