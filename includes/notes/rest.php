<?php

defined( 'ABSPATH' ) || exit;

function openstation_notes_rest_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error( 'openstation_notes_unauthenticated', __( 'You must be logged in.', 'desktop-mode' ), array( 'status' => 401 ) );
	}
	if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled( get_current_user_id() ) ) {
		return new WP_Error( 'openstation_notes_disabled', __( 'OpenStation is not enabled for this user.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	return true;
}

function openstation_notes_register_rest_routes() {
	$ns = 'desktop-mode/v1';

	register_rest_route(
		$ns,
		'/notes',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'openstation_notes_rest_permission',
				'callback'            => 'openstation_notes_rest_list',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'openstation_notes_rest_permission',
				'callback'            => 'openstation_notes_rest_create',
				'args'                => array(
					'text'   => array(
						'type'              => 'string',
						'default'           => '',
						'sanitize_callback' => 'sanitize_textarea_field',
					),
					'color'  => array(
						'type'              => 'string',
						'default'           => 'butter',
						'sanitize_callback' => 'openstation_notes_sanitize_color',
					),
					'x'      => array(
						'type'    => 'number',
						'default' => 0.1,
					),
					'y'      => array(
						'type'    => 'number',
						'default' => 0.1,
					),
					'public' => array(
						'type'    => 'boolean',
						'default' => false,
					),
					'seed'   => array(
						'type'              => 'integer',
						'default'           => 0,
						'sanitize_callback' => 'absint',
					),
				),
			),
		)
	);

	register_rest_route(
		$ns,
		'/notes/(?P<id>\d+)',
		array(
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => 'openstation_notes_rest_permission',
				'callback'            => 'openstation_notes_rest_update',
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'permission_callback' => 'openstation_notes_rest_permission',
				'callback'            => 'openstation_notes_rest_delete',
			),
		)
	);

	register_rest_route(
		$ns,
		'/notes/(?P<id>\d+)/restore',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'openstation_notes_rest_permission',
			'callback'            => 'openstation_notes_rest_restore',
		)
	);

	register_rest_route(
		$ns,
		'/notes/(?P<id>\d+)/convert',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'openstation_notes_rest_permission',
			'callback'            => 'openstation_notes_rest_convert',
		)
	);
}
add_action( 'rest_api_init', 'openstation_notes_register_rest_routes' );

function openstation_notes_get_note( $id, $allow_trash = false ) {
	$post = get_post( (int) $id );
	if ( ! $post instanceof WP_Post || OPENSTATION_NOTES_POST_TYPE !== $post->post_type ) {
		return new WP_Error( 'openstation_notes_not_found', __( 'Note not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	$allowed = $allow_trash ? array( 'private', 'publish', 'trash' ) : array( 'private', 'publish' );
	if ( ! in_array( $post->post_status, $allowed, true ) ) {
		return new WP_Error( 'openstation_notes_not_found', __( 'Note not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	return $post;
}

function openstation_notes_require_owner( $post ) {
	if ( get_current_user_id() !== (int) $post->post_author ) {
		return new WP_Error( 'openstation_notes_forbidden', __( 'Only the note owner can change it.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	return true;
}

function openstation_notes_modified_ms( $post ) {
	return (int) get_post_modified_time( 'U', true, $post ) * 1000;
}

function openstation_notes_prepare( $post ) {
	$owner_id = (int) $post->post_author;
	$owner    = get_userdata( $owner_id );

	return array(
		'id'          => (int) $post->ID,
		'text'        => (string) get_post_field( 'post_content', $post, 'raw' ),
		'color'       => openstation_notes_sanitize_color( get_post_meta( $post->ID, '_wpd_note_color', true ) ),
		'x'           => openstation_notes_sanitize_fraction( get_post_meta( $post->ID, '_wpd_note_x', true ) ),
		'y'           => openstation_notes_sanitize_fraction( get_post_meta( $post->ID, '_wpd_note_y', true ) ),
		'z'           => (int) get_post_meta( $post->ID, '_wpd_note_z', true ),
		'public'      => 'publish' === $post->post_status,
		'seed'        => (int) get_post_meta( $post->ID, '_wpd_note_seed', true ),
		'ownerId'     => $owner_id,
		'ownerName'   => $owner instanceof WP_User ? openstation_plain_text_title( $owner->display_name ) : '',
		'ownerAvatar' => (string) get_avatar_url( $owner_id, array( 'size' => 48 ) ),
		'canEdit'     => get_current_user_id() === $owner_id,
		'updatedAtMs' => openstation_notes_modified_ms( $post ),
	);
}

function openstation_notes_derive_title( $text ) {
	foreach ( preg_split( '/\r\n|\r|\n/', (string) $text ) as $line ) {
		$line = trim( $line );
		if ( '' !== $line ) {
			return mb_substr( sanitize_text_field( $line ), 0, 80 );
		}
	}
	return __( 'Note', 'desktop-mode' );
}

function openstation_notes_rest_list() {
	$user_id = get_current_user_id();

	$own = new WP_Query(
		array(
			'post_type'      => OPENSTATION_NOTES_POST_TYPE,
			'post_status'    => array( 'private', 'publish' ),
			'author'         => $user_id,
			'posts_per_page' => 200,
			'orderby'        => 'date',
			'order'          => 'DESC',
			'no_found_rows'  => true,
		)
	);

	$public = new WP_Query(
		array(
			'post_type'      => OPENSTATION_NOTES_POST_TYPE,
			'post_status'    => 'publish',
			'author__not_in' => array( $user_id ),
			'posts_per_page' => 200,
			'orderby'        => 'date',
			'order'          => 'DESC',
			'no_found_rows'  => true,
		)
	);

	$notes = array();
	foreach ( array_merge( (array) $own->posts, (array) $public->posts ) as $post ) {
		$notes[] = openstation_notes_prepare( $post );
	}
	wp_reset_postdata();

	return rest_ensure_response( array( 'notes' => $notes ) );
}

function openstation_notes_rest_create( $request ) {

	$can_create = apply_filters( 'openstation_notes_user_can_create', true, get_current_user_id(), $request );
	if ( ! $can_create ) {
		return new WP_Error( 'openstation_notes_forbidden', __( 'You are not allowed to create notes.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	$text = sanitize_textarea_field( (string) $request['text'] );

	$post_id = wp_insert_post(
		array(
			'post_type'    => OPENSTATION_NOTES_POST_TYPE,
			'post_status'  => $request['public'] ? 'publish' : 'private',
			'post_author'  => get_current_user_id(),
			'post_title'   => openstation_notes_derive_title( $text ),
			'post_content' => $text,
		),
		true
	);
	if ( is_wp_error( $post_id ) ) {
		$post_id->add_data( array( 'status' => 500 ) );
		return $post_id;
	}

	update_post_meta( $post_id, '_wpd_note_color', openstation_notes_sanitize_color( $request['color'] ) );
	update_post_meta( $post_id, '_wpd_note_x', openstation_notes_sanitize_fraction( $request['x'] ) );
	update_post_meta( $post_id, '_wpd_note_y', openstation_notes_sanitize_fraction( $request['y'] ) );
	update_post_meta( $post_id, '_wpd_note_z', openstation_notes_next_z() );

	$seed = absint( $request['seed'] );
	if ( 0 === $seed ) {
		$seed = absint( crc32( $text ) ) % 2147483647;
		$seed = $seed > 0 ? $seed : 1;
	}
	update_post_meta( $post_id, '_wpd_note_seed', $seed );

	return rest_ensure_response( openstation_notes_prepare( get_post( $post_id ) ) );
}

function openstation_notes_next_z() {
	global $wpdb;
	$max = $wpdb->get_var(
		$wpdb->prepare(
			"SELECT MAX( CAST( pm.meta_value AS UNSIGNED ) )
			 FROM {$wpdb->postmeta} pm
			 INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id
			 WHERE pm.meta_key = %s AND p.post_type = %s AND p.post_status IN ( 'private', 'publish' )",
			'_wpd_note_z',
			OPENSTATION_NOTES_POST_TYPE
		)
	);
	return (int) $max + 1;
}

function openstation_notes_rest_update( $request ) {
	$post = openstation_notes_get_note( $request['id'] );
	if ( is_wp_error( $post ) ) {
		return $post;
	}
	$owner = openstation_notes_require_owner( $post );
	if ( is_wp_error( $owner ) ) {
		return $owner;
	}

	$client_ms = $request['updatedAtMs'];
	if ( null !== $client_ms && openstation_notes_modified_ms( $post ) !== (int) $client_ms ) {
		return new WP_Error(
			'openstation_notes_conflict',
			__( 'The note was changed by another session.', 'desktop-mode' ),
			array(
				'status'  => 409,
				'current' => openstation_notes_prepare( $post ),
			)
		);
	}

	$update = array( 'ID' => $post->ID );

	if ( null !== $request['text'] ) {
		$text                   = sanitize_textarea_field( (string) $request['text'] );
		$update['post_content'] = $text;
		$update['post_title']   = openstation_notes_derive_title( $text );
	}
	if ( null !== $request['public'] ) {
		$update['post_status'] = rest_sanitize_boolean( $request['public'] ) ? 'publish' : 'private';
	}

	if ( null !== $request['color'] ) {
		update_post_meta( $post->ID, '_wpd_note_color', openstation_notes_sanitize_color( $request['color'] ) );
	}
	if ( null !== $request['x'] ) {
		update_post_meta( $post->ID, '_wpd_note_x', openstation_notes_sanitize_fraction( $request['x'] ) );
	}
	if ( null !== $request['y'] ) {
		update_post_meta( $post->ID, '_wpd_note_y', openstation_notes_sanitize_fraction( $request['y'] ) );
	}
	if ( null !== $request['z'] ) {
		update_post_meta( $post->ID, '_wpd_note_z', absint( $request['z'] ) );
	}

	$result = wp_update_post( $update, true );
	if ( is_wp_error( $result ) ) {
		$result->add_data( array( 'status' => 500 ) );
		return $result;
	}

	return rest_ensure_response( openstation_notes_prepare( get_post( $post->ID ) ) );
}

function openstation_notes_rest_delete( $request ) {
	$post = openstation_notes_get_note( $request['id'] );
	if ( is_wp_error( $post ) ) {
		return $post;
	}
	$owner = openstation_notes_require_owner( $post );
	if ( is_wp_error( $owner ) ) {
		return $owner;
	}

	if ( ! wp_trash_post( $post->ID ) ) {
		return new WP_Error( 'openstation_notes_trash_failed', __( 'Could not move the note to the trash.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	return rest_ensure_response(
		array(
			'trashed' => true,
			'id'      => (int) $post->ID,
		)
	);
}

function openstation_notes_rest_restore( $request ) {
	$post = openstation_notes_get_note( $request['id'], true );
	if ( is_wp_error( $post ) ) {
		return $post;
	}
	$owner = openstation_notes_require_owner( $post );
	if ( is_wp_error( $owner ) ) {
		return $owner;
	}
	if ( 'trash' !== $post->post_status ) {
		return rest_ensure_response( openstation_notes_prepare( $post ) );
	}

	if ( ! wp_untrash_post( $post->ID ) ) {
		return new WP_Error( 'openstation_notes_restore_failed', __( 'Could not restore the note.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	$converted_post_id = (int) get_post_meta( $post->ID, '_wpd_note_converted_post', true );
	if ( $converted_post_id > 0 ) {
		delete_post_meta( $post->ID, '_wpd_note_converted_post' );
		$draft = get_post( $converted_post_id );
		if ( $draft instanceof WP_Post && 'draft' === $draft->post_status ) {
			wp_trash_post( $converted_post_id );
		}
	}

	return rest_ensure_response( openstation_notes_prepare( get_post( $post->ID ) ) );
}

function openstation_notes_text_to_blocks( $text ) {
	$text       = str_replace( array( "\r\n", "\r" ), "\n", (string) $text );
	$paragraphs = preg_split( '/\n{2,}/', trim( $text ) );
	$blocks     = array();
	foreach ( $paragraphs as $paragraph ) {
		$paragraph = trim( $paragraph, "\n" );
		if ( '' === $paragraph ) {
			continue;
		}
		$html     = nl2br( esc_html( $paragraph ), false );
		$blocks[] = "<!-- wp:paragraph -->\n<p>{$html}</p>\n<!-- /wp:paragraph -->";
	}
	return implode( "\n\n", $blocks );
}

function openstation_notes_rest_convert( $request ) {
	$post = openstation_notes_get_note( $request['id'] );
	if ( is_wp_error( $post ) ) {
		return $post;
	}
	$owner = openstation_notes_require_owner( $post );
	if ( is_wp_error( $owner ) ) {
		return $owner;
	}
	if ( ! current_user_can( 'edit_posts' ) ) {
		return new WP_Error( 'openstation_notes_cannot_create_posts', __( 'You are not allowed to create posts.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	$text  = (string) get_post_field( 'post_content', $post, 'raw' );
	$title = openstation_notes_derive_title( $text );

	$post_args = apply_filters(
		'openstation_notes_convert_post_args',
		array(
			'post_type'    => 'post',
			'post_status'  => 'draft',
			'post_author'  => (int) $post->post_author,
			'post_title'   => $title,
			'post_content' => openstation_notes_text_to_blocks( $text ),
		),
		$post,
		$request
	);

	$new_post_id = wp_insert_post( $post_args, true );
	if ( is_wp_error( $new_post_id ) ) {
		$new_post_id->add_data( array( 'status' => 500 ) );
		return $new_post_id;
	}

	update_post_meta( $post->ID, '_wpd_note_converted_post', (int) $new_post_id );
	if ( ! wp_trash_post( $post->ID ) ) {
		wp_delete_post( $new_post_id, true );
		delete_post_meta( $post->ID, '_wpd_note_converted_post' );
		return new WP_Error( 'openstation_notes_convert_failed', __( 'Could not convert the note to a post.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	do_action( 'openstation_notes_converted', (int) $new_post_id, $post, $request );

	return rest_ensure_response(
		array(
			'noteId'  => (int) $post->ID,
			'postId'  => (int) $new_post_id,
			'editUrl' => openstation_notes_draft_edit_url( (int) $new_post_id ),
		)
	);
}

function openstation_notes_draft_edit_url( $post_id ) {
	$draft = get_post( $post_id );
	if ( ! $draft instanceof WP_Post ) {
		return '';
	}
	$type_object = get_post_type_object( $draft->post_type );
	$edit_link   = $type_object && ! empty( $type_object->_edit_link ) ? $type_object->_edit_link : 'post.php?post=%d';
	return admin_url( sprintf( $edit_link, $draft->ID ) . '&action=edit' );
}

function openstation_notes_user_has_any() {
	$rev     = (string) get_option( 'desktop_mode_notes_rev', '0' );
	$user_id = get_current_user_id();
	$cached  = (string) get_user_meta( $user_id, '_desktop_mode_has_notes', true );
	if ( '' !== $cached ) {
		list( $cached_rev, $cached_value ) = array_pad( explode( ':', $cached, 2 ), 2, '' );
		if ( $cached_rev === $rev ) {
			return '1' === $cached_value;
		}
	}

	$public = new WP_Query(
		array(
			'post_type'      => OPENSTATION_NOTES_POST_TYPE,
			'post_status'    => 'publish',
			'posts_per_page' => 1,
			'fields'         => 'ids',
			'no_found_rows'  => true,
		)
	);
	$has = (bool) $public->posts;
	if ( ! $has ) {
		$own = new WP_Query(
			array(
				'post_type'      => OPENSTATION_NOTES_POST_TYPE,
				'post_status'    => 'private',
				'author'         => $user_id,
				'posts_per_page' => 1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
			)
		);
		$has = (bool) $own->posts;
	}

	update_user_meta( $user_id, '_desktop_mode_has_notes', $rev . ':' . ( $has ? '1' : '0' ) );
	return $has;
}

function openstation_notes_bump_rev( $post ) {
	$post = get_post( $post );
	if ( ! $post instanceof WP_Post || OPENSTATION_NOTES_POST_TYPE !== $post->post_type ) {
		return;
	}
	update_option( 'desktop_mode_notes_rev', (string) time() . '.' . wp_rand( 0, 999 ), true );
}

function openstation_notes_bump_rev_on_transition( $new_status, $old_status, $post ) {
	if ( $new_status === $old_status ) {
		return;
	}
	openstation_notes_bump_rev( $post );
}
add_action( 'transition_post_status', 'openstation_notes_bump_rev_on_transition', 10, 3 );
add_action( 'deleted_post', 'openstation_notes_bump_rev' );
