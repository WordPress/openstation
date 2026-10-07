<?php

defined( 'ABSPATH' ) || exit;

function openstation_my_wordpress_post_lock_payload( $post_id ) {
	$post_id = (int) $post_id;
	if ( $post_id <= 0 ) {
		return null;
	}

	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return null;
	}

	require_once ABSPATH . 'wp-admin/includes/post.php';
	$lock_user_id = wp_check_post_lock( $post_id );
	if ( ! $lock_user_id ) {
		return null;
	}

	$user = get_userdata( (int) $lock_user_id );
	if ( ! $user ) {
		return null;
	}

	$raw       = (string) get_post_meta( $post_id, '_edit_lock', true );
	$timestamp = 0;
	if ( '' !== $raw && false !== strpos( $raw, ':' ) ) {
		list( $timestamp ) = explode( ':', $raw );
		$timestamp         = (int) $timestamp;
	}

	$avatar = get_avatar_url( $user->ID, array( 'size' => 48 ) );

	return array(
		'userId'        => (int) $user->ID,
		'userName'      => openstation_plain_text_title( $user->display_name ),
		'userAvatarUrl' => is_string( $avatar ) ? $avatar : '',
		'time'          => $timestamp > 0 ? gmdate( 'c', $timestamp ) : '',
	);
}

function openstation_my_wordpress_post_contributors_payload( $post_id ) {
	$post_id = (int) $post_id;
	if ( $post_id <= 0 ) {
		return array();
	}

	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return array();
	}

	$post = get_post( $post_id );
	if ( ! $post ) {
		return array();
	}

	$primary_author_id = (int) $post->post_author;
	$ids               = array();

	if ( function_exists( 'get_coauthors' ) ) {
		$coauthors = get_coauthors( $post_id );
		foreach ( (array) $coauthors as $user ) {
			if ( $user instanceof WP_User ) {
				$ids[] = (int) $user->ID;
			} elseif ( is_object( $user ) && isset( $user->ID ) ) {
				$ids[] = (int) $user->ID;
			}
		}
	}

	$revision_ids = wp_get_post_revisions(
		$post_id,
		array(
			'fields'      => 'ids',

			'numberposts' => -1,
		)
	);
	foreach ( (array) $revision_ids as $rev_id ) {
		$rev = get_post( $rev_id );
		if ( $rev ) {
			$ids[] = (int) $rev->post_author;
		}
	}

	$edit_last = (int) get_post_meta( $post_id, '_edit_last', true );
	if ( $edit_last > 0 ) {
		$ids[] = $edit_last;
	}

	$ids = (array) apply_filters( 'openstation_my_wordpress_post_contributors', $ids, $post_id );

	$out  = array();
	$seen = array();
	foreach ( $ids as $id ) {
		$id = (int) $id;
		if ( $id <= 0 ) {
			continue;
		}
		if ( $id === $primary_author_id ) {
			continue;
		}
		if ( isset( $seen[ $id ] ) ) {
			continue;
		}
		$seen[ $id ] = true;
		$user        = get_userdata( $id );
		if ( ! $user ) {
			continue;
		}
		$avatar = get_avatar_url( $user->ID, array( 'size' => 96 ) );
		$out[]  = array(
			'userId'        => (int) $user->ID,
			'userName'      => (string) $user->display_name,
			'userAvatarUrl' => is_string( $avatar ) ? $avatar : '',
		);
	}
	return $out;
}

function openstation_my_wordpress_register_lock_field() {
	$types = openstation_my_wordpress_rest_field_post_types();

	foreach ( $types as $type ) {
		register_rest_field(
			$type,
			'openstation_lock',
			array(
				'get_callback' => static function ( $post ) {
					$post_id = isset( $post['id'] ) ? (int) $post['id'] : 0;
					return openstation_my_wordpress_post_lock_payload( $post_id );
				},
				'schema'       => array(
					'description' => __( 'Active edit-lock holder, or null when the post is not locked.', 'desktop-mode' ),
					'type'        => array( 'object', 'null' ),
					'context'     => array( 'view', 'edit' ),
					'readonly'    => true,
					'properties'  => array(
						'userId'        => array( 'type' => 'integer' ),
						'userName'      => array( 'type' => 'string' ),
						'userAvatarUrl' => array( 'type' => 'string' ),
						'time'          => array( 'type' => 'string' ),
					),
				),
			)
		);

		register_rest_field(
			$type,
			'openstation_contributors',
			array(
				'get_callback' => static function ( $post ) {
					$post_id = isset( $post['id'] ) ? (int) $post['id'] : 0;
					return openstation_my_wordpress_post_contributors_payload( $post_id );
				},
				'schema'       => array(
					'description' => __( 'Additional contributor users beyond the primary author. Sourced from Co-Authors Plus when present, revision authors, the `_edit_last` meta, plus anything plugins return via `openstation_my_wordpress_post_contributors`. Empty for requesters who cannot edit the post.', 'desktop-mode' ),
					'type'        => 'array',
					'context'     => array( 'view', 'edit' ),
					'readonly'    => true,
					'items'       => array(
						'type'       => 'object',
						'properties' => array(
							'userId'        => array( 'type' => 'integer' ),
							'userName'      => array( 'type' => 'string' ),
							'userAvatarUrl' => array( 'type' => 'string' ),
						),
					),
				),
			)
		);
	}
}
add_action( 'rest_api_init', 'openstation_my_wordpress_register_lock_field' );
