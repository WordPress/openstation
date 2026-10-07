<?php

defined( 'ABSPATH' ) || exit;

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

function openstation_comments_window_moderate( array $ids, $action ) {
	$ids    = array_values( array_filter( array_map( 'intval', $ids ) ) );
	$action = (string) $action;
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

	do_action(
		'openstation_comments_window_after_bulk',
		$action,
		$processed,
		$skipped
	);

	return array(
		'processed' => $processed,
		'skipped'   => $skipped,
	);
}

function openstation_comments_window_is_blank( $content ) {
	return '' === trim( wp_strip_all_tags( (string) $content ) );
}

function openstation_comments_window_create_reply( $parent_id, $content ) {
	$parent_id = (int) $parent_id;
	$content   = (string) $content;

	$parent = get_comment( $parent_id );
	if ( ! $parent instanceof WP_Comment ) {
		return new WP_Error(
			'openstation_comments_no_parent',
			__( 'Parent comment not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$post = get_post( (int) $parent->comment_post_ID );
	if ( ! $post instanceof WP_Post || ! current_user_can( 'edit_post', $post->ID ) ) {
		return new WP_Error(
			'openstation_comments_forbidden',
			__( 'You are not allowed to reply to comments on this post.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	if ( openstation_comments_window_is_blank( $content ) ) {
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
	return array(
		'id'        => (int) $new_id,
		'parent'    => $parent_id,
		'content'   => $new ? (string) $new->comment_content : $content,
		'date_gmt'  => $new ? (string) $new->comment_date_gmt : '',
		'author'    => $user->display_name,
		'avatarUrl' => (string) get_avatar_url( (int) $user->ID, array( 'size' => 96 ) ),
	);
}

function openstation_comments_window_author_insights( $email ) {
	$email = strtolower( (string) $email );
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

	$edge = static function ( $order ) use ( $email ) {
		$rows = get_comments(
			array(
				'author_email' => $email,
				'status'       => 'all',
				'orderby'      => 'comment_date_gmt',
				'order'        => $order,
				'number'       => 1,
			)
		);
		return isset( $rows[0] ) ? (string) $rows[0]->comment_date_gmt : null;
	};

	$user        = get_user_by( 'email', $email );
	$reliability = 100;
	if ( $total > 0 ) {
		$bad         = $counts_by_status['spam'] + $counts_by_status['trash'];
		$reliability = (int) round( max( 0, min( 100, 100 - ( $bad / $total ) * 100 ) ) );
	}

	return array(
		'email'       => $email,
		'total'       => $total,
		'counts'      => $counts_by_status,
		'oldest'      => $edge( 'ASC' ),
		'newest'      => $edge( 'DESC' ),
		'userId'      => $user ? (int) $user->ID : 0,
		'userName'    => $user ? (string) $user->display_name : '',
		'reliability' => $reliability,
		'avatarUrl'   => (string) get_avatar_url( $email, array( 'size' => 96 ) ),
	);
}

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

function openstation_comments_window_rest_bulk( WP_REST_Request $request ) {
	$action = (string) $request['action'];
	$result = openstation_comments_window_moderate( (array) $request['ids'], $action );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	return new WP_REST_Response(
		array(
			'action'    => $action,
			'processed' => $result['processed'],
			'skipped'   => $result['skipped'],
			'counts'    => openstation_comments_window_counts(),
		),
		200
	);
}

function openstation_comments_window_rest_reply( WP_REST_Request $request ) {
	$result = openstation_comments_window_create_reply( (int) $request['parent'], (string) $request['content'] );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	return new WP_REST_Response( $result, 201 );
}

function openstation_comments_window_rest_insights( WP_REST_Request $request ) {
	$result = openstation_comments_window_author_insights( urldecode( (string) $request['email'] ) );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	return new WP_REST_Response( $result, 200 );
}

function openstation_comments_window_rest_counts() {
	return new WP_REST_Response( openstation_comments_window_counts(), 200 );
}
