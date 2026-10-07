<?php

defined( 'ABSPATH' ) || exit;

function openstation_users_window_default_query_args() {
	$args = array(

		'_fields'  =>
			'id,name,slug,email,roles,registered_date,avatar_urls,'
			. 'openstation_last_login,openstation_presence,openstation_can_edit',

		'context'  => 'edit',
		'per_page' => 20,
	);

	return (array) apply_filters( 'openstation_users_window_query_args', $args );
}

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

function openstation_users_window_locales_map() {
	$out = array(
		'' => sprintf(

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

	if ( ! isset( $out['en_US'] ) ) {
		$out['en_US'] = 'en_US';
	}
	return $out;
}

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
