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
 * Compute the summary payload for one user. Cheap enough to call
 * per-row (each branch is one indexed query); WP's object cache
 * absorbs repeats inside a single request.
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

	// `count_user_posts` accepts an array of post types since 4.5; we
	// limit to public ones the dossier already counts so the tile and
	// the dossier agree.
	$post_count = (int) count_user_posts( $user_id, array( 'post', 'page' ), true );

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
	global $wpdb;
	$last_active_raw = $wpdb->get_var(
		$wpdb->prepare(
			"SELECT MAX(post_date_gmt) FROM {$wpdb->posts}
			WHERE post_author = %d
				AND post_status = 'publish'
				AND post_type IN ( 'post', 'page' )",
			$user_id
		)
	);
	$last_active = $last_active_raw ? mysql2date( 'c', $last_active_raw, false ) : '';

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
				'description' => __( 'Compact user summary for the site folder window.', 'desktop-mode' ),
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
