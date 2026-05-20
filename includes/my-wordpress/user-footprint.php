<?php
/**
 * Desktop Mode — My WordPress: per-user activity footprint endpoint.
 *
 * `GET /desktop-mode/v1/user-footprint/<id>` returns a deep activity
 * footprint for one user: a year of day-by-day publishing counts
 * (GitHub-style calendar heatmap), weekday and hour-of-day
 * distribution (publishing rhythm), longest publishing streak, and
 * a recent-events timeline (posts published + comments left, last
 * 30). The right-click "View activity footprint" action in the My
 * WordPress users folder paints from this single payload.
 *
 * Permission: any logged-in user (the dossier route already has
 * the same gate). Sensitive fields (email, IP) are NOT returned
 * from this endpoint — `user-stats.php` carries those for the
 * preview pane, and the footprint focuses on activity patterns.
 *
 * Payload shape:
 *
 *   {
 *     profile: { id, name, avatarUrl, link, roleLabels?, registered? },
 *     range:   { from, to, days },                              // YYYY-MM-DD bookends + day count
 *     daily:   [ { date, posts, comments, updates } ],         // length = range.days; missing days = 0
 *     weekday: [ 0..6 ],                                       // post counts, Sunday-indexed
 *     hour:    [ 0..23 ],                                      // post counts, server-local hour
 *     streak:  { longest, current, longestRange:{ from, to } },
 *     timeline:[                                               // 30 most recent activity rows
 *       { kind:'post'|'comment'|'post-update', date, title, link, status, postId? }
 *     ],
 *     totals:  { posts, pages, comments, updates, mostProlificMonth?:{ ym, n } }
 *   }
 *
 * "Updates" are revisions saved by the user AFTER a post's original
 * creation — i.e. the user opened an existing post and saved it
 * again. The initial save (which WordPress also writes as a revision)
 * is excluded so the per-day "updates" count doesn't double up with
 * the per-day "posts" count.
 *
 * @package WPDesktopMode
 * @since   0.20.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the route.
 *
 * @since 0.20.0
 */
function desktop_mode_my_wordpress_register_user_footprint_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/user-footprint/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'desktop_mode_my_wordpress_user_footprint_callback',
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
add_action( 'rest_api_init', 'desktop_mode_my_wordpress_register_user_footprint_route' );

/**
 * Aggregator callback. See the file docblock for the payload shape.
 *
 * @since 0.20.0
 *
 * @param WP_REST_Request $request REST request.
 * @return array|WP_Error
 */
function desktop_mode_my_wordpress_user_footprint_callback( $request ) {
	global $wpdb;

	$user_id = (int) $request->get_param( 'id' );
	$user    = get_userdata( $user_id );
	if ( ! $user ) {
		return new WP_Error(
			'desktop_mode_user_not_found',
			__( 'User not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$can_see_private = current_user_can( 'list_users' )
		|| ( get_current_user_id() === $user_id );

	// ---- Profile (minimal — the dossier already returned the full one) ----
	$profile = array(
		'id'        => (int) $user->ID,
		'name'      => (string) $user->display_name,
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

	// ---- Range: rolling 365-day window ending today (UTC bookends) -------
	$days = 365;
	$now  = current_time( 'timestamp', true ); // UTC
	$from_ts = strtotime( '-' . ( $days - 1 ) . ' days', $now );
	$to_ts   = $now;
	$range = array(
		'from' => gmdate( 'Y-m-d', $from_ts ),
		'to'   => gmdate( 'Y-m-d', $to_ts ),
		'days' => $days,
	);

	// ---- Daily counts (posts published per day + comments LEFT per day) --
	// Two queries (one for posts, one for comments), each grouped by
	// `DATE(post_date_gmt)` / `DATE(comment_date_gmt)`. Then we
	// densify to a full day-by-day array so the heatmap renders
	// every cell, even empty ones.
	$post_rows = $wpdb->get_results(
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

	$comment_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT DATE(comment_date_gmt) AS d, COUNT(*) AS n
			FROM {$wpdb->comments}
			WHERE user_id = %d
				AND comment_approved = '1'
				AND comment_date_gmt >= %s
			GROUP BY d
			ORDER BY d ASC",
			$user_id,
			gmdate( 'Y-m-d 00:00:00', $from_ts )
		),
		ARRAY_A
	);
	$comment_by_day = array();
	foreach ( (array) $comment_rows as $row ) {
		$comment_by_day[ (string) $row['d'] ] = (int) $row['n'];
	}

	// Updates = revisions saved by this user, joined back to the
	// parent post so we can skip the initial-save revision (where the
	// revision's `post_date_gmt` equals the parent's `post_date_gmt`).
	// `r.post_author` (not the parent's) tracks who hit Save, so
	// updates an editor makes to someone else's post show up on the
	// editor's footprint — same shape GitHub's contribution graph
	// uses for commits across repos you don't own.
	$update_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT DATE(r.post_date_gmt) AS d, COUNT(*) AS n
			FROM {$wpdb->posts} r
			INNER JOIN {$wpdb->posts} p ON r.post_parent = p.ID
			WHERE r.post_author = %d
				AND r.post_type = 'revision'
				AND r.post_status = 'inherit'
				AND r.post_date_gmt > p.post_date_gmt
				AND r.post_date_gmt >= %s
			GROUP BY d
			ORDER BY d ASC",
			$user_id,
			gmdate( 'Y-m-d 00:00:00', $from_ts )
		),
		ARRAY_A
	);
	$update_by_day = array();
	foreach ( (array) $update_rows as $row ) {
		$update_by_day[ (string) $row['d'] ] = (int) $row['n'];
	}

	$daily = array();
	for ( $i = 0; $i < $days; $i += 1 ) {
		$ts   = strtotime( '+' . $i . ' days', $from_ts );
		$date = gmdate( 'Y-m-d', $ts );
		$daily[] = array(
			'date'     => $date,
			'posts'    => isset( $post_by_day[ $date ] ) ? $post_by_day[ $date ] : 0,
			'comments' => isset( $comment_by_day[ $date ] ) ? $comment_by_day[ $date ] : 0,
			'updates'  => isset( $update_by_day[ $date ] ) ? $update_by_day[ $date ] : 0,
		);
	}

	// ---- Weekday distribution (Sunday-indexed) ---------------------------
	// `DAYOFWEEK` returns 1=Sunday through 7=Saturday in MySQL.
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
	$weekday = array( 0, 0, 0, 0, 0, 0, 0 );
	foreach ( (array) $weekday_rows as $row ) {
		$dow = (int) $row['dow'];
		if ( $dow >= 1 && $dow <= 7 ) {
			$weekday[ $dow - 1 ] = (int) $row['n'];
		}
	}

	// ---- Hour-of-day distribution (0..23, site timezone) -----------------
	// `post_date` is already in site timezone — that's the timestamp
	// the author saw when they hit Publish. Using GMT here would shift
	// the bars by the offset and feel wrong to anyone in a non-UTC tz.
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
	$hour = array_fill( 0, 24, 0 );
	foreach ( (array) $hour_rows as $row ) {
		$h = (int) $row['h'];
		if ( $h >= 0 && $h <= 23 ) {
			$hour[ $h ] = (int) $row['n'];
		}
	}

	// ---- Streak (longest consecutive run of days with ≥1 post over the
	// 365-day window; current run ending today). ------------------------
	$longest         = 0;
	$current         = 0;
	$longest_run     = 0;
	$longest_from    = '';
	$longest_to      = '';
	$run_start       = '';
	$today_str       = $range['to'];
	$prev_day_active = false;

	// "Active" = published a post, left a comment, or saved a revision.
	// Pre-0.8.7 this only counted publish days, so an editor doing
	// daily updates without new posts had a "0 day" streak — wrong
	// flavour of GitHub-style for a CMS where most work is editing.
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
			$longest_run += 1;
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
	// Current streak — walk backward from today.
	for ( $i = count( $daily ) - 1; $i >= 0; $i -= 1 ) {
		if ( $is_active( $daily[ $i ] ) ) {
			$current += 1;
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

	// ---- Timeline: 30 most recent posts + comments, interleaved by date -
	// One query per kind, then merge + sort + slice in PHP. Smaller and
	// simpler than a SQL `UNION ALL`, and each branch already has the
	// right index.
	$timeline_posts = $wpdb->get_results(
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
				p.post_title
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
	// Recent updates — newest revision per parent post saved by this
	// user. We collapse per-parent (`GROUP BY r.post_parent`) so a
	// burst of saves on one post reads as one row in the activity
	// list (otherwise an editor polishing a single article would push
	// every other event off the screen). The MAX(r.post_date_gmt)
	// surfaces the most recent save as the row's timestamp.
	$timeline_updates = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT r.post_parent AS parent_id, MAX(r.post_date_gmt) AS last_save, p.post_title, p.post_status, p.post_type
			FROM {$wpdb->posts} r
			INNER JOIN {$wpdb->posts} p ON r.post_parent = p.ID
			WHERE r.post_author = %d
				AND r.post_type = 'revision'
				AND r.post_status = 'inherit'
				AND r.post_date_gmt > p.post_date_gmt
				AND p.post_status NOT IN ( 'auto-draft', 'inherit', 'trash' )
			GROUP BY r.post_parent
			ORDER BY last_save DESC
			LIMIT 30",
			$user_id
		),
		ARRAY_A
	);
	$timeline = array();
	foreach ( (array) $timeline_posts as $p ) {
		$pid = (int) $p['ID'];
		$timeline[] = array(
			'kind'   => 'post',
			'date'   => mysql2date( 'c', $p['post_date_gmt'], false ),
			'title'  => (string) $p['post_title'],
			'status' => (string) $p['post_status'],
			'postId' => $pid,
			'link'   => (string) get_permalink( $pid ),
			'type'   => (string) $p['post_type'],
		);
	}
	foreach ( (array) $timeline_comments as $c ) {
		$pid = (int) $c['comment_post_ID'];
		$timeline[] = array(
			'kind'   => 'comment',
			'date'   => mysql2date( 'c', $c['comment_date_gmt'], false ),
			'title'  => (string) ( $c['post_title'] ?? '' ),
			'status' => 'approved',
			'postId' => $pid,
			'link'   => $pid ? (string) get_permalink( $pid ) : '',
		);
	}
	foreach ( (array) $timeline_updates as $u ) {
		$pid = (int) $u['parent_id'];
		$timeline[] = array(
			'kind'   => 'post-update',
			'date'   => mysql2date( 'c', $u['last_save'], false ),
			'title'  => (string) $u['post_title'],
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

	// ---- Totals + most-prolific month -----------------------------------
	$totals_posts = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM {$wpdb->posts}
			WHERE post_author = %d
				AND post_type = 'post'
				AND post_status NOT IN ( 'auto-draft', 'inherit', 'trash' )",
			$user_id
		)
	);
	$totals_pages = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM {$wpdb->posts}
			WHERE post_author = %d
				AND post_type = 'page'
				AND post_status NOT IN ( 'auto-draft', 'inherit', 'trash' )",
			$user_id
		)
	);
	$totals_comments = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM {$wpdb->comments}
			WHERE user_id = %d AND comment_approved = '1'",
			$user_id
		)
	);
	// Lifetime updates = revisions this user saved after the initial
	// creation of the parent post. Matches the per-day `updates`
	// definition so the hero stat and heatmap rollups agree.
	$totals_updates = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM {$wpdb->posts} r
			INNER JOIN {$wpdb->posts} p ON r.post_parent = p.ID
			WHERE r.post_author = %d
				AND r.post_type = 'revision'
				AND r.post_status = 'inherit'
				AND r.post_date_gmt > p.post_date_gmt",
			$user_id
		)
	);
	$month_row = $wpdb->get_row(
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
	$totals = array(
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

	/**
	 * Filter the per-user footprint payload before it's returned to
	 * the My WordPress folder window. Plugins can extend the timeline
	 * with their own activity rows, or replace the streak math with
	 * something domain-specific.
	 *
	 * @since 0.20.0
	 *
	 * @param array $payload Footprint payload.
	 * @param int   $user_id Subject user id.
	 */
	return apply_filters( 'desktop_mode_my_wordpress_user_footprint', $payload, $user_id );
}
