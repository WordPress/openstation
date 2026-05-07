<?php
/**
 * Desktop Mode — My WordPress: per-comment dossier endpoint.
 *
 * `GET /desktop-mode/v1/comment-stats/<id>` returns the rendered
 * comment + author + parent post + thread context + reply tree +
 * a count of how active the author has been across the site. Powers
 * the right preview pane in the My WordPress folder when a comment
 * is selected.
 *
 * Permissions:
 *   - The comment must be readable by the current user (approved,
 *     OR the user can `moderate_comments`, OR they're the comment
 *     author).
 *   - Author email / IP / user-agent only ship to viewers with
 *     `moderate_comments`.
 *
 * @package WPDesktopMode
 * @since   0.8.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the route.
 *
 * @since 0.8.0
 */
function desktop_mode_my_wordpress_register_comment_stats_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/comment-stats/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'desktop_mode_my_wordpress_comment_stats_callback',
			'permission_callback' => static function () {
				return is_user_logged_in();
			},
			'args'                => array(
				'id' => array(
					'required'          => true,
					'type'              => 'integer',
					'sanitize_callback' => 'absint',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_my_wordpress_register_comment_stats_route' );

/**
 * Aggregator callback.
 *
 * @since 0.8.0
 *
 * @param WP_REST_Request $request REST request.
 * @return array|WP_Error
 */
function desktop_mode_my_wordpress_comment_stats_callback( $request ) {
	global $wpdb;
	$comment_id = (int) $request->get_param( 'id' );
	$comment    = get_comment( $comment_id );
	if ( ! $comment ) {
		return new WP_Error(
			'desktop_mode_comment_not_found',
			__( 'Comment not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$can_moderate = current_user_can( 'moderate_comments' );
	$is_approved  = '1' === (string) $comment->comment_approved;
	$is_self      = is_user_logged_in()
		&& (int) get_current_user_id() === (int) $comment->user_id
		&& (int) $comment->user_id > 0;

	if ( ! $is_approved && ! $can_moderate && ! $is_self ) {
		return new WP_Error(
			'desktop_mode_comment_forbidden',
			__( 'You do not have permission to view this comment.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	// ----- Comment body ------------------------------------------------
	$content_filtered = apply_filters( 'comment_text', $comment->comment_content, $comment, array() );
	$body             = array(
		'id'          => (int) $comment->comment_ID,
		'parent'      => (int) $comment->comment_parent,
		'date'        => mysql2date( 'c', $comment->comment_date_gmt, false ),
		'status'      => $is_approved
			? 'approved'
			: ( '0' === (string) $comment->comment_approved
				? 'pending'
				: (string) $comment->comment_approved ),
		'rendered'    => (string) $content_filtered,
		'rendered_raw' => (string) $comment->comment_content,
		'editLink'    => $can_moderate
			? esc_url_raw(
				admin_url(
					'comment.php?action=editcomment&c=' . $comment->comment_ID
				)
			)
			: '',
	);
	if ( $can_moderate ) {
		$body['type']      = (string) $comment->comment_type;
		$body['ip']        = (string) $comment->comment_author_IP;
		$body['userAgent'] = (string) $comment->comment_agent;
		$body['karma']     = (int) $comment->comment_karma;
	}

	// ----- Author ------------------------------------------------------
	$author = array(
		'name'      => (string) $comment->comment_author,
		'url'       => esc_url_raw( (string) $comment->comment_author_url ),
		'avatarUrl' => (string) get_avatar_url(
			$comment,
			array( 'size' => 96 )
		),
		'userId'    => (int) $comment->user_id,
	);
	if ( $can_moderate ) {
		$author['email'] = (string) $comment->comment_author_email;
	}
	if ( $author['userId'] > 0 ) {
		$user = get_userdata( $author['userId'] );
		if ( $user ) {
			$author['displayName']  = $user->display_name;
			$author['profileLink']  = get_author_posts_url( $user->ID );
		}
	}

	// ----- Parent post -------------------------------------------------
	$post = get_post( (int) $comment->comment_post_ID );
	$post_payload = null;
	if ( $post ) {
		$post_author = $post->post_author > 0
			? get_userdata( (int) $post->post_author )
			: null;
		$post_payload = array(
			'id'     => (int) $post->ID,
			'title'  => get_the_title( $post ),
			'link'   => (string) get_permalink( $post ),
			'editLink' => current_user_can( 'edit_post', $post->ID )
				? (string) get_edit_post_link( $post->ID, 'raw' )
				: '',
			'status' => (string) $post->post_status,
			'type'   => (string) $post->post_type,
			'date'   => mysql2date( 'c', $post->post_date_gmt, false ),
			'author' => $post_author
				? array(
					'id'        => (int) $post_author->ID,
					'name'      => $post_author->display_name,
					'avatarUrl' => (string) get_avatar_url(
						$post_author->ID,
						array( 'size' => 48 )
					),
				)
				: null,
		);
	}

	// ----- Parent comment (if this is a reply) -------------------------
	$parent_payload = null;
	if ( (int) $comment->comment_parent > 0 ) {
		$parent_comment = get_comment( (int) $comment->comment_parent );
		if ( $parent_comment ) {
			$parent_payload = array(
				'id'        => (int) $parent_comment->comment_ID,
				'authorName' => (string) $parent_comment->comment_author,
				'date'      => mysql2date( 'c', $parent_comment->comment_date_gmt, false ),
				'excerpt'   => wp_trim_words(
					wp_strip_all_tags( $parent_comment->comment_content ),
					40
				),
			);
		}
	}

	// ----- Replies (direct children) -----------------------------------
	$reply_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT comment_ID, comment_author, comment_author_email,
				comment_date_gmt, comment_content, comment_approved, user_id
			FROM {$wpdb->comments}
			WHERE comment_parent = %d
				AND ( comment_approved = '1' %s )
			ORDER BY comment_date_gmt ASC
			LIMIT 20",
			$comment->comment_ID,
			$can_moderate ? "OR comment_approved = '0'" : ''
		),
		ARRAY_A
	);
	$replies = array();
	foreach ( (array) $reply_rows as $row ) {
		$replies[] = array(
			'id'         => (int) $row['comment_ID'],
			'authorName' => (string) $row['comment_author'],
			'avatarUrl'  => (string) get_avatar_url(
				$row['comment_author_email'],
				array( 'size' => 32 )
			),
			'date'       => mysql2date( 'c', (string) $row['comment_date_gmt'], false ),
			'excerpt'    => wp_trim_words(
				wp_strip_all_tags( (string) $row['comment_content'] ),
				40
			),
			'status'     => '1' === (string) $row['comment_approved']
				? 'approved'
				: (string) $row['comment_approved'],
		);
	}

	// ----- Author activity --------------------------------------------
	// "How busy is this commenter site-wide?" — total approved
	// comments by this email (or user_id when logged in).
	$author_total = 0;
	if ( $author['userId'] > 0 ) {
		$author_total = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$wpdb->comments}
				WHERE user_id = %d AND comment_approved = '1'",
				$author['userId']
			)
		);
	} elseif ( ! empty( $comment->comment_author_email ) ) {
		$author_total = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$wpdb->comments}
				WHERE comment_author_email = %s AND comment_approved = '1'",
				(string) $comment->comment_author_email
			)
		);
	}
	$author['totalApprovedComments'] = $author_total;

	$payload = array(
		'comment' => $body,
		'author'  => $author,
		'post'    => $post_payload,
		'parent'  => $parent_payload,
		'replies' => $replies,
	);

	/**
	 * Filter the per-comment dossier payload.
	 *
	 * @since 0.8.0
	 *
	 * @param array $payload    Stats payload.
	 * @param int   $comment_id Comment id.
	 */
	return apply_filters(
		'desktop_mode_my_wordpress_comment_stats',
		$payload,
		$comment_id
	);
}
