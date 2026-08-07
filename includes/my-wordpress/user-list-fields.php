<?php
/**
 * OpenStation — My WordPress: per-user REST fields for the
 * Users-folder list view.
 *
 * Surfaces a small "summary" payload on every `/wp/v2/users` row so
 * the My WordPress folder window can paint a rich tile (avatar +
 * name + role chip + post count + member-since) without firing
 * N+1 dossier requests as the user scrolls.
 *
 * Fields:
 *
 *   - `openstation_summary.postCount`   int     count of non-trash posts authored
 *   - `openstation_summary.roleLabels`  array   translated role labels (gated on `list_users` OR self)
 *   - `openstation_summary.registered`  string  ISO-8601 registered date (gated on `list_users` OR self)
 *   - `openstation_summary.lastActive`  string  ISO-8601 of latest published post, or '' when unknown
 *
 * Each field is independently capability-gated so a viewer without
 * `list_users` still sees `postCount` (public counts) and a public
 * `lastActive` derived from publish dates, but doesn't see
 * `roleLabels` or `registered` (private).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The post types a summary counts. Kept in one place so the per-user
 * query and the grouped prefetch below can't drift apart — a tile
 * whose count changes depending on how the page was loaded is worse
 * than no count at all.
 *
 * @return string[]
 */
function openstation_my_wordpress_user_summary_post_types() {
	return array( 'post', 'page' );
}

/**
 * Per-request store of prefetched post counts and last-active dates,
 * keyed by user id. Populated by
 * {@see openstation_my_wordpress_user_summary_prime()}; read by the
 * payload builder below.
 *
 * @param array|null $write Rows to merge in, or null to read.
 * @return array<int,array{postCount:int,lastActive:string}>
 */
function &openstation_my_wordpress_user_summary_cache( $write = null ) {
	static $cache = array();

	if ( is_array( $write ) ) {
		$cache = $cache + $write;
	}

	return $cache;
}

/**
 * Prefetch the two queried facts — authored-post count and latest
 * publish date — for a whole page of users in two grouped queries.
 *
 * Without this, a list view pays `count_user_posts()` plus a
 * `MAX(post_date_gmt)` lookup *per row*: 200 uncached queries for a
 * 100-row page. Call this once with the page's ids and the payload
 * builder answers from memory.
 *
 * @param int[] $user_ids User ids on the page.
 * @return void
 */
function openstation_my_wordpress_user_summary_prime( $user_ids ) {
	global $wpdb;

	$cached = openstation_my_wordpress_user_summary_cache();
	$ids    = array();
	foreach ( (array) $user_ids as $user_id ) {
		$user_id = (int) $user_id;
		if ( $user_id > 0 && ! isset( $cached[ $user_id ] ) ) {
			$ids[ $user_id ] = true;
		}
	}

	$ids = array_keys( $ids );
	if ( empty( $ids ) ) {
		return;
	}

	$types      = openstation_my_wordpress_user_summary_post_types();
	$id_slots   = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
	$type_slots = implode( ',', array_fill( 0, count( $types ), '%s' ) );

	$rows = array();
	foreach ( $ids as $user_id ) {
		$rows[ $user_id ] = array(
			'postCount'  => 0,
			'lastActive' => '',
		);
	}

	// The count `count_user_posts( $id, $types, true )` would produce,
	// for every id at once. Its `$public_only = true` resolves — via
	// `get_posts_by_author_sql()` — to exactly `post_status =
	// 'publish'`, so that is what this reproduces.
	// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- placeholder lists are built from counts, values are passed through prepare().
	$counts = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT post_author, COUNT(*) AS total FROM {$wpdb->posts}
			WHERE post_author IN ( {$id_slots} )
				AND post_type IN ( {$type_slots} )
				AND post_status = 'publish'
			GROUP BY post_author",
			array_merge( $ids, $types )
		)
	);

	$actives = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT post_author, MAX(post_date_gmt) AS latest FROM {$wpdb->posts}
			WHERE post_author IN ( {$id_slots} )
				AND post_status = 'publish'
				AND post_type IN ( {$type_slots} )
			GROUP BY post_author",
			array_merge( $ids, $types )
		)
	);
	// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

	foreach ( (array) $counts as $row ) {
		$user_id = (int) $row->post_author;
		if ( isset( $rows[ $user_id ] ) ) {
			$rows[ $user_id ]['postCount'] = (int) $row->total;
		}
	}

	foreach ( (array) $actives as $row ) {
		$user_id = (int) $row->post_author;
		if ( isset( $rows[ $user_id ] ) && $row->latest ) {
			$rows[ $user_id ]['lastActive'] = (string) mysql2date( 'c', $row->latest, false );
		}
	}

	openstation_my_wordpress_user_summary_cache( $rows );
}

/**
 * Compute the summary payload for one user.
 *
 * Answers from the prefetch when
 * {@see openstation_my_wordpress_user_summary_prime()} has run for
 * this id, and falls back to the two per-user queries when it hasn't —
 * so a single-row caller stays correct without having to know about
 * the batch path.
 *
 * @param int $user_id User id.
 * @return array{postCount:int,roleLabels:array<int,string>,registered:string,lastActive:string}
 */
function openstation_my_wordpress_user_summary_payload( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return array(
			'postCount'  => 0,
			'roleLabels' => array(),
			'registered' => '',
			'lastActive' => '',
		);
	}

	$user = get_userdata( $user_id );
	if ( ! $user ) {
		return array(
			'postCount'  => 0,
			'roleLabels' => array(),
			'registered' => '',
			'lastActive' => '',
		);
	}

	$can_see_private = current_user_can( 'list_users' )
		|| ( get_current_user_id() === $user_id );

	$primed = openstation_my_wordpress_user_summary_cache();
	$types  = openstation_my_wordpress_user_summary_post_types();

	// `count_user_posts` accepts an array of post types since 4.5; we
	// limit to public ones the dossier already counts so the tile and
	// the dossier agree.
	$post_count = isset( $primed[ $user_id ] )
		? (int) $primed[ $user_id ]['postCount']
		: (int) count_user_posts( $user_id, $types, true );

	$role_labels = array();
	if ( $can_see_private && function_exists( 'wp_roles' ) ) {
		$wp_roles = wp_roles();
		foreach ( (array) $user->roles as $slug ) {
			$role_labels[] = isset( $wp_roles->role_names[ $slug ] )
				? translate_user_role( $wp_roles->role_names[ $slug ] )
				: $slug;
		}
	}

	$registered = '';
	if ( $can_see_private && '' !== $user->user_registered ) {
		$registered = mysql2date( 'c', $user->user_registered, false );
	}

	// Latest published post — useful at-a-glance "active recently?"
	// signal for the tile. Drawn from `post_date_gmt` so timezone
	// drift can't shift the displayed date.
	if ( isset( $primed[ $user_id ] ) ) {
		$last_active = (string) $primed[ $user_id ]['lastActive'];
	} else {
		global $wpdb;

		$type_slots      = implode( ',', array_fill( 0, count( $types ), '%s' ) );
		$last_active_raw = $wpdb->get_var(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- placeholder list is built from a count, values pass through prepare().
				"SELECT MAX(post_date_gmt) FROM {$wpdb->posts}
				WHERE post_author = %d
					AND post_status = 'publish'
					AND post_type IN ( {$type_slots} )",
				array_merge( array( $user_id ), $types )
			)
		);
		$last_active     = $last_active_raw ? mysql2date( 'c', $last_active_raw, false ) : '';
	}

	return array(
		'postCount'  => $post_count,
		'roleLabels' => $role_labels,
		'registered' => (string) $registered,
		'lastActive' => (string) $last_active,
	);
}

/**
 * Register the field on the `user` REST resource. The field is
 * read-only (no `update_callback`); `get_callback` receives the
 * user response array, from which we read `id`.
 */
function openstation_my_wordpress_register_user_summary_field() {
	register_rest_field(
		'user',
		'openstation_summary',
		array(
			'get_callback' => static function ( $user ) {
				$id = isset( $user['id'] ) ? (int) $user['id'] : 0;
				return openstation_my_wordpress_user_summary_payload( $id );
			},
			'schema'       => array(
				'description' => __( 'Compact user summary for the WP Explorer window.', 'desktop-mode' ),
				'type'        => 'object',
				'context'     => array( 'view', 'edit', 'embed' ),
				'readonly'    => true,
				'properties'  => array(
					'postCount'  => array(
						'type'        => 'integer',
						'description' => __( 'Count of posts and pages authored by this user.', 'desktop-mode' ),
					),
					'roleLabels' => array(
						'type'        => 'array',
						'description' => __( 'Translated role labels visible to viewers with list_users.', 'desktop-mode' ),
						'items'       => array( 'type' => 'string' ),
					),
					'registered' => array(
						'type'        => 'string',
						'description' => __( 'ISO-8601 registration date (gated on list_users).', 'desktop-mode' ),
					),
					'lastActive' => array(
						'type'        => 'string',
						'description' => __( 'ISO-8601 of latest publish; empty when the user has none.', 'desktop-mode' ),
					),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_my_wordpress_register_user_summary_field' );
