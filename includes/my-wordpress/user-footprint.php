<?php

defined( 'ABSPATH' ) || exit;

function openstation_my_wordpress_register_user_footprint_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/user-footprint/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_my_wordpress_user_footprint_callback',
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
add_action( 'rest_api_init', 'openstation_my_wordpress_register_user_footprint_route' );

function openstation_my_wordpress_footprint_can_see_post( $post, $for_comment = false ) {
	if ( ! $post ) {
		return $for_comment && current_user_can( 'moderate_comments' );
	}
	$status = get_post_status_object( $post->post_status );
	if ( ! $status || ! get_post_type_object( $post->post_type ) ) {
		return current_user_can( 'edit_others_posts' );
	}
	if ( $for_comment ) {
		return openstation_my_wordpress_can_read_comment_post( $post );
	}
	if ( ! is_post_type_viewable( $post->post_type ) ) {
		return current_user_can( 'edit_post', $post->ID );
	}
	return $status->public || current_user_can( 'read_post', $post->ID );
}

function openstation_my_wordpress_footprint_visible_counts( $rows, $for_comment, array &$verdicts ) {
	$rows   = (array) $rows;
	$prefix = $for_comment ? 'comment:' : 'post:';
	$unseen = array();
	foreach ( $rows as $row ) {
		$id = (int) $row['post_id'];
		if ( $id > 0 && ! isset( $verdicts[ $prefix . $id ] ) ) {
			$unseen[ $id ] = $id;
		}
	}
	if ( $unseen ) {
		_prime_post_caches( array_values( $unseen ), false, false );
	}

	$total  = 0;
	$by_day = array();
	foreach ( $rows as $row ) {
		$id = (int) $row['post_id'];
		if ( $id > 0 || $for_comment ) {
			$key = $prefix . $id;
			if ( ! isset( $verdicts[ $key ] ) ) {
				$verdicts[ $key ] = openstation_my_wordpress_footprint_can_see_post( $id > 0 ? get_post( $id ) : null, $for_comment );
			}
			if ( ! $verdicts[ $key ] ) {
				continue;
			}
		}
		$n      = (int) $row['n'];
		$total += $n;
		if ( isset( $row['d'] ) ) {
			$day            = (string) $row['d'];
			$by_day[ $day ] = ( $by_day[ $day ] ?? 0 ) + $n;
		}
	}
	return array(
		'total'  => $total,
		'by_day' => $by_day,
	);
}

function openstation_my_wordpress_user_footprint_callback( $request ) {
	global $wpdb;

	$user_id = (int) $request->get_param( 'id' );
	$user    = get_userdata( $user_id );
	if ( ! $user ) {
		return new WP_Error(
			'openstation_user_not_found',
			__( 'User not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$viewer_id       = get_current_user_id();
	$can_see_private = current_user_can( 'list_users' ) || ( $viewer_id === $user_id );

	$profile = array(
		'id'        => (int) $user->ID,
		'name'      => openstation_plain_text_title( $user->display_name ),
		'avatarUrl' => get_avatar_url( $user->ID, array( 'size' => 128 ) ),
		'link'      => get_author_posts_url( $user->ID ),
	);
	if ( $can_see_private ) {
		$role_labels = array();
		if ( function_exists( 'wp_roles' ) ) {
			$wp_roles = wp_roles();
			foreach ( (array) $user->roles as $slug ) {
				$role_labels[] = isset( $wp_roles->role_names[ $slug ] )
					? translate_user_role( $wp_roles->role_names[ $slug ] )
					: $slug;
			}
		}
		$profile['roleLabels'] = $role_labels;
		if ( '' !== $user->user_registered ) {
			$profile['registered'] = mysql2date( 'c', $user->user_registered, false );
		}
	}

	$days    = 365;
	$now     = time();
	$from_ts = strtotime( '-' . ( $days - 1 ) . ' days', $now );
	$to_ts   = $now;
	$range   = array(
		'from' => gmdate( 'Y-m-d', $from_ts ),
		'to'   => gmdate( 'Y-m-d', $to_ts ),
		'days' => $days,
	);

	$open_stati = array_values( get_post_stati( array( 'public' => true ) ) );
	$open_types = array_values( array_filter( get_post_types(), 'is_post_type_viewable' ) );
	if ( ! $open_types ) {

		$open_types = array( '' );
	}
	$open_stati_in = implode( ', ', array_fill( 0, count( $open_stati ), '%s' ) );
	$open_types_in = implode( ', ', array_fill( 0, count( $open_types ), '%s' ) );
	$open_args     = array_merge( $open_stati, $open_types );
	$verdicts      = array();

	$post_rows   = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT DATE(post_date_gmt) AS d, COUNT(*) AS n
			FROM {$wpdb->posts}
			WHERE post_author = %d
				AND post_status = 'publish'
				AND post_type IN ( 'post', 'page' )
				AND post_date_gmt >= %s
			GROUP BY d
			ORDER BY d ASC",
			$user_id,
			gmdate( 'Y-m-d 00:00:00', $from_ts )
		),
		ARRAY_A
	);
	$post_by_day = array();
	foreach ( (array) $post_rows as $row ) {
		$post_by_day[ (string) $row['d'] ] = (int) $row['n'];
	}

	$comment_rows   = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT DATE(c.comment_date_gmt) AS d, p.ID AS post_id, COUNT(*) AS n
			FROM {$wpdb->comments} c
			LEFT JOIN {$wpdb->posts} p ON c.comment_post_ID = p.ID
			WHERE c.user_id = %d
				AND c.comment_approved = '1'
				AND c.comment_date_gmt >= %s
			GROUP BY d, p.ID
			ORDER BY d ASC",
			$user_id,
			gmdate( 'Y-m-d 00:00:00', $from_ts )
		),
		ARRAY_A
	);
	$comment_by_day = openstation_my_wordpress_footprint_visible_counts( $comment_rows, true, $verdicts )['by_day'];

	$update_rows   = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT DATE(r.post_date_gmt) AS d,
				CASE WHEN p.post_status IN ( {$open_stati_in} ) AND p.post_type IN ( {$open_types_in} ) THEN 0 ELSE p.ID END AS post_id,
				COUNT(*) AS n
			FROM {$wpdb->posts} r
			INNER JOIN {$wpdb->posts} p ON r.post_parent = p.ID
			WHERE r.post_author = %d
				AND r.post_type = 'revision'
				AND r.post_status = 'inherit'
				AND (
					( p.post_date_gmt <> '0000-00-00 00:00:00' AND r.post_date_gmt > p.post_date_gmt )
					OR EXISTS (
						SELECT 1 FROM {$wpdb->posts} r0
						WHERE r0.post_parent = p.ID AND r0.post_type = 'revision' AND r0.ID < r.ID
					)
				)
				AND r.post_date_gmt >= %s
			GROUP BY d, post_id
			ORDER BY d ASC",
			array_merge( $open_args, array( $user_id, gmdate( 'Y-m-d 00:00:00', $from_ts ) ) )
		),
		ARRAY_A
	);
	$update_by_day = openstation_my_wordpress_footprint_visible_counts( $update_rows, false, $verdicts )['by_day'];

	$daily = array();
	for ( $i = 0; $i < $days; ++$i ) {
		$ts      = strtotime( '+' . $i . ' days', $from_ts );
		$date    = gmdate( 'Y-m-d', $ts );
		$daily[] = array(
			'date'     => $date,
			'posts'    => isset( $post_by_day[ $date ] ) ? $post_by_day[ $date ] : 0,
			'comments' => isset( $comment_by_day[ $date ] ) ? $comment_by_day[ $date ] : 0,
			'updates'  => isset( $update_by_day[ $date ] ) ? $update_by_day[ $date ] : 0,
		);
	}

	$weekday_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT DAYOFWEEK(post_date_gmt) AS dow, COUNT(*) AS n
			FROM {$wpdb->posts}
			WHERE post_author = %d
				AND post_status = 'publish'
				AND post_type IN ( 'post', 'page' )
			GROUP BY dow",
			$user_id
		),
		ARRAY_A
	);
	$weekday      = array( 0, 0, 0, 0, 0, 0, 0 );
	foreach ( (array) $weekday_rows as $row ) {
		$dow = (int) $row['dow'];
		if ( $dow >= 1 && $dow <= 7 ) {
			$weekday[ $dow - 1 ] = (int) $row['n'];
		}
	}

	$hour_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT HOUR(post_date) AS h, COUNT(*) AS n
			FROM {$wpdb->posts}
			WHERE post_author = %d
				AND post_status = 'publish'
				AND post_type IN ( 'post', 'page' )
			GROUP BY h",
			$user_id
		),
		ARRAY_A
	);
	$hour      = array_fill( 0, 24, 0 );
	foreach ( (array) $hour_rows as $row ) {
		$h = (int) $row['h'];
		if ( $h >= 0 && $h <= 23 ) {
			$hour[ $h ] = (int) $row['n'];
		}
	}

	$longest         = 0;
	$current         = 0;
	$longest_run     = 0;
	$longest_from    = '';
	$longest_to      = '';
	$run_start       = '';
	$today_str       = $range['to'];
	$prev_day_active = false;

	$is_active = static function ( $entry ) {
		return $entry['posts'] > 0
			|| ( isset( $entry['updates'] ) && $entry['updates'] > 0 )
			|| ( isset( $entry['comments'] ) && $entry['comments'] > 0 );
	};
	foreach ( $daily as $entry ) {
		if ( $is_active( $entry ) ) {
			if ( ! $prev_day_active ) {
				$run_start = $entry['date'];
			}
			++$longest_run;
			if ( $longest_run > $longest ) {
				$longest      = $longest_run;
				$longest_from = $run_start;
				$longest_to   = $entry['date'];
			}
			$prev_day_active = true;
		} else {
			$longest_run     = 0;
			$prev_day_active = false;
		}
	}

	for ( $i = count( $daily ) - 1; $i >= 0; --$i ) {
		if ( $is_active( $daily[ $i ] ) ) {
			++$current;
		} else {
			break;
		}
	}
	$streak = array(
		'longest'      => $longest,
		'current'      => $current,
		'longestRange' => array(
			'from' => $longest_from,
			'to'   => $longest_to,
		),
	);

	$timeline_posts    = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT ID, post_title, post_status, post_date_gmt, post_type
			FROM {$wpdb->posts}
			WHERE post_author = %d
				AND post_type IN ( 'post', 'page' )
				AND post_status NOT IN ( 'auto-draft', 'inherit', 'trash' )
			ORDER BY post_date_gmt DESC
			LIMIT 30",
			$user_id
		),
		ARRAY_A
	);
	$timeline_comments = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT c.comment_ID, c.comment_post_ID, c.comment_date_gmt, c.comment_approved,
				p.post_title, p.post_status
			FROM {$wpdb->comments} c
			LEFT JOIN {$wpdb->posts} p ON c.comment_post_ID = p.ID
			WHERE c.user_id = %d
				AND c.comment_approved = '1'
			ORDER BY c.comment_date_gmt DESC
			LIMIT 30",
			$user_id
		),
		ARRAY_A
	);

	$timeline_updates = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT r.post_parent AS parent_id, MAX(r.post_date_gmt) AS last_save, p.post_title, p.post_status, p.post_type
			FROM {$wpdb->posts} r
			INNER JOIN {$wpdb->posts} p ON r.post_parent = p.ID
			WHERE r.post_author = %d
				AND r.post_type = 'revision'
				AND r.post_status = 'inherit'
				AND (
					( p.post_date_gmt <> '0000-00-00 00:00:00' AND r.post_date_gmt > p.post_date_gmt )
					OR EXISTS (
						SELECT 1 FROM {$wpdb->posts} r0
						WHERE r0.post_parent = p.ID AND r0.post_type = 'revision' AND r0.ID < r.ID
					)
				)
				AND p.post_status NOT IN ( 'auto-draft', 'inherit', 'trash' )
			GROUP BY r.post_parent
			ORDER BY last_save DESC
			LIMIT 30",
			$user_id
		),
		ARRAY_A
	);
	$timeline         = array();

	$timeline_ids = array_filter(
		array_map(
			'intval',
			array_merge(
				wp_list_pluck( (array) $timeline_posts, 'ID' ),
				wp_list_pluck( (array) $timeline_comments, 'comment_post_ID' ),
				wp_list_pluck( (array) $timeline_updates, 'parent_id' )
			)
		)
	);
	if ( $timeline_ids ) {

		_prime_post_caches( array_unique( $timeline_ids ), false, false );
	}
	foreach ( (array) $timeline_posts as $p ) {
		$pid = (int) $p['ID'];
		if ( ! openstation_my_wordpress_footprint_can_see_post( get_post( $pid ) ) ) {
			continue;
		}
		$timeline[] = array(
			'kind'   => 'post',
			'date'   => mysql2date( 'c', $p['post_date_gmt'], false ),
			'title'  => openstation_plain_text_title( $p['post_title'] ),
			'status' => (string) $p['post_status'],
			'postId' => $pid,
			'link'   => (string) get_permalink( $pid ),
			'type'   => (string) $p['post_type'],
		);
	}
	foreach ( (array) $timeline_comments as $c ) {
		$pid = (int) $c['comment_post_ID'];
		if ( ! openstation_my_wordpress_footprint_can_see_post( $pid > 0 ? get_post( $pid ) : null, true ) ) {
			continue;
		}
		$timeline[] = array(
			'kind'   => 'comment',
			'date'   => mysql2date( 'c', $c['comment_date_gmt'], false ),
			'title'  => openstation_plain_text_title( $c['post_title'] ?? '' ),
			'status' => 'approved',
			'postId' => $pid,
			'link'   => $pid ? (string) get_permalink( $pid ) : '',
		);
	}
	foreach ( (array) $timeline_updates as $u ) {
		$pid = (int) $u['parent_id'];
		if ( ! openstation_my_wordpress_footprint_can_see_post( get_post( $pid ) ) ) {
			continue;
		}
		$timeline[] = array(
			'kind'   => 'post-update',
			'date'   => mysql2date( 'c', $u['last_save'], false ),
			'title'  => openstation_plain_text_title( $u['post_title'] ),
			'status' => (string) $u['post_status'],
			'postId' => $pid,
			'link'   => $pid ? (string) get_permalink( $pid ) : '',
			'type'   => (string) $u['post_type'],
		);
	}
	usort(
		$timeline,
		static function ( $a, $b ) {
			return strcmp( (string) $b['date'], (string) $a['date'] );
		}
	);
	$timeline = array_slice( $timeline, 0, 30 );

	$content_rows    = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT post_type,
				CASE WHEN post_status IN ( {$open_stati_in} ) AND post_type IN ( {$open_types_in} ) THEN 0 ELSE ID END AS post_id,
				COUNT(*) AS n
			FROM {$wpdb->posts}
			WHERE post_author = %d
				AND post_type IN ( 'post', 'page' )
				AND post_status NOT IN ( 'auto-draft', 'inherit', 'trash' )
			GROUP BY post_type, post_id",
			array_merge( $open_args, array( $user_id ) )
		),
		ARRAY_A
	);
	$totals_posts    = openstation_my_wordpress_footprint_visible_counts(
		wp_list_filter( (array) $content_rows, array( 'post_type' => 'post' ) ),
		false,
		$verdicts
	)['total'];
	$totals_pages    = openstation_my_wordpress_footprint_visible_counts(
		wp_list_filter( (array) $content_rows, array( 'post_type' => 'page' ) ),
		false,
		$verdicts
	)['total'];
	$comment_totals  = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT p.ID AS post_id, COUNT(*) AS n
			FROM {$wpdb->comments} c
			LEFT JOIN {$wpdb->posts} p ON c.comment_post_ID = p.ID
			WHERE c.user_id = %d
				AND c.comment_approved = '1'
			GROUP BY p.ID",
			$user_id
		),
		ARRAY_A
	);
	$totals_comments = openstation_my_wordpress_footprint_visible_counts( $comment_totals, true, $verdicts )['total'];

	$update_totals  = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT CASE WHEN p.post_status IN ( {$open_stati_in} ) AND p.post_type IN ( {$open_types_in} ) THEN 0 ELSE p.ID END AS post_id,
				COUNT(*) AS n
			FROM {$wpdb->posts} r
			INNER JOIN {$wpdb->posts} p ON r.post_parent = p.ID
			WHERE r.post_author = %d
				AND r.post_type = 'revision'
				AND r.post_status = 'inherit'
				AND (
					( p.post_date_gmt <> '0000-00-00 00:00:00' AND r.post_date_gmt > p.post_date_gmt )
					OR EXISTS (
						SELECT 1 FROM {$wpdb->posts} r0
						WHERE r0.post_parent = p.ID AND r0.post_type = 'revision' AND r0.ID < r.ID
					)
				)
			GROUP BY post_id",
			array_merge( $open_args, array( $user_id ) )
		),
		ARRAY_A
	);
	$totals_updates = openstation_my_wordpress_footprint_visible_counts( $update_totals, false, $verdicts )['total'];
	$month_row      = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT DATE_FORMAT(post_date_gmt, '%%Y-%%m') AS ym, COUNT(*) AS n
			FROM {$wpdb->posts}
			WHERE post_author = %d
				AND post_status = 'publish'
				AND post_type IN ( 'post', 'page' )
			GROUP BY ym
			ORDER BY n DESC
			LIMIT 1",
			$user_id
		),
		ARRAY_A
	);
	$totals         = array(
		'posts'    => $totals_posts,
		'pages'    => $totals_pages,
		'comments' => $totals_comments,
		'updates'  => $totals_updates,
	);
	if ( $month_row && isset( $month_row['ym'] ) ) {
		$totals['mostProlificMonth'] = array(
			'ym' => (string) $month_row['ym'],
			'n'  => (int) $month_row['n'],
		);
	}

	$payload = array(
		'profile'  => $profile,
		'range'    => $range,
		'daily'    => $daily,
		'weekday'  => $weekday,
		'hour'     => $hour,
		'streak'   => $streak,
		'timeline' => $timeline,
		'totals'   => $totals,
	);

	return apply_filters( 'openstation_my_wordpress_user_footprint', $payload, $user_id );
}
