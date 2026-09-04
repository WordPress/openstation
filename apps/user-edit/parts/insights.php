<?php
/**
 * User Edit app — the insights payload behind the profile sidebar
 * and activity feed: `GET /desktop-mode/v1/users/<id>/insights`.
 *
 *   - profileCompleteness: filled vs total core fields, percent
 *   - stats: posts / pages / attachments / comments authored /
 *     approved comments received / days since registration / last login
 *   - contentByMonth: last 12 months of posts authored
 *   - recentPosts, recentComments: the last 5 of each (comments BY the
 *     user, not ON their posts)
 *   - sessions: the active session tokens, `current` flagged when known
 *   - applicationPasswords: count + most-recently-used summary
 *
 * Each user's payload is computed at most once per minute (a transient
 * keyed by user id); `?fresh=1` bypasses the cache.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the route.
 */
function openstation_user_edit_window_register_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/users/(?P<id>\d+)/insights',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_user_edit_window_rest_insights',
			'permission_callback' => 'openstation_user_edit_window_rest_permission',
			'args'                => array(
				'id'    => array(
					'required' => true,
					'type'     => 'integer',
				),
				'fresh' => array(
					'type' => 'boolean',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_user_edit_window_register_rest_routes' );

/**
 * `GET /users/<id>/insights` callback.
 *
 * @param WP_REST_Request $req Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_user_edit_window_rest_insights( $req ) {
	$id   = (int) $req->get_param( 'id' );
	$user = $id > 0 ? get_userdata( $id ) : null;
	if ( ! $user instanceof WP_User ) {
		return new WP_Error( 'openstation_users_not_found', __( 'User not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}

	$fresh     = (bool) $req->get_param( 'fresh' );
	$cache_key = 'dm_user_insights_' . $id;
	$payload   = null;
	if ( ! $fresh ) {
		$cached = get_transient( $cache_key );
		if ( is_array( $cached ) ) {
			$payload = $cached;
		}
	}
	if ( null === $payload ) {
		$payload = openstation_user_edit_window_compute_insights( $user );
	}

	// Self-view: the viewer is logged in right now, so a "Never" last
	// login (an account that predates the tracker) contradicts the
	// obvious. Pin to now and backfill the meta so future reads no
	// longer depend on this override — on cache hits as well as fresh
	// computes, since a cached payload may carry the stale null.
	if ( (int) get_current_user_id() === $id ) {
		$now    = time();
		$stored = (int) get_user_meta( $id, OPENSTATION_LAST_LOGIN_META_KEY, true );
		if ( $stored <= 0 ) {
			update_user_meta( $id, OPENSTATION_LAST_LOGIN_META_KEY, $now );
			$stored = $now;
		}
		if ( ! isset( $payload['stats'] ) || ! is_array( $payload['stats'] ) ) {
			$payload['stats'] = array();
		}
		if ( empty( $payload['stats']['lastLoginAt'] ) ) {
			$payload['stats']['lastLoginAt']        = $stored;
			$payload['stats']['daysSinceLastLogin'] = max( 0, (int) floor( ( $now - $stored ) / DAY_IN_SECONDS ) );
		}
	}

	/**
	 * Filter the insights payload before it's returned and cached.
	 *
	 * Plugins can append their own metrics (security-event counts,
	 * subscription tier, last-orders-placed, …) by extending the
	 * `stats` map or adding new top-level keys; the profile tolerates
	 * unknown keys.
	 *
	 * @param array   $payload Insights payload.
	 * @param WP_User $user    Target user.
	 */
	$payload = (array) apply_filters( 'openstation_user_edit_window_insights', $payload, $user );

	set_transient( $cache_key, $payload, MINUTE_IN_SECONDS );

	return rest_ensure_response( $payload );
}

/**
 * The last 12 months of published posts, bucketed by `Y-m`.
 *
 * @param int $id User id.
 * @return array<int,array{month:string,count:int}>
 */
function openstation_user_edit_window_content_by_month( $id ) {
	global $wpdb;
	$buckets = array();
	$now     = time();
	for ( $i = 11; $i >= 0; $i-- ) {
		$buckets[ gmdate( 'Y-m', strtotime( "-{$i} months", $now ) ) ] = 0;
	}
	$rows = (array) $wpdb->get_results(
		$wpdb->prepare(
			"SELECT DATE_FORMAT( post_date_gmt, '%%Y-%%m' ) AS bucket, COUNT(*) AS cnt
			 FROM {$wpdb->posts}
			 WHERE post_author = %d
			 AND post_status IN ( 'publish', 'private', 'future' )
			 AND post_date_gmt >= %s
			 GROUP BY bucket
			 ORDER BY bucket ASC",
			$id,
			gmdate( 'Y-m-01 00:00:00', strtotime( '-12 months', $now ) )
		),
		ARRAY_A
	);
	foreach ( $rows as $row ) {
		$bucket = isset( $row['bucket'] ) ? (string) $row['bucket'] : '';
		if ( isset( $buckets[ $bucket ] ) ) {
			$buckets[ $bucket ] = (int) $row['cnt'];
		}
	}
	$out = array();
	foreach ( $buckets as $bucket => $cnt ) {
		$out[] = array(
			'month' => $bucket,
			'count' => $cnt,
		);
	}
	return $out;
}

/**
 * A GMT datetime, or the local one converted, for rows whose GMT
 * column is the zero date (a draft never published).
 *
 * @param string $gmt   The GMT column.
 * @param string $local The local column.
 * @return string
 */
function openstation_user_edit_window_gmt_or_local( $gmt, $local ) {
	$gmt = (string) $gmt;
	if ( '' === $gmt || 0 === strpos( $gmt, '0000-00-00' ) ) {
		return (string) get_gmt_from_date( (string) $local );
	}
	return $gmt;
}

/**
 * The active sessions of a user, the current device flagged.
 *
 * @param int $id User id.
 * @return array<int,array<string,mixed>>
 */
function openstation_user_edit_window_sessions( $id ) {
	if ( ! class_exists( 'WP_Session_Tokens' ) ) {
		return array();
	}
	// The meta blob's keys are verifiers — hashes of the raw cookie
	// token — so hash the current token the same way before comparing.
	$current_token    = wp_get_session_token();
	$current_verifier = $current_token ? hash( 'sha256', $current_token ) : '';
	$sessions         = array();
	$now              = time();
	foreach ( (array) get_user_meta( $id, 'session_tokens', true ) as $hash => $info ) {
		if ( ! is_array( $info ) ) {
			continue;
		}
		$expires = isset( $info['expiration'] ) ? (int) $info['expiration'] : 0;
		if ( $expires > 0 && $expires < $now ) {
			continue;
		}
		$sessions[] = array(
			'expiration' => $expires,
			'login'      => isset( $info['login'] ) ? (int) $info['login'] : 0,
			'ip'         => isset( $info['ip'] ) ? (string) $info['ip'] : '',
			'ua'         => isset( $info['ua'] ) ? (string) $info['ua'] : '',
			'current'    => '' !== $current_verifier && $current_verifier === $hash,
		);
	}
	return $sessions;
}

/**
 * Compute the insights payload for a user. Public so a plugin can call
 * it from its own route without the HTTP cycle.
 *
 * @param WP_User $user Target user.
 * @return array<string,mixed>
 */
function openstation_user_edit_window_compute_insights( WP_User $user ) {
	global $wpdb;
	$id = (int) $user->ID;

	$completeness_fields = array( $user->first_name, $user->last_name, $user->nickname, $user->description, $user->user_url, $user->user_email );
	$filled              = count( array_filter( array_map( 'trim', array_map( 'strval', $completeness_fields ) ) ) );
	$total               = count( $completeness_fields );

	$received_comments = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(c.comment_ID) FROM {$wpdb->comments} c
			 INNER JOIN {$wpdb->posts} p ON p.ID = c.comment_post_ID
			 WHERE p.post_author = %d AND p.post_status = 'publish' AND c.comment_approved = '1'",
			$id
		)
	);

	$recent_posts = array();
	foreach (
		get_posts(
			array(
				'author'         => $id,
				'post_type'      => 'any',
				'post_status'    => array( 'publish', 'draft', 'pending', 'future', 'private' ),
				'posts_per_page' => 5,
				'orderby'        => 'date',
				'order'          => 'DESC',
			)
		) as $post
	) {
		$recent_posts[] = array(
			'id'           => (int) $post->ID,
			'title'        => '' !== $post->post_title ? $post->post_title : __( '(no title)', 'desktop-mode' ),
			'status'       => (string) $post->post_status,
			'type'         => (string) $post->post_type,
			'dateGmt'      => openstation_user_edit_window_gmt_or_local( $post->post_date_gmt, $post->post_date ),
			'commentCount' => (int) $post->comment_count,
			'permalink'    => (string) get_permalink( $post ),
			'editUrl'      => (string) get_edit_post_link( $post->ID, 'raw' ),
		);
	}

	$recent_comments = array();
	foreach (
		(array) get_comments(
			array(
				'user_id' => $id,
				'number'  => 5,
				'orderby' => 'comment_date_gmt',
				'order'   => 'DESC',
			)
		) as $comment
	) {
		$post              = $comment->comment_post_ID ? get_post( (int) $comment->comment_post_ID ) : null;
		$recent_comments[] = array(
			'id'        => (int) $comment->comment_ID,
			'postId'    => (int) $comment->comment_post_ID,
			'postTitle' => $post instanceof WP_Post ? ( '' !== $post->post_title ? $post->post_title : __( '(no title)', 'desktop-mode' ) ) : '',
			'excerpt'   => wp_trim_words( wp_strip_all_tags( (string) $comment->comment_content ), 24 ),
			'dateGmt'   => openstation_user_edit_window_gmt_or_local( $comment->comment_date_gmt, $comment->comment_date ),
			'approved'  => '1' === (string) $comment->comment_approved,
		);
	}

	$app_passwords = array(
		'total'        => 0,
		'lastUsedAt'   => null,
		'lastUsedName' => null,
	);
	if ( class_exists( 'WP_Application_Passwords' ) ) {
		$apps                   = (array) WP_Application_Passwords::get_user_application_passwords( $id );
		$app_passwords['total'] = count( $apps );
		$best                   = 0;
		foreach ( $apps as $app ) {
			$used = isset( $app['last_used'] ) ? (int) $app['last_used'] : 0;
			if ( $used > $best ) {
				$best                          = $used;
				$app_passwords['lastUsedAt']   = $used;
				$app_passwords['lastUsedName'] = isset( $app['name'] ) ? (string) $app['name'] : null;
			}
		}
	}

	$registered_ts = strtotime( (string) $user->user_registered . ' UTC' );
	$last_login_ts = (int) get_user_meta( $id, OPENSTATION_LAST_LOGIN_META_KEY, true );
	$last_login_ts = $last_login_ts > 0 ? $last_login_ts : null;
	$days          = static function ( $since ) {
		return $since ? max( 0, (int) floor( ( time() - $since ) / DAY_IN_SECONDS ) ) : null;
	};

	return array(
		'userId'               => $id,
		'displayName'          => (string) $user->display_name,
		'avatarUrl'            => (string) get_avatar_url( $id, array( 'size' => 96 ) ),
		'profileUrl'           => (string) get_author_posts_url( $id ),
		'roles'                => array_values( (array) $user->roles ),
		'capabilitiesCount'    => is_array( $user->allcaps ) ? count( array_filter( $user->allcaps ) ) : 0,
		'profileCompleteness'  => array(
			'filled'  => $filled,
			'total'   => $total,
			'percent' => $total > 0 ? (int) round( ( $filled / $total ) * 100 ) : 0,
		),
		'stats'                => array(
			'posts'                 => (int) count_user_posts( $id, 'post', true ),
			'pages'                 => post_type_exists( 'page' ) ? (int) count_user_posts( $id, 'page', true ) : 0,
			'attachments'           => (int) count_user_posts( $id, 'attachment', true ),
			'commentsAuthored'      => (int) get_comments(
				array(
					'user_id' => $id,
					'count'   => true,
				)
			),
			'commentsReceived'      => $received_comments,
			'daysSinceRegistration' => $days( $registered_ts ),
			'lastLoginAt'           => $last_login_ts,
			'daysSinceLastLogin'    => $days( $last_login_ts ),
			'registeredAt'          => $registered_ts ? $registered_ts : null,
		),
		'contentByMonth'       => openstation_user_edit_window_content_by_month( $id ),
		'recentPosts'          => $recent_posts,
		'recentComments'       => $recent_comments,
		'sessions'             => openstation_user_edit_window_sessions( $id ),
		'applicationPasswords' => $app_passwords,
	);
}
