<?php
/**
 * Desktop Mode — Pinned notes REST routes.
 *
 * Routes under `/desktop-mode/v1/notes`:
 *
 *   GET    /notes                     List the viewer's own notes
 *                                     (private + publish) plus every
 *                                     other user's public notes.
 *   POST   /notes                     Create a note (author = viewer).
 *   PATCH  /notes/(?P<id>\d+)         Partial update — owner only.
 *   DELETE /notes/(?P<id>\d+)         Soft-trash — owner only.
 *   POST   /notes/(?P<id>\d+)/restore Untrash (Undo toast) — owner only.
 *   POST   /notes/(?P<id>\d+)/convert Spawn a draft post from the note,
 *                                     then trash the note — owner only,
 *                                     requires the `edit_posts` cap.
 *
 * Ownership model: a note belongs to its `post_author`, and ONLY the
 * owner may mutate it — deliberately including administrators. Public
 * notes are a read-only broadcast surface; "manage other users'
 * notes" is not a supported operation through this controller.
 *
 * Optimistic concurrency: PATCH accepts an `updatedAtMs` field
 * carrying the client's last-seen modified timestamp; a mismatch
 * returns 409 `desktop_mode_notes_conflict` with the server copy in
 * `data.current` so the client can re-render instead of clobbering.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Base permission: logged-in + desktop mode enabled.
 *
 * @return true|WP_Error
 */
function desktop_mode_notes_rest_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error( 'desktop_mode_notes_unauthenticated', __( 'You must be logged in.', 'desktop-mode' ), array( 'status' => 401 ) );
	}
	if ( function_exists( 'desktop_mode_is_enabled' ) && ! desktop_mode_is_enabled( get_current_user_id() ) ) {
		return new WP_Error( 'desktop_mode_notes_disabled', __( 'Desktop mode is not enabled for this user.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	return true;
}

/**
 * Register the routes.
 */
function desktop_mode_notes_register_rest_routes() {
	$ns = 'desktop-mode/v1';

	register_rest_route(
		$ns,
		'/notes',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'desktop_mode_notes_rest_permission',
				'callback'            => 'desktop_mode_notes_rest_list',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'desktop_mode_notes_rest_permission',
				'callback'            => 'desktop_mode_notes_rest_create',
				'args'                => array(
					'text'   => array(
						'type'              => 'string',
						'default'           => '',
						'sanitize_callback' => 'sanitize_textarea_field',
					),
					'color'  => array(
						'type'              => 'string',
						'default'           => 'butter',
						'sanitize_callback' => 'desktop_mode_notes_sanitize_color',
					),
					'x'      => array( 'type' => 'number', 'default' => 0.1 ),
					'y'      => array( 'type' => 'number', 'default' => 0.1 ),
					'public' => array( 'type' => 'boolean', 'default' => false ),
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
				'permission_callback' => 'desktop_mode_notes_rest_permission',
				'callback'            => 'desktop_mode_notes_rest_update',
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'permission_callback' => 'desktop_mode_notes_rest_permission',
				'callback'            => 'desktop_mode_notes_rest_delete',
			),
		)
	);

	register_rest_route(
		$ns,
		'/notes/(?P<id>\d+)/restore',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'desktop_mode_notes_rest_permission',
			'callback'            => 'desktop_mode_notes_rest_restore',
		)
	);

	register_rest_route(
		$ns,
		'/notes/(?P<id>\d+)/convert',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'desktop_mode_notes_rest_permission',
			'callback'            => 'desktop_mode_notes_rest_convert',
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_notes_register_rest_routes' );

/**
 * Fetch a note post, or a WP_Error when it doesn't exist / isn't a note.
 *
 * @param int  $id          Post ID.
 * @param bool $allow_trash Whether a trashed note is acceptable (restore path).
 * @return WP_Post|WP_Error
 */
function desktop_mode_notes_get_note( $id, $allow_trash = false ) {
	$post = get_post( (int) $id );
	if ( ! $post instanceof WP_Post || DESKTOP_MODE_NOTES_POST_TYPE !== $post->post_type ) {
		return new WP_Error( 'desktop_mode_notes_not_found', __( 'Note not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	$allowed = $allow_trash ? array( 'private', 'publish', 'trash' ) : array( 'private', 'publish' );
	if ( ! in_array( $post->post_status, $allowed, true ) ) {
		return new WP_Error( 'desktop_mode_notes_not_found', __( 'Note not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	return $post;
}

/**
 * Owner gate. Only the note's author may mutate it — including admins.
 *
 * Returning 404 (not 403) for other users' PRIVATE notes would leak
 * less, but the id namespace is shared with public notes anyway and
 * a mutation attempt on a visible public note deserves an honest 403.
 *
 * @param WP_Post $post Note post.
 * @return true|WP_Error
 */
function desktop_mode_notes_require_owner( $post ) {
	if ( (int) $post->post_author !== get_current_user_id() ) {
		return new WP_Error( 'desktop_mode_notes_forbidden', __( 'Only the note owner can change it.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	return true;
}

/**
 * Modified timestamp in milliseconds (GMT).
 *
 * Second precision (WordPress stores no sub-second post dates) — the
 * client treats the value as an opaque token and echoes it back.
 *
 * @param WP_Post $post Post.
 * @return int
 */
function desktop_mode_notes_modified_ms( $post ) {
	return (int) get_post_modified_time( 'U', true, $post ) * 1000;
}

/**
 * Serialize a note for the wire.
 *
 * @param WP_Post $post Note post.
 * @return array
 */
function desktop_mode_notes_prepare( $post ) {
	$owner_id = (int) $post->post_author;
	$owner    = get_userdata( $owner_id );

	return array(
		'id'          => (int) $post->ID,
		'text'        => (string) get_post_field( 'post_content', $post, 'raw' ),
		'color'       => desktop_mode_notes_sanitize_color( get_post_meta( $post->ID, '_wpd_note_color', true ) ),
		'x'           => desktop_mode_notes_sanitize_fraction( get_post_meta( $post->ID, '_wpd_note_x', true ) ),
		'y'           => desktop_mode_notes_sanitize_fraction( get_post_meta( $post->ID, '_wpd_note_y', true ) ),
		'z'           => (int) get_post_meta( $post->ID, '_wpd_note_z', true ),
		'public'      => 'publish' === $post->post_status,
		'seed'        => (int) get_post_meta( $post->ID, '_wpd_note_seed', true ),
		'ownerId'     => $owner_id,
		'ownerName'   => $owner instanceof WP_User ? (string) $owner->display_name : '',
		'ownerAvatar' => (string) get_avatar_url( $owner_id, array( 'size' => 48 ) ),
		'canEdit'     => get_current_user_id() === $owner_id,
		'updatedAtMs' => desktop_mode_notes_modified_ms( $post ),
	);
}

/**
 * Derive the post title from the note text (first non-empty line).
 *
 * Only used for admin-side lists / exports — the shell never shows it.
 *
 * @param string $text Note text.
 * @return string
 */
function desktop_mode_notes_derive_title( $text ) {
	foreach ( preg_split( '/\r\n|\r|\n/', (string) $text ) as $line ) {
		$line = trim( $line );
		if ( '' !== $line ) {
			return mb_substr( sanitize_text_field( $line ), 0, 80 );
		}
	}
	return __( 'Note', 'desktop-mode' );
}

/**
 * GET /notes — own notes (private + publish) ∪ others' publish.
 *
 * @return WP_REST_Response
 */
function desktop_mode_notes_rest_list() {
	$user_id = get_current_user_id();

	// Newest first: the per-half cap exists as a runaway guard, and
	// when it ever bites it must drop the OLDEST notes — capping an
	// ascending list would silently hide every recently pinned note
	// (and the boot high-water would stop the Heartbeat delta from
	// ever backfilling them).
	$own = new WP_Query(
		array(
			'post_type'      => DESKTOP_MODE_NOTES_POST_TYPE,
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
			'post_type'      => DESKTOP_MODE_NOTES_POST_TYPE,
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
		$notes[] = desktop_mode_notes_prepare( $post );
	}
	wp_reset_postdata();

	return rest_ensure_response( array( 'notes' => $notes ) );
}

/**
 * POST /notes.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_notes_rest_create( $request ) {
	/**
	 * Filters whether the current user may create a note.
	 *
	 * Notes default to any logged-in desktop-mode user — including
	 * publishing PUBLIC notes onto every other user's wallpaper.
	 * Sites that want to restrict that (by role, capability, or the
	 * request's `public` flag) hook here.
	 *
	 * @param bool            $can_create Whether creation is allowed. Default true.
	 * @param int             $user_id    Current user id.
	 * @param WP_REST_Request $request    The create request (inspect `public`, `text`, ...).
	 */
	$can_create = apply_filters( 'desktop_mode_notes_user_can_create', true, get_current_user_id(), $request );
	if ( ! $can_create ) {
		return new WP_Error( 'desktop_mode_notes_forbidden', __( 'You are not allowed to create notes.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	$text = sanitize_textarea_field( (string) $request['text'] );

	$post_id = wp_insert_post(
		array(
			'post_type'    => DESKTOP_MODE_NOTES_POST_TYPE,
			'post_status'  => $request['public'] ? 'publish' : 'private',
			'post_author'  => get_current_user_id(),
			'post_title'   => desktop_mode_notes_derive_title( $text ),
			'post_content' => $text,
		),
		true
	);
	if ( is_wp_error( $post_id ) ) {
		$post_id->add_data( array( 'status' => 500 ) );
		return $post_id;
	}

	update_post_meta( $post_id, '_wpd_note_color', desktop_mode_notes_sanitize_color( $request['color'] ) );
	update_post_meta( $post_id, '_wpd_note_x', desktop_mode_notes_sanitize_fraction( $request['x'] ) );
	update_post_meta( $post_id, '_wpd_note_y', desktop_mode_notes_sanitize_fraction( $request['y'] ) );
	update_post_meta( $post_id, '_wpd_note_z', desktop_mode_notes_next_z() );
	// The jitter seed is written ONCE, here — PATCH never touches it,
	// so editing a note's text never re-tilts its paper. The client
	// sends its own text hash (keeps the optimistic render identical);
	// fall back to a server-side hash when absent.
	$seed = absint( $request['seed'] );
	if ( 0 === $seed ) {
		$seed = absint( crc32( $text ) ) % 2147483647;
		$seed = $seed > 0 ? $seed : 1;
	}
	update_post_meta( $post_id, '_wpd_note_seed', $seed );

	return rest_ensure_response( desktop_mode_notes_prepare( get_post( $post_id ) ) );
}

/**
 * Next z-order value across all live (non-trashed) notes.
 *
 * Deliberately site-wide, not per-owner: public notes from different
 * owners stack on the same wall, so a fresh note must land above
 * everyone's papers. Cheap max-of-meta walk — note counts are tiny
 * (a wall of paper, not a database of record).
 *
 * @return int
 */
function desktop_mode_notes_next_z() {
	global $wpdb;
	$max = $wpdb->get_var(
		$wpdb->prepare(
			"SELECT MAX( CAST( pm.meta_value AS UNSIGNED ) )
			 FROM {$wpdb->postmeta} pm
			 INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id
			 WHERE pm.meta_key = %s AND p.post_type = %s AND p.post_status IN ( 'private', 'publish' )",
			'_wpd_note_z',
			DESKTOP_MODE_NOTES_POST_TYPE
		)
	);
	return (int) $max + 1;
}

/**
 * PATCH /notes/:id — partial update, owner only.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_notes_rest_update( $request ) {
	$post = desktop_mode_notes_get_note( $request['id'] );
	if ( is_wp_error( $post ) ) {
		return $post;
	}
	$owner = desktop_mode_notes_require_owner( $post );
	if ( is_wp_error( $owner ) ) {
		return $owner;
	}

	// Optimistic concurrency — a stale token means another session
	// (or device) changed the note since this client last saw it.
	$client_ms = $request['updatedAtMs'];
	if ( null !== $client_ms && (int) $client_ms !== desktop_mode_notes_modified_ms( $post ) ) {
		return new WP_Error(
			'desktop_mode_notes_conflict',
			__( 'The note was changed by another session.', 'desktop-mode' ),
			array(
				'status'  => 409,
				'current' => desktop_mode_notes_prepare( $post ),
			)
		);
	}

	$update = array( 'ID' => $post->ID );

	if ( null !== $request['text'] ) {
		$text                   = sanitize_textarea_field( (string) $request['text'] );
		$update['post_content'] = $text;
		$update['post_title']   = desktop_mode_notes_derive_title( $text );
	}
	if ( null !== $request['public'] ) {
		$update['post_status'] = rest_sanitize_boolean( $request['public'] ) ? 'publish' : 'private';
	}

	if ( null !== $request['color'] ) {
		update_post_meta( $post->ID, '_wpd_note_color', desktop_mode_notes_sanitize_color( $request['color'] ) );
	}
	if ( null !== $request['x'] ) {
		update_post_meta( $post->ID, '_wpd_note_x', desktop_mode_notes_sanitize_fraction( $request['x'] ) );
	}
	if ( null !== $request['y'] ) {
		update_post_meta( $post->ID, '_wpd_note_y', desktop_mode_notes_sanitize_fraction( $request['y'] ) );
	}
	if ( null !== $request['z'] ) {
		update_post_meta( $post->ID, '_wpd_note_z', absint( $request['z'] ) );
	}

	// Always run the post update — even a meta-only PATCH must bump
	// `post_modified` so the concurrency token advances and the
	// Heartbeat delta query sees the move.
	$result = wp_update_post( $update, true );
	if ( is_wp_error( $result ) ) {
		$result->add_data( array( 'status' => 500 ) );
		return $result;
	}

	return rest_ensure_response( desktop_mode_notes_prepare( get_post( $post->ID ) ) );
}

/**
 * DELETE /notes/:id — soft-trash, owner only.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_notes_rest_delete( $request ) {
	$post = desktop_mode_notes_get_note( $request['id'] );
	if ( is_wp_error( $post ) ) {
		return $post;
	}
	$owner = desktop_mode_notes_require_owner( $post );
	if ( is_wp_error( $owner ) ) {
		return $owner;
	}

	if ( ! wp_trash_post( $post->ID ) ) {
		return new WP_Error( 'desktop_mode_notes_trash_failed', __( 'Could not move the note to the trash.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	return rest_ensure_response( array( 'trashed' => true, 'id' => (int) $post->ID ) );
}

/**
 * POST /notes/:id/restore — untrash (Undo), owner only.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_notes_rest_restore( $request ) {
	$post = desktop_mode_notes_get_note( $request['id'], true );
	if ( is_wp_error( $post ) ) {
		return $post;
	}
	$owner = desktop_mode_notes_require_owner( $post );
	if ( is_wp_error( $owner ) ) {
		return $owner;
	}
	if ( 'trash' !== $post->post_status ) {
		return rest_ensure_response( desktop_mode_notes_prepare( $post ) );
	}

	if ( ! wp_untrash_post( $post->ID ) ) {
		return new WP_Error( 'desktop_mode_notes_restore_failed', __( 'Could not restore the note.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	// If this note was trashed by a "convert to post" action, undoing
	// the conversion must also discard the draft it spawned — otherwise
	// Undo would leave the note back on the wall AND a stray draft. The
	// link is written by the convert route (`_wpd_note_converted_post`)
	// and consumed once here. Only a still-present draft is trashed; a
	// draft the user already published or trashed themselves is left be.
	$converted_post_id = (int) get_post_meta( $post->ID, '_wpd_note_converted_post', true );
	if ( $converted_post_id > 0 ) {
		delete_post_meta( $post->ID, '_wpd_note_converted_post' );
		$draft = get_post( $converted_post_id );
		if ( $draft instanceof WP_Post && 'draft' === $draft->post_status ) {
			wp_trash_post( $converted_post_id );
		}
	}

	return rest_ensure_response( desktop_mode_notes_prepare( get_post( $post->ID ) ) );
}

/**
 * Convert a note's plain text into Gutenberg paragraph-block markup.
 *
 * Blank lines split paragraphs; single newlines within a paragraph
 * become `<br>`. The result lands clean in the block editor rather
 * than as one classic-HTML blob.
 *
 * @param string $text Note text.
 * @return string Serialized block markup (empty string for empty text).
 */
function desktop_mode_notes_text_to_blocks( $text ) {
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

/**
 * POST /notes/:id/convert — spawn a draft post from a note, then trash
 * the note. Owner only, and the owner must be able to author posts.
 *
 * The note is trashed (not hard-deleted) and linked to its new draft
 * via `_wpd_note_converted_post` so the standard restore route can undo
 * both sides of the conversion (see `desktop_mode_notes_rest_restore`).
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_notes_rest_convert( $request ) {
	$post = desktop_mode_notes_get_note( $request['id'] );
	if ( is_wp_error( $post ) ) {
		return $post;
	}
	$owner = desktop_mode_notes_require_owner( $post );
	if ( is_wp_error( $owner ) ) {
		return $owner;
	}
	if ( ! current_user_can( 'edit_posts' ) ) {
		return new WP_Error( 'desktop_mode_notes_cannot_create_posts', __( 'You are not allowed to create posts.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	$text  = (string) get_post_field( 'post_content', $post, 'raw' );
	$title = desktop_mode_notes_derive_title( $text );

	/**
	 * Filters the arguments used to create the draft post from a note.
	 *
	 * Hook here to change the post type/status, assign a category or
	 * author, or wrap the body in different block markup.
	 *
	 * @param array           $post_args Args passed to `wp_insert_post()`.
	 * @param WP_Post         $post      The source note.
	 * @param WP_REST_Request $request   The convert request.
	 */
	$post_args = apply_filters(
		'desktop_mode_notes_convert_post_args',
		array(
			'post_type'    => 'post',
			'post_status'  => 'draft',
			'post_author'  => (int) $post->post_author,
			'post_title'   => $title,
			'post_content' => desktop_mode_notes_text_to_blocks( $text ),
		),
		$post,
		$request
	);

	$new_post_id = wp_insert_post( $post_args, true );
	if ( is_wp_error( $new_post_id ) ) {
		$new_post_id->add_data( array( 'status' => 500 ) );
		return $new_post_id;
	}

	// Link the note to its draft BEFORE trashing so restore can reverse
	// both sides. If the trash fails, roll the draft back so a failed
	// conversion never leaves an orphan draft behind.
	update_post_meta( $post->ID, '_wpd_note_converted_post', (int) $new_post_id );
	if ( ! wp_trash_post( $post->ID ) ) {
		wp_delete_post( $new_post_id, true );
		delete_post_meta( $post->ID, '_wpd_note_converted_post' );
		return new WP_Error( 'desktop_mode_notes_convert_failed', __( 'Could not convert the note to a post.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	/**
	 * Fires after a note has been converted to a draft post.
	 *
	 * @param int             $new_post_id The draft post id.
	 * @param WP_Post         $post        The source note (now trashed).
	 * @param WP_REST_Request $request     The convert request.
	 */
	do_action( 'desktop_mode_notes_converted', (int) $new_post_id, $post, $request );

	return rest_ensure_response(
		array(
			'noteId'  => (int) $post->ID,
			'postId'  => (int) $new_post_id,
			'editUrl' => (string) get_edit_post_link( $new_post_id, 'raw' ),
		)
	);
}
