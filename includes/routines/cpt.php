<?php
/**
 * Desktop Mode — Routines: CPT registration.
 *
 * `wpdm_routine` is private (no public archives, no rewrite),
 * supports authorship + revisions, and is gated to `manage_options`.
 * UI is custom — the CPT exists for storage, capability inheritance,
 * and revision history, not for the wp-admin Posts list.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the CPT.
 *
 * @since 0.22.0
 */
function wpdm_routine_register_cpt() {
	register_post_type(
		WPDM_ROUTINE_CPT,
		array(
			'labels'              => array(
				'name'          => __( 'Routines', 'desktop-mode' ),
				'singular_name' => __( 'Routine', 'desktop-mode' ),
			),
			'public'              => false,
			'show_ui'             => false,
			'show_in_menu'        => false,
			'show_in_admin_bar'   => false,
			'show_in_nav_menus'   => false,
			'show_in_rest'        => false,
			'exclude_from_search' => true,
			'publicly_queryable'  => false,
			'has_archive'         => false,
			'rewrite'             => false,
			'supports'            => array( 'title', 'author', 'revisions' ),
			// Defaults: capability_type=post, map_meta_cap=true. We
			// deliberately do NOT alias the meta-caps (delete_post,
			// edit_post, …) to manage_options — doing so triggers WP's
			// "must always check it against a specific post" notice
			// from map_meta_cap whenever any subsystem (admin menu,
			// list-table, Gutenberg discovery) probes the cap without
			// a post id. The actual access gate is enforced two
			// layers up — `wpdm_routine_user_can_manage()` and the
			// REST permission callbacks both require manage_options
			// before any CRUD reaches `wp_insert_post`. The CPT
			// itself is invisible to wp-admin (`show_ui=false`,
			// `show_in_rest=false`) so the default post caps suffice.
		)
	);

	register_post_meta(
		WPDM_ROUTINE_CPT,
		WPDM_ROUTINE_DEF_META,
		array(
			'type'              => 'string',
			'single'            => true,
			'show_in_rest'      => false,
			'sanitize_callback' => 'wp_kses_post', // we re-validate on every read
		)
	);
	register_post_meta(
		WPDM_ROUTINE_CPT,
		WPDM_ROUTINE_ENABLED_META,
		array(
			'type'              => 'boolean',
			'single'            => true,
			'show_in_rest'      => false,
			'sanitize_callback' => 'rest_sanitize_boolean',
		)
	);
	register_post_meta(
		WPDM_ROUTINE_CPT,
		WPDM_ROUTINE_STATS_META,
		array(
			'type'         => 'string',
			'single'       => true,
			'show_in_rest' => false,
		)
	);
}
add_action( 'init', 'wpdm_routine_register_cpt', 5 );

/**
 * Whether the current user may manage routines.
 *
 * Filterable so site owners can grant access to a custom role
 * without losing the security default of "admins only".
 *
 * @since 0.22.0
 *
 * @return bool
 */
function wpdm_routine_user_can_manage() {
	$can = current_user_can( 'manage_options' );

	/**
	 * Filter whether the current user can manage routines.
	 *
	 * @since 0.22.0
	 *
	 * @param bool $can Default: `manage_options`.
	 */
	return (bool) apply_filters( 'wp_desktop_routine_user_can_manage', $can );
}

/**
 * Read a routine row in normalised form.
 *
 * Returns null when the post doesn't exist, isn't the right CPT,
 * or has an invalid stored definition. Engine callers that get
 * `null` for an enabled routine surface should log it — a malformed
 * definition is a bug worth knowing about.
 *
 * @since 0.22.0
 *
 * @param int $post_id Post id.
 * @return array|null `{ id, title, author, enabled, def, stats }`.
 */
function wpdm_routine_get( $post_id ) {
	$post_id = (int) $post_id;
	if ( $post_id <= 0 ) {
		return null;
	}
	$post = get_post( $post_id );
	if ( ! $post instanceof WP_Post || WPDM_ROUTINE_CPT !== $post->post_type ) {
		return null;
	}

	$def_raw = (string) get_post_meta( $post_id, WPDM_ROUTINE_DEF_META, true );
	$def     = $def_raw ? json_decode( $def_raw, true ) : null;
	if ( ! is_array( $def ) ) {
		return null;
	}

	$enabled = (bool) get_post_meta( $post_id, WPDM_ROUTINE_ENABLED_META, true );

	$stats_raw = (string) get_post_meta( $post_id, WPDM_ROUTINE_STATS_META, true );
	$stats     = $stats_raw ? json_decode( $stats_raw, true ) : array();
	if ( ! is_array( $stats ) ) {
		$stats = array();
	}
	$stats = wp_parse_args(
		$stats,
		array(
			'runs'       => 0,
			'last_run'   => 0,
			'last_error' => '',
			'avg_ms'     => 0,
		)
	);

	return array(
		'id'      => $post_id,
		'title'   => (string) $post->post_title,
		'author'  => (int) $post->post_author,
		'enabled' => $enabled,
		'def'     => $def,
		'stats'   => $stats,
	);
}

/**
 * List all routines.
 *
 * @since 0.22.0
 *
 * @param array $args Optional filters: `enabled`, `per_page`, `page`.
 * @return array<int, array>
 */
function wpdm_routine_get_all( $args = array() ) {
	$args = wp_parse_args(
		$args,
		array(
			'enabled'  => null,
			'per_page' => 200,
			'page'     => 1,
		)
	);

	$query = new WP_Query(
		array(
			'post_type'      => WPDM_ROUTINE_CPT,
			'post_status'    => array( 'publish', 'draft' ),
			'posts_per_page' => max( 1, (int) $args['per_page'] ),
			'paged'          => max( 1, (int) $args['page'] ),
			'orderby'        => 'date',
			'order'          => 'DESC',
			'no_found_rows'  => false,
		)
	);

	$out = array();
	foreach ( $query->posts as $post ) {
		$row = wpdm_routine_get( $post->ID );
		if ( null === $row ) {
			continue;
		}
		if ( null !== $args['enabled'] && (bool) $args['enabled'] !== $row['enabled'] ) {
			continue;
		}
		$out[] = $row;
	}
	return $out;
}

/**
 * Persist a routine. Creates a new post when `id` is 0, updates
 * otherwise. Returns the post id or a `WP_Error`.
 *
 * @since 0.22.0
 *
 * @param array $data {
 *     @type int    $id      Existing post id, or 0 to create.
 *     @type string $title   Required.
 *     @type bool   $enabled Default false.
 *     @type array  $def     Required. Routine definition.
 * }
 * @return int|WP_Error
 */
function wpdm_routine_save( $data ) {
	if ( ! wpdm_routine_user_can_manage() ) {
		return new WP_Error(
			'wpdm_routine_forbidden',
			__( 'You do not have permission to manage routines.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	$id    = isset( $data['id'] ) ? (int) $data['id'] : 0;
	$title = isset( $data['title'] ) ? sanitize_text_field( (string) $data['title'] ) : '';
	if ( '' === $title ) {
		return new WP_Error(
			'wpdm_routine_invalid_title',
			__( 'Routine requires a non-empty title.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( ! isset( $data['def'] ) || ! is_array( $data['def'] ) ) {
		return new WP_Error(
			'wpdm_routine_invalid_def',
			__( 'Routine requires a `def` object.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	$validated = wpdm_routine_validate_def( $data['def'] );
	if ( is_wp_error( $validated ) ) {
		return $validated;
	}

	$enabled = ! empty( $data['enabled'] );

	if ( $id > 0 ) {
		$post = get_post( $id );
		if ( ! $post instanceof WP_Post || WPDM_ROUTINE_CPT !== $post->post_type ) {
			return new WP_Error(
				'wpdm_routine_not_found',
				__( 'Routine not found.', 'desktop-mode' ),
				array( 'status' => 404 )
			);
		}
		wp_update_post(
			array(
				'ID'         => $id,
				'post_title' => $title,
			)
		);
	} else {
		$id = wp_insert_post(
			array(
				'post_type'   => WPDM_ROUTINE_CPT,
				'post_title'  => $title,
				'post_status' => 'publish',
				'post_author' => get_current_user_id(),
			),
			true
		);
		if ( is_wp_error( $id ) ) {
			return $id;
		}
	}

	update_post_meta( $id, WPDM_ROUTINE_DEF_META, wp_slash( wp_json_encode( $validated ) ) );
	update_post_meta( $id, WPDM_ROUTINE_ENABLED_META, $enabled ? '1' : '' );

	/**
	 * Fires after a routine is saved.
	 *
	 * @since 0.22.0
	 *
	 * @param int   $id      Routine post id.
	 * @param array $def     Validated definition.
	 * @param bool  $enabled Whether the routine is enabled.
	 */
	do_action( 'wp_desktop_routine_saved', $id, $validated, $enabled );

	return (int) $id;
}

/**
 * Delete a routine.
 *
 * @since 0.22.0
 *
 * @param int $id Post id.
 * @return bool|WP_Error
 */
function wpdm_routine_delete( $id ) {
	if ( ! wpdm_routine_user_can_manage() ) {
		return new WP_Error( 'wpdm_routine_forbidden', '', array( 'status' => 403 ) );
	}
	$id   = (int) $id;
	$post = get_post( $id );
	if ( ! $post instanceof WP_Post || WPDM_ROUTINE_CPT !== $post->post_type ) {
		return new WP_Error( 'wpdm_routine_not_found', '', array( 'status' => 404 ) );
	}
	$result = wp_delete_post( $id, true );

	/**
	 * Fires after a routine is deleted.
	 *
	 * @since 0.22.0
	 *
	 * @param int $id Routine post id.
	 */
	do_action( 'wp_desktop_routine_deleted', $id );

	return false !== $result;
}
