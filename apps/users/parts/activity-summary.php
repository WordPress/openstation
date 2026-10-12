<?php
/** Complete activity totals with bounded profile samples. @package OpenStation */
defined( 'ABSPATH' ) || exit;

/**
 * Reduce compact site-member facts in one pass. Full WP_User objects and avatars
 * are loaded only for the bounded lists the dashboard actually displays.
 *
 * @return array|WP_Error Complete snapshot or a capability/database error.
 */
function openstation_users_window_activity_summary() {
	global $wpdb;
	if ( ! current_user_can( 'list_users' ) ) {
		return new WP_Error( 'openstation_users_forbidden', __( 'You are not allowed to list users.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	$scope = is_multisite() ? $wpdb->prepare( "EXISTS (SELECT 1 FROM {$wpdb->usermeta} membership WHERE membership.user_id = u.ID AND membership.meta_key = %s)", $wpdb->get_blog_prefix() . 'capabilities' ) : '1=1';
	// The only interpolated identifiers belong to wpdb. Scope is prepared above.
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- Trusted identifiers and a prepared membership predicate.
	$sql = $wpdb->prepare(
		"SELECT u.ID, u.display_name, u.user_registered, COALESCE(l.login, 0) AS login, COALESCE(p.posts, 0) AS posts, COALESCE(p.pages, 0) AS pages, COALESCE(c.comments, 0) AS comments
		FROM {$wpdb->users} u
		LEFT JOIN (SELECT user_id, MAX(CAST(meta_value AS UNSIGNED)) AS login FROM {$wpdb->usermeta} WHERE meta_key = %s GROUP BY user_id) l ON l.user_id = u.ID
		LEFT JOIN (SELECT post_author, SUM(CASE WHEN post_type = 'post' THEN 1 ELSE 0 END) AS posts, SUM(CASE WHEN post_type = 'page' THEN 1 ELSE 0 END) AS pages FROM {$wpdb->posts} WHERE post_status = 'publish' AND post_type IN ('post', 'page') GROUP BY post_author) p ON p.post_author = u.ID
		LEFT JOIN (SELECT user_id, COUNT(*) AS comments FROM {$wpdb->comments} WHERE comment_approved = '1' AND user_id > 0 GROUP BY user_id) c ON c.user_id = u.ID
		WHERE {$scope}",
		OPENSTATION_LAST_LOGIN_META_KEY
	);
	// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- Prepared immediately above.
	$rows = $wpdb->get_results( $sql, ARRAY_A );
	if ( null === $rows || $wpdb->last_error ) {
		return new WP_Error( 'openstation_users_activity_failed', __( 'Activity could not be loaded.', 'desktop-mode' ), array( 'status' => 500 ) );
	}
	$now      = time();
	$end      = (int) floor( $now / DAY_IN_SECONDS ) * DAY_IN_SECONDS + DAY_IN_SECONDS;
	$start    = $end - 56 * DAY_IN_SECONDS;
	$out      = array(
		'total'           => count( $rows ),
		'known'           => count( $rows ),
		'totals'          => array(
			'posts'    => 0,
			'pages'    => 0,
			'comments' => 0,
		),
		'contributors'    => 0,
		'recent'          => 0,
		'active30'        => 0,
		'unrecorded'      => 0,
		'unknownPresence' => 0,
		'onlineCount'     => 0,
		'awayCount'       => 0,
		'start'           => $start,
		'end'             => $end,
		'weeks'           => array_fill( 0, 8, array( 0 ) ),
	);
	$samples  = array_fill_keys( array( 'posts', 'pages', 'comments', 'registered', 'logins', 'online', 'away' ), array() );
	$presence = openstation_presence_get_all();
	foreach ( $rows as $row ) {
		$id    = (int) $row['ID'];
		$stats = array();
		foreach ( array( 'posts', 'pages', 'comments' ) as $kind ) {
			$stats[ $kind ]          = (int) $row[ $kind ];
			$out['totals'][ $kind ] += $stats[ $kind ];
		}
		$out['contributors'] += array_sum( $stats ) > 0 ? 1 : 0;
		$registered           = strtotime( $row['user_registered'] . ' UTC' );
		$login                = (int) $row['login'];
		$status               = openstation_presence_status_from_record( $presence[ $id ] ?? array() );
		$person               = array(
			'id'                     => $id,
			'name'                   => $row['display_name'],
			'registered_date'        => str_replace( ' ', 'T', $row['user_registered'] ) . 'Z',
			'openstation_last_login' => $login,
			'openstation_presence'   => $status,
			'openstation_user_stats' => $stats,
		);
		foreach ( $stats as $kind => $count ) {
			if ( $count > 0 ) {
				openstation_users_activity_sample( $samples[ $kind ], $person, $count, 6 );
			}
		}
		if ( $registered > 0 && $registered <= $now ) {
			$out['recent'] += $registered >= $now - 30 * DAY_IN_SECONDS ? 1 : 0;
			$bucket         = (int) floor( ( $registered - $start ) / ( 7 * DAY_IN_SECONDS ) );
			if ( $bucket >= 0 && $bucket < 8 ) {
				++$out['weeks'][ $bucket ][0];
			}
			openstation_users_activity_sample( $samples['registered'], $person, $registered, 4 );
		}
		if ( $login > 0 && $login <= $now ) {
			$out['active30'] += $login >= $now - 30 * DAY_IN_SECONDS ? 1 : 0;
			openstation_users_activity_sample( $samples['logins'], $person, $login, 6 );
		} else {
			++$out['unrecorded'];
		}
		if ( 'online' === $status || 'inactive' === $status ) {
			$key = 'online' === $status ? 'online' : 'away';
			++$out[ $key . 'Count' ];
			openstation_users_activity_sample( $samples[ $key ], $person, 1, 6 );
		} elseif ( 'offline' !== $status ) {
			++$out['unknownPresence'];
		}
	}
	unset( $rows );
	$ids = array();
	foreach ( $samples as $list ) {
		foreach ( $list as $person ) {
			$ids[] = $person['id'];
		}
	}
	$users    = $ids ? get_users(
		array(
			'include'     => array_unique( $ids ),
			'number'      => count( array_unique( $ids ) ),
			'count_total' => false,
		)
	) : array();
	$profiles = array();
	foreach ( $users as $user ) {
		$profiles[ $user->ID ] = array(
			'slug'        => $user->user_nicename,
			'roles'       => array_values( $user->roles ),
			'avatar_urls' => array( '48' => get_avatar_url( $user, array( 'size' => 48 ) ) ),
		);
	}
	foreach ( $samples as $key => $list ) {
		foreach ( $list as &$person ) {
			unset( $person['_score'] );
			$person = array_merge(
				$person,
				array( 'name' => openstation_plain_text_title( $person['name'] ) ),
				$profiles[ $person['id'] ] ?? array(
					'slug'  => '',
					'roles' => array(),
				)
			);
		}
		unset( $person );
		if ( in_array( $key, array( 'posts', 'pages', 'comments' ), true ) ) {
			$out['leaders'][ $key ] = $list;
		} else {
			$out[ $key ] = $list;
		}
	}
	/** Filter the complete totals and bounded profile samples. @param array $summary Activity snapshot. */
	return apply_filters( 'openstation_users_window_activity_summary', $out );
}

/**
 * Keep only the best bounded samples while reducing the population.
 *
 * @param array $list Samples, updated in place.
 * @param array $person Compact profile.
 * @param int   $score Sort metric.
 * @param int   $limit Maximum retained profiles.
 */
function openstation_users_activity_sample( array &$list, array $person, $score, $limit ) {
	$person['_score'] = $score;
	$list[]           = $person;
	usort(
		$list,
		static function ( $a, $b ) {
			$score_order = $b['_score'] <=> $a['_score'];
			if ( 0 !== $score_order ) {
				return $score_order;
			}
			$name_order = strcmp( $a['name'], $b['name'] );
			return 0 !== $name_order ? $name_order : ( $a['id'] <=> $b['id'] );
		}
	);
	$list = array_slice( $list, 0, $limit );
}

/** Register the authenticated read-only activity snapshot. */
function openstation_users_window_register_activity_summary_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/users/activity-summary',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => static function () {
				return current_user_can( 'list_users' );
			},
			'callback'            => 'openstation_users_window_activity_summary',
		)
	);
}
add_action( 'rest_api_init', 'openstation_users_window_register_activity_summary_route' );
