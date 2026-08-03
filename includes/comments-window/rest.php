<?php
/**
 * OpenStation — Native Comments Window: REST mutation + helper routes.
 *
 * Four endpoints under `desktop-mode/v1`:
 *
 *   - POST   /comments/bulk            { ids: int[], action: 'approve'|'unapprove'|'spam'|'unspam'|'trash'|'untrash' }
 *   - POST   /comments/reply           { parent: int, content: string }
 *   - GET    /comments/insights/<email>
 *   - GET    /comments/counts
 *
 * SECURITY POSTURE
 * ================
 *
 *   1. `permission_callback` — broad cap gate
 *      (`moderate_comments`, `edit_posts`).
 *   2. Per-target re-validation inside the callback —
 *      `current_user_can( 'edit_comment', $id )` per row.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Allowed bulk actions, mapped to the function that performs them on a single id.
 *
 * Each callback returns true on success, false on a soft failure (the
 * row is skipped) and throws nothing — the bulk endpoint logs misses
 * but never aborts the batch on a single bad row.
 *
 * @return array<string,callable>
 */
function openstation_comments_window_bulk_action_map() {
	return array(
		'approve'   => static function ( $id ) {
			return false !== wp_set_comment_status( $id, 'approve' );
		},
		'unapprove' => static function ( $id ) {
			return false !== wp_set_comment_status( $id, 'hold' );
		},
		'spam'      => static function ( $id ) {
			return false !== wp_spam_comment( $id );
		},
		'unspam'    => static function ( $id ) {
			return false !== wp_unspam_comment( $id );
		},
		'trash'     => static function ( $id ) {
			return false !== wp_trash_comment( $id );
		},
		'untrash'   => static function ( $id ) {
			return false !== wp_untrash_comment( $id );
		},
	);
}

/**
 * Register all routes.
 */
function openstation_comments_window_register_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/comments/bulk',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_comments_window_rest_bulk',
			'permission_callback' => static function () {
				return current_user_can( 'moderate_comments' );
			},
			'args'                => array(
				'ids'    => array(
					'required' => true,
					'type'     => 'array',
					'items'    => array( 'type' => 'integer' ),
				),
				'action' => array(
					'required' => true,
					'type'     => 'string',
					'enum'     => array_keys( openstation_comments_window_bulk_action_map() ),
				),
			),
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/comments/reply',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_comments_window_rest_reply',
			'permission_callback' => static function () {
				return current_user_can( 'edit_posts' );
			},
			'args'                => array(
				'parent'  => array(
					'required' => true,
					'type'     => 'integer',
				),
				'content' => array(
					'required' => true,
					'type'     => 'string',
				),
			),
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/comments/insights/(?P<email>[^/]+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_comments_window_rest_insights',
			'permission_callback' => static function () {
				return current_user_can( 'moderate_comments' );
			},
			'args'                => array(
				'email' => array(
					'required' => true,
					'type'     => 'string',
				),
			),
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/comments/counts',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_comments_window_rest_counts',
			'permission_callback' => static function () {
				return current_user_can( 'edit_posts' );
			},
		)
	);
}
add_action( 'rest_api_init', 'openstation_comments_window_register_rest_routes' );

/**
 * Bulk moderation handler.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_comments_window_rest_bulk( WP_REST_Request $request ) {
	$ids    = array_values( array_filter( array_map( 'intval', (array) $request['ids'] ) ) );
	$action = (string) $request['action'];
	$map    = openstation_comments_window_bulk_action_map();

	if ( ! isset( $map[ $action ] ) ) {
		return new WP_Error(
			'openstation_comments_invalid_action',
			__( 'Unknown bulk action.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$cb        = $map[ $action ];
	$processed = array();
	$skipped   = array();

	foreach ( $ids as $id ) {
		if ( ! current_user_can( 'edit_comment', $id ) ) {
			$skipped[] = $id;
			continue;
		}
		if ( $cb( $id ) ) {
			$processed[] = $id;
		} else {
			$skipped[] = $id;
		}
	}

	/**
	 * Fires after a Comments-window bulk action runs.
	 *
	 * @param string $action    Action slug.
	 * @param int[]  $processed Ids successfully acted on.
	 * @param int[]  $skipped   Ids skipped (cap fail or soft error).
	 */
	do_action(
		'openstation_comments_window_after_bulk',
		$action,
		$processed,
		$skipped
	);

	return new WP_REST_Response(
		array(
			'action'    => $action,
			'processed' => $processed,
			'skipped'   => $skipped,
			'counts'    => openstation_comments_window_counts(),
		),
		200
	);
}

/**
 * Inline-reply handler. Wraps `wp_new_comment` with sane defaults so
 * the client only needs `{ parent, content }`.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_comments_window_rest_reply( WP_REST_Request $request ) {
	$parent_id = (int) $request['parent'];
	$content   = (string) $request['content'];

	$parent = get_comment( $parent_id );
	if ( ! $parent instanceof WP_Comment ) {
		return new WP_Error(
			'openstation_comments_no_parent',
			__( 'Parent comment not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	// Per-target re-validation: mirror core's wp_ajax_replyto_comment gate,
	// which requires edit_post on the comment's post.
	$post = get_post( (int) $parent->comment_post_ID );
	if ( ! $post instanceof WP_Post || ! current_user_can( 'edit_post', $post->ID ) ) {
		return new WP_Error(
			'openstation_comments_forbidden',
			__( 'You are not allowed to reply to comments on this post.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	if ( '' === trim( wp_strip_all_tags( $content ) ) ) {
		return new WP_Error(
			'openstation_comments_empty_reply',
			__( 'Reply cannot be empty.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$user = wp_get_current_user();
	if ( ! $user || ! $user->ID ) {
		return new WP_Error(
			'openstation_comments_unauthenticated',
			__( 'You must be logged in to reply.', 'desktop-mode' ),
			array( 'status' => 401 )
		);
	}

	$comment_data = array(
		'comment_post_ID'      => (int) $parent->comment_post_ID,
		'comment_parent'       => $parent_id,
		'user_id'              => (int) $user->ID,
		'comment_author'       => (string) $user->display_name,
		'comment_author_email' => (string) $user->user_email,
		'comment_author_url'   => (string) $user->user_url,
		'comment_content'      => $content,
		'comment_approved'     => 1,
		'comment_type'         => 'comment',
	);

	$new_id = wp_new_comment( wp_slash( $comment_data ), true );
	if ( is_wp_error( $new_id ) ) {
		return $new_id;
	}

	$new = get_comment( $new_id );
	return new WP_REST_Response(
		array(
			'id'        => (int) $new_id,
			'parent'    => $parent_id,
			'content'   => $new ? (string) $new->comment_content : $content,
			'date_gmt'  => $new ? (string) $new->comment_date_gmt : '',
			'author'    => $user->display_name,
			'avatarUrl' => (string) get_avatar_url( (int) $user->ID, array( 'size' => 96 ) ),
		),
		201
	);
}

/**
 * Author insights endpoint — drives the side drawer.
 *
 * Returns total/approved/pending/spam counts, oldest/newest comment
 * timestamps, the linked user id (if the email matches a registered
 * user), and a 0–100 reliability score.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_comments_window_rest_insights( WP_REST_Request $request ) {
	$email = strtolower( urldecode( (string) $request['email'] ) );
	if ( '' === $email || ! is_email( $email ) ) {
		return new WP_Error(
			'openstation_comments_invalid_email',
			__( 'Invalid author email.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$counts_by_status = array();
	foreach ( array( 'approve', 'hold', 'spam', 'trash' ) as $status ) {
		$counts_by_status[ $status ] = (int) get_comments(
			array(
				'author_email' => $email,
				'status'       => $status,
				'count'        => true,
			)
		);
	}
	$total = array_sum( $counts_by_status );

	// Sample the oldest + newest record without loading every row.
	$oldest = get_comments(
		array(
			'author_email' => $email,
			'status'       => 'all',
			'orderby'      => 'comment_date_gmt',
			'order'        => 'ASC',
			'number'       => 1,
		)
	);
	$newest = get_comments(
		array(
			'author_email' => $email,
			'status'       => 'all',
			'orderby'      => 'comment_date_gmt',
			'order'        => 'DESC',
			'number'       => 1,
		)
	);

	$user           = get_user_by( 'email', $email );
	$reliability    = 100;
	if ( $total > 0 ) {
		$bad         = $counts_by_status['spam'] + $counts_by_status['trash'];
		$reliability = (int) round( max( 0, min( 100, 100 - ( $bad / $total ) * 100 ) ) );
	}

	return new WP_REST_Response(
		array(
			'email'       => $email,
			'total'       => $total,
			'counts'      => $counts_by_status,
			'oldest'      => isset( $oldest[0] ) ? (string) $oldest[0]->comment_date_gmt : null,
			'newest'      => isset( $newest[0] ) ? (string) $newest[0]->comment_date_gmt : null,
			'userId'      => $user ? (int) $user->ID : 0,
			'userName'    => $user ? (string) $user->display_name : '',
			'reliability' => $reliability,
			'avatarUrl'   => (string) get_avatar_url( $email, array( 'size' => 96 ) ),
		),
		200
	);
}

/**
 * Per-status counts. Used by the dock badge + the "N new" pill.
 *
 * @return WP_REST_Response
 */
function openstation_comments_window_rest_counts() {
	return new WP_REST_Response( openstation_comments_window_counts(), 200 );
}

/**
 * Internal helper — current comment counts as a flat array.
 *
 * @return array<string,int>
 */
function openstation_comments_window_counts() {
	$counts = wp_count_comments();
	return array(
		'pending'  => (int) $counts->moderated,
		'approved' => (int) $counts->approved,
		'spam'     => (int) $counts->spam,
		'trash'    => (int) $counts->trash,
		'total'    => (int) $counts->total_comments,
	);
}
