<?php
/**
 * Users app — the collection query, the REST fields on the `user`
 * resource, the role / locale maps, and the page's content stats.
 *
 * The app's `data()` reads `wp/v2/users` in-process with the query
 * {@see openstation_users_window_default_query_args()} shapes, so
 * every row carries the `openstation_*` fields it asks for exactly as
 * the browser would have received them. The content counts are NOT
 * asked for per row: `openstation_users_window_stats_for()` computes
 * a whole page in two grouped queries and `data()` merges them in
 * (the `openstation_user_stats` REST field stays registered for other
 * consumers, at its per-row cost).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Default REST query args for the Users list.
 *
 * @return array
 */
function openstation_users_window_default_query_args() {
	$args = array(
		// `_fields` whitelists the columns we render plus the REST
		// fields registered below. Skipping the whitelist would pull
		// every meta + every embedded link the user controller emits.
		'_fields'  =>
			'id,name,slug,email,roles,registered_date,avatar_urls,'
			. 'openstation_last_login,openstation_presence,openstation_can_edit',
		// `context=edit` is required because `email`, `roles`, and
		// `registered_date` are edit-context-only on `/wp/v2/users`.
		// The window is already gated on `list_users`, the cap
		// `context=edit` requires.
		'context'  => 'edit',
		'per_page' => 20,
	);

	/**
	 * Filter the default outbound REST query args for the Users window.
	 *
	 * @param array $args Default args.
	 */
	return (array) apply_filters( 'openstation_users_window_query_args', $args );
}

/**
 * Build the `{ slug: label }` map for every role on the install.
 *
 * @return array<string,string>
 */
function openstation_users_window_all_roles_map() {
	$roles = wp_roles();
	$map   = array();
	foreach ( (array) $roles->roles as $slug => $info ) {
		$map[ (string) $slug ] = isset( $info['name'] )
			? translate_user_role( (string) $info['name'] )
			: (string) $slug;
	}
	return $map;
}

/**
 * Build the `{ slug: label }` map for roles the viewer is allowed
 * to assign. Empty when the viewer lacks `promote_users`.
 *
 * @param int $viewer_id Viewer's user id.
 * @return array<string,string>
 */
function openstation_users_window_role_label_map( $viewer_id ) {
	$slugs = openstation_users_window_assignable_roles( (int) $viewer_id );
	if ( empty( $slugs ) ) {
		return array();
	}
	$all = openstation_users_window_all_roles_map();
	$out = array();
	foreach ( $slugs as $slug ) {
		if ( isset( $all[ $slug ] ) ) {
			$out[ $slug ] = $all[ $slug ];
		}
	}
	return $out;
}

/**
 * Build the `[ slug => label ]` map for the Add User locale picker.
 *
 * Site default is keyed under `''` (empty string) so the form can
 * reflect "Site default — English (United States)" as the default
 * choice without forcing the user to know which slug to send.
 *
 * @return array<string,string>
 */
function openstation_users_window_locales_map() {
	$out = array(
		'' => sprintf(
			// translators: %s is the site's current locale (e.g. "en_US").
			__( 'Site default — %s', 'desktop-mode' ),
			get_locale()
		),
	);
	if ( ! function_exists( 'get_available_languages' ) ) {
		require_once ABSPATH . 'wp-admin/includes/translation-install.php';
	}
	$languages = (array) get_available_languages();
	foreach ( $languages as $slug ) {
		$out[ (string) $slug ] = (string) $slug;
	}
	// Always offer en_US even if no .mo file is installed — core
	// always treats it as available.
	if ( ! isset( $out['en_US'] ) ) {
		$out['en_US'] = 'en_US';
	}
	return $out;
}

/**
 * The published post / page and approved comment counts of a page of
 * users, in two grouped queries — the same numbers
 * `count_user_posts( $id, $type, true )` and a `get_comments` COUNT
 * give per user, without the three round trips per row.
 *
 * @param int[] $ids User ids.
 * @return array<int,array{posts:int,pages:int,comments:int}> Keyed by user id; every id present.
 */
function openstation_users_window_stats_for( array $ids ) {
	global $wpdb;
	$ids = array_values( array_unique( array_filter( array_map( 'intval', $ids ) ) ) );
	$out = array();
	foreach ( $ids as $id ) {
		$out[ $id ] = array(
			'posts'    => 0,
			'pages'    => 0,
			'comments' => 0,
		);
	}
	if ( array() === $ids ) {
		return $out;
	}
	$in    = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
	$types = post_type_exists( 'page' ) ? array( 'post', 'page' ) : array( 'post' );
	$rows  = $wpdb->get_results(
		$wpdb->prepare(
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- `$in` is a list of `%d` placeholders.
			"SELECT post_author, post_type, COUNT(*) AS cnt FROM {$wpdb->posts} WHERE post_author IN ( $in ) AND post_status = 'publish' AND post_type IN ( " . implode( ',', array_fill( 0, count( $types ), '%s' ) ) . ' ) GROUP BY post_author, post_type',
			array_merge( $ids, $types )
		),
		ARRAY_A
	);
	foreach ( (array) $rows as $row ) {
		$author = (int) $row['post_author'];
		$key    = 'page' === $row['post_type'] ? 'pages' : 'posts';
		if ( isset( $out[ $author ] ) ) {
			$out[ $author ][ $key ] = (int) $row['cnt'];
		}
	}
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- `$in` is a list of `%d` placeholders.
			"SELECT user_id, COUNT(*) AS cnt FROM {$wpdb->comments} WHERE user_id IN ( $in ) AND comment_approved = '1' GROUP BY user_id",
			$ids
		),
		ARRAY_A
	);
	foreach ( (array) $rows as $row ) {
		$user = (int) $row['user_id'];
		if ( isset( $out[ $user ] ) ) {
			$out[ $user ]['comments'] = (int) $row['cnt'];
		}
	}
	return $out;
}

/**
 * Register the Users REST fields on the `user` resource.
 *
 * Fields:
 *
 *   - openstation_user_stats         — `{ posts: int, pages: int, comments: int }`
 *   - openstation_last_login         — UTC unix timestamp, or null when never
 *   - openstation_presence           — 'online' | 'inactive' | 'offline'
 *   - openstation_can_edit           — viewer can edit / promote this row
 *   - openstation_assignable_roles   — role slugs the viewer can assign to this row
 *
 * The fields register on every REST request (the `user` resource is
 * partially public — published authors are visible to anyone), so
 * `openstation_last_login` and `openstation_presence` gate on
 * `list_users` (or self) inside their callbacks; `openstation_user_stats`
 * stays open because it only counts published content. The list asks
 * for the first three only; the stats and the assignable roles are a
 * query per row, and the app has both cheaper (a grouped page of
 * stats, the viewer's assignable roles in the config extra).
 */
function openstation_users_window_register_rest_fields() {
	$readonly = static function ( $description, $type, $extra = array() ) {
		return array_merge(
			array(
				'description' => $description,
				'type'        => $type,
				'context'     => array( 'view', 'edit', 'embed' ),
				'readonly'    => true,
			),
			$extra
		);
	};

	register_rest_field(
		'user',
		'openstation_user_stats',
		array(
			'get_callback' => static function ( $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				if ( $id <= 0 ) {
					return array(
						'posts'    => 0,
						'pages'    => 0,
						'comments' => 0,
					);
				}
				return array(
					'posts'    => (int) count_user_posts( $id, 'post', true ),
					'pages'    => post_type_exists( 'page' ) ? (int) count_user_posts( $id, 'page', true ) : 0,
					'comments' => (int) get_comments(
						array(
							'user_id' => $id,
							'count'   => true,
							'status'  => 'approve',
						)
					),
				);
			},
			'schema'       => $readonly( __( 'Per-user content stats: published post / page / comment counts.', 'desktop-mode' ), 'object' ),
		)
	);

	register_rest_field(
		'user',
		'openstation_last_login',
		array(
			'get_callback' => static function ( $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				// Last-login time is sensitive. Only viewers who can see
				// the Users list — or the user themselves — get it.
				if ( $id <= 0 || ( get_current_user_id() !== $id && ! current_user_can( 'list_users' ) ) ) {
					return null;
				}
				$ts = (int) get_user_meta( $id, OPENSTATION_LAST_LOGIN_META_KEY, true );
				return $ts > 0 ? $ts : null;
			},
			'schema'       => $readonly( __( 'UTC unix timestamp of this user’s last successful login, or null when never recorded.', 'desktop-mode' ), array( 'integer', 'null' ) ),
		)
	);

	register_rest_field(
		'user',
		'openstation_presence',
		array(
			'get_callback' => static function ( $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				if ( $id <= 0 || ! function_exists( 'openstation_presence_status_for_user' ) ) {
					return 'offline';
				}
				// Live presence is sensitive — same gate as last login.
				if ( get_current_user_id() !== $id && ! current_user_can( 'list_users' ) ) {
					return 'offline';
				}
				return (string) openstation_presence_status_for_user( $id );
			},
			'schema'       => $readonly(
				__( 'Live presence status: online / inactive / offline.', 'desktop-mode' ),
				'string',
				array( 'enum' => array( 'online', 'inactive', 'offline' ) )
			),
		)
	);

	register_rest_field(
		'user',
		'openstation_can_edit',
		array(
			'get_callback' => static function ( $row ) {
				$id     = isset( $row['id'] ) ? (int) $row['id'] : 0;
				$viewer = (int) get_current_user_id();
				return $id > 0 && $viewer > 0 && (bool) user_can( $viewer, 'edit_user', $id );
			},
			'schema'       => $readonly( __( 'Whether the requester can edit this user.', 'desktop-mode' ), 'boolean' ),
		)
	);

	register_rest_field(
		'user',
		'openstation_assignable_roles',
		array(
			'get_callback' => static function ( $row ) {
				$id     = isset( $row['id'] ) ? (int) $row['id'] : 0;
				$viewer = (int) get_current_user_id();
				if ( $id <= 0 || $viewer <= 0 ) {
					return array();
				}
				return array_values( openstation_users_window_assignable_roles( $viewer, $id ) );
			},
			'schema'       => $readonly(
				__( 'Role slugs the requester can assign to this user.', 'desktop-mode' ),
				'array',
				array( 'items' => array( 'type' => 'string' ) )
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_users_window_register_rest_fields' );
