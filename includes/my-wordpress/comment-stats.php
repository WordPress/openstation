<?php

defined( 'ABSPATH' ) || exit;

function openstation_my_wordpress_register_comment_stats_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/comment-stats/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_my_wordpress_comment_stats_callback',
			'permission_callback' => static function () {

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

function openstation_my_wordpress_comment_stats_callback( $request ) {
	global $wpdb;

	$comment_id = (int) $request->get_param( 'id' );
	$comment    = $comment_id > 0 ? get_comment( $comment_id ) : null;
	if ( ! $comment ) {
		return new WP_Error(
			'openstation_comment_not_found',
			__( 'Comment not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

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

	$content_filtered = apply_filters( 'comment_text', $comment->comment_content, $comment, array() );
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

	$reply_status_sql = $can_moderate
		? "comment_approved IN ( '0', '1' )"
		: "comment_approved = '1'";
	$reply_rows       = $wpdb->get_results(

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

	return apply_filters(
		'openstation_my_wordpress_comment_stats',
		$payload,
		$comment_id
	);
}
