<?php

defined( 'ABSPATH' ) || exit;

function openstation_my_wordpress_user_summary_post_types() {
	return array( 'post', 'page' );
}

function &openstation_my_wordpress_user_summary_cache( $write = null ) {
	static $cache = array();

	if ( is_array( $write ) ) {
		$cache = $cache + $write;
	}

	return $cache;
}

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

	if ( isset( $primed[ $user_id ] ) ) {
		$last_active = (string) $primed[ $user_id ]['lastActive'];
	} else {
		global $wpdb;

		$type_slots      = implode( ',', array_fill( 0, count( $types ), '%s' ) );
		$last_active_raw = $wpdb->get_var(
			$wpdb->prepare(

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
