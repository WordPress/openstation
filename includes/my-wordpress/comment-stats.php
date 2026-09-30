<?php
/**
 * OpenStation — My WordPress: per-comment dossier endpoint.
 *
 * `GET /desktop-mode/v1/comment-stats/<id>` returns the rendered
 * comment + author + parent post + thread context + reply tree +
 * a count of how active the author has been across the site. Powers
 * the right preview pane in the My WordPress folder when a comment
 * is selected.
 *
 * Permissions, in gate order:
 *   - The route wears the module's authorization gate,
 *     `openstation_my_wordpress_user_can_use()` — `edit_posts` by
 *     default, filterable. (That gate does *not* decide WP Explorer's
 *     window or launcher; the app declares its own capabilities. See
 *     the helper's docblock in `window.php`.)
 *   - The caller must be able to read the comment's parent post —
 *     see `openstation_my_wordpress_can_read_comment_post()` — so a
 *     low-capability author cannot read comments on posts they can't
 *     otherwise see: private, sealed behind a password, or of a post
 *     type with no readable front end at all.
 *   - Past those two gates, the comment itself must be visible —
 *     `openstation_my_wordpress_comment_is_visible()`: approved, OR the
 *     user can `moderate_comments`, OR they're the comment author.
 *   - The thread around it is scoped to the post those two gates just
 *     authorized: `comment_post_ID` and `comment_parent` are independent
 *     columns, so "the parent of a readable comment" is not by itself a
 *     readable comment. Within that post the two thread members are
 *     filtered differently:
 *       - the parent runs the same visibility test as the requested
 *         comment (approved, moderator, or own);
 *       - replies are approved only — plus pending ones for a
 *         moderator, as a moderation aid. Spam and trash never ship,
 *         and there is no own-reply exception.
 *   - Author email / IP / user-agent only ship to viewers with
 *     `moderate_comments`.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the route.
 */
function openstation_my_wordpress_register_comment_stats_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/comment-stats/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_my_wordpress_comment_stats_callback',
			'permission_callback' => static function () {
				// The dossier is an author's tool, so it wears the
				// module's authorization gate rather than a gate of its
				// own. Bare is_user_logged_in() let any subscriber read
				// it (OPENSTA-155). WP Explorer's window and launcher
				// are gated separately, by the app's own capabilities.
				return openstation_my_wordpress_user_can_use();
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
add_action( 'rest_api_init', 'openstation_my_wordpress_register_comment_stats_route' );

/**
 * Whether the current user may read the post a comment belongs to.
 *
 * Three gates, in order:
 *
 *   1. **No parent at all.** An orphaned comment (`comment_post_ID` of
 *      0, or a post since deleted) has nothing to authorize against, so
 *      it is moderators-only.
 *   2. **A sealed parent** needs `edit_post` — the escape hatch
 *      `WP_REST_Posts_Controller::check_password_required()` grants.
 *      Note `post_password_required()` reads the `wp-postpass` cookie:
 *      a caller who has already entered the password is *not* looking at
 *      a sealed post, and falls through to the gates below like any
 *      other reader.
 *   3. **A parent whose post type has no readable front end** needs
 *      `edit_post` too. This is the branch `read_post` alone misses:
 *      `map_meta_cap()` resolves `read_post` on a *published* post to
 *      the type's `read` capability, which is plain `read` on any post
 *      type registered with `map_meta_cap`, and every logged-in user
 *      holds it. So a published post of an internal post type — a
 *      plugin's submission log, queue or internal note, none of which
 *      a visitor can open — would otherwise read like a public post.
 *      `openstation_ai_can_read_post()` takes the same position.
 *
 * Anything else is Core's `read_post`, matching
 * `WP_REST_Comments_Controller::check_read_post_permission()`. Unlike
 * the AI sibling this keeps `read_post` as the floor for viewable types
 * rather than short-circuiting publicly viewable posts: that helper
 * serves search, which is about public content, while this one mirrors
 * Core's single-comment read.
 *
 * @param WP_Post|null $post Parent post, or null when it no longer exists.
 * @return bool
 */
function openstation_my_wordpress_can_read_comment_post( $post ) {
	if ( ! $post ) {
		return current_user_can( 'moderate_comments' );
	}
	if ( post_password_required( $post ) && ! current_user_can( 'edit_post', $post->ID ) ) {
		return false;
	}
	$post_type = get_post_type_object( $post->post_type );
	if ( ! $post_type || ! is_post_type_viewable( $post_type ) ) {
		return current_user_can( 'edit_post', $post->ID );
	}
	return current_user_can( 'read_post', $post->ID );
}

/**
 * Whether a comment's own moderation state lets the current user see it.
 *
 * The parent-post gate above decides whether the caller may see comments
 * on that post at all; this decides whether they may see *this* comment:
 * approved ones are public, anything pending, spam or trashed is for
 * moderators and for the person who wrote it.
 *
 * Applied to the requested comment and to the thread parent alike —
 * the parent is reached by id, not by a query that filters on status,
 * so without this its excerpt would ship whatever its status. Replies
 * are NOT run through it: their query filters on status in SQL, with
 * narrower rules (see the replies section of the callback).
 *
 * @param WP_Comment $comment Comment to test.
 * @return bool
 */
function openstation_my_wordpress_comment_is_visible( $comment ) {
	if ( '1' === (string) $comment->comment_approved ) {
		return true;
	}
	if ( current_user_can( 'moderate_comments' ) ) {
		return true;
	}
	$author_id = (int) $comment->user_id;
	return $author_id > 0 && (int) get_current_user_id() === $author_id;
}

/**
 * Aggregator callback.
 *
 * @param WP_REST_Request $request REST request.
 * @return array|WP_Error
 */
function openstation_my_wordpress_comment_stats_callback( $request ) {
	global $wpdb;
	// `\d+` matches 0 and absint() keeps it, so the zero has to be
	// refused here: get_comment( 0 ) falls back to $GLOBALS['comment'],
	// which would answer /comment-stats/0 with whatever comment another
	// plugin happened to leave in the global instead of the documented
	// 404. Same hazard as get_post( 0 ) below, one level up.
	$comment_id = (int) $request->get_param( 'id' );
	$comment    = $comment_id > 0 ? get_comment( $comment_id ) : null;
	if ( ! $comment ) {
		return new WP_Error(
			'openstation_comment_not_found',
			__( 'Comment not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	// Object-level authorization: refuse when the caller can't read
	// the comment's parent post (OPENSTA-155). Fetched once here and
	// reused for the parent-post payload below. The explicit zero
	// check matters: get_post( 0 ) falls back to the global post, so
	// an orphaned comment would be authorized against whatever post
	// happened to be global instead of hitting the moderators-only
	// branch.
	$post = $comment->comment_post_ID
		? get_post( (int) $comment->comment_post_ID )
		: null;
	if ( ! openstation_my_wordpress_can_read_comment_post( $post ) ) {
		return new WP_Error(
			'openstation_comment_forbidden',
			__( 'You do not have permission to view this comment.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	$can_moderate = current_user_can( 'moderate_comments' );
	$is_approved  = '1' === (string) $comment->comment_approved;

	if ( ! openstation_my_wordpress_comment_is_visible( $comment ) ) {
		return new WP_Error(
			'openstation_comment_forbidden',
			__( 'You do not have permission to view this comment.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	// ----- Comment body ------------------------------------------------
	/** This filter is documented in wp-includes/comment-template.php */
	$content_filtered = apply_filters( 'comment_text', $comment->comment_content, $comment, array() ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Core's filter, applied so comment bodies render as they do everywhere else.
	$body             = array(
		'id'           => (int) $comment->comment_ID,
		'parent'       => (int) $comment->comment_parent,
		'date'         => mysql2date( 'c', $comment->comment_date_gmt, false ),
		'status'       => $is_approved
			? 'approved'
			: ( '0' === (string) $comment->comment_approved
				? 'pending'
				: (string) $comment->comment_approved ),
		'rendered'     => (string) $content_filtered,
		'rendered_raw' => (string) $comment->comment_content,
		'editLink'     => $can_moderate
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
		'name'      => openstation_plain_text_title( $comment->comment_author ),
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
			$author['displayName'] = openstation_plain_text_title( $user->display_name );
			$author['profileLink'] = get_author_posts_url( $user->ID );
		}
	}

	// ----- Parent post -------------------------------------------------
	$post_payload = null;
	if ( $post ) {
		$post_author  = $post->post_author > 0
			? get_userdata( (int) $post->post_author )
			: null;
		$post_payload = array(
			'id'       => (int) $post->ID,
			'title'    => openstation_plain_text_title( get_the_title( $post ) ),
			'link'     => (string) get_permalink( $post ),
			'editLink' => current_user_can( 'edit_post', $post->ID )
				? (string) get_edit_post_link( $post->ID, 'raw' )
				: '',
			'status'   => (string) $post->post_status,
			'type'     => (string) $post->post_type,
			'date'     => mysql2date( 'c', $post->post_date_gmt, false ),
			'author'   => $post_author
				? array(
					'id'        => (int) $post_author->ID,
					'name'      => openstation_plain_text_title( $post_author->display_name ),
					'avatarUrl' => (string) get_avatar_url(
						$post_author->ID,
						array( 'size' => 48 )
					),
				)
				: null,
		);
	}

	// ----- Parent comment (if this is a reply) -------------------------
	// Only the thread above it on the SAME post, and only if its own
	// status allows. The gates at the top authorized one post and one
	// comment; `comment_post_ID` and `comment_parent` are independent
	// columns, and wp_insert_comment() will happily write a parent that
	// lives on another post, so an excerpt from an unreadable post could
	// otherwise ride in here on a readable comment.
	$parent_payload = null;
	if ( (int) $comment->comment_parent > 0 ) {
		$parent_comment = get_comment( (int) $comment->comment_parent );
		if ( $parent_comment
			&& (int) $parent_comment->comment_post_ID === (int) $comment->comment_post_ID
			&& openstation_my_wordpress_comment_is_visible( $parent_comment )
		) {
			$parent_payload = array(
				'id'         => (int) $parent_comment->comment_ID,
				'authorName' => openstation_plain_text_title( $parent_comment->comment_author ),
				'date'       => mysql2date( 'c', $parent_comment->comment_date_gmt, false ),
				'excerpt'    => openstation_plain_text_title(
					wp_trim_words( openstation_strip_all_tags( $parent_comment->comment_content ), 40 )
				),
			);
		}
	}

	// ----- Replies (direct children) -----------------------------------
	// Scoped to the authorized post for the same reason as the parent
	// above: `comment_parent` alone would pull in a comment stored
	// against a post the caller cannot read. A reply on another post is
	// not a reply to this thread anyway.
	//
	// Static SQL literal — must not go through a %s placeholder, which
	// would quote it into an adjacent string literal and break the clause.
	$reply_status_sql = $can_moderate
		? "comment_approved IN ( '0', '1' )"
		: "comment_approved = '1'";
	$reply_rows       = $wpdb->get_results(
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $reply_status_sql is a fixed literal chosen above; no user input.
		$wpdb->prepare(
			"SELECT comment_ID, comment_author, comment_author_email,
				comment_date_gmt, comment_content, comment_approved, user_id
			FROM {$wpdb->comments}
			WHERE comment_parent = %d
				AND comment_post_ID = %d
				AND {$reply_status_sql}
			ORDER BY comment_date_gmt ASC
			LIMIT 20",
			$comment->comment_ID,
			$comment->comment_post_ID
		),
		ARRAY_A
	);
	$replies = array();
	foreach ( (array) $reply_rows as $row ) {
		$replies[] = array(
			'id'         => (int) $row['comment_ID'],
			'authorName' => openstation_plain_text_title( $row['comment_author'] ),
			'avatarUrl'  => (string) get_avatar_url(
				$row['comment_author_email'],
				array( 'size' => 32 )
			),
			'date'       => mysql2date( 'c', (string) $row['comment_date_gmt'], false ),
			'excerpt'    => openstation_plain_text_title(
				wp_trim_words( openstation_strip_all_tags( (string) $row['comment_content'] ), 40 )
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
	 * @param array $payload    Stats payload.
	 * @param int   $comment_id Comment id.
	 */
	return apply_filters(
		'openstation_my_wordpress_comment_stats',
		$payload,
		$comment_id
	);
}
