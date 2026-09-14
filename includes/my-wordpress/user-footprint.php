<?php
/**
 * OpenStation — My WordPress: per-user activity footprint endpoint.
 *
 * `GET /desktop-mode/v1/user-footprint/<id>` returns a deep activity
 * footprint for one user: a year of day-by-day publishing counts
 * (GitHub-style calendar heatmap), weekday and hour-of-day
 * distribution (publishing rhythm), longest publishing streak, and
 * a recent-events timeline (posts published + comments left, last
 * 30). The right-click "View activity footprint" action in the My
 * WordPress users folder paints from this single payload.
 *
 * Permission: any logged-in user. `list_users` (or the subject
 * viewing their own footprint) only decides the profile fields
 * (`roleLabels`, `registered`), the same split `user-stats.php`
 * uses. Sensitive fields (email, IP) are NOT returned from this
 * endpoint: `user-stats.php` carries those for the preview pane, and
 * the footprint focuses on activity patterns.
 *
 * **Activity is gated per post, and a count is gated exactly like
 * the rows it summarises.** A timeline row is emitted only when
 * `openstation_my_wordpress_footprint_can_see_post()` lets the viewer
 * see its post: a public status of a viewable type for everyone,
 * `read_post` for any other status, `edit_post` for a type with no
 * readable front end, and the comment dossier's parent gate for
 * comment rows (a password-protected parent needs `edit_post`, a
 * deleted one `moderate_comments`). The counts that can reach those
 * same posts (`totals.posts`, `totals.pages`, `totals.comments`,
 * `totals.updates`, and each day's `comments` and `updates`, which
 * the streak reads) group their rows by everything that gate reads
 * and ask it once per group. So a Subscriber's heatmap and hero
 * stats cannot report, as numbers, the drafts, private edits or
 * internal records the timeline withholds, and an Editor's totals
 * include the drafts their timeline lists. The remaining aggregates
 * (`daily[].posts`, `weekday`, `hour`, `mostProlificMonth`) count
 * published posts and pages only. The payload is viewer-dependent:
 * never cache it under a subject-only key.
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
 *       { kind:'post'|'comment'|'post-update', date, title, link, status, postId?, type? }
 *     ],
 *     totals:  { posts, pages, comments, updates, mostProlificMonth?:{ ym, n } }
 *   }
 *
 * Timeline row fields:
 * - `kind`   — discriminator: `'post'` (publish), `'comment'`, or
 *              `'post-update'` (revision rollup).
 * - `type`   — only set when `kind` is `'post'` or `'post-update'`.
 *              Carries the post's CPT slug (`'post'`, `'page'`, custom
 *              types) so the renderer can pick a Post-vs-Page icon
 *              without a second REST lookup.
 *
 * "Updates" are revisions saved by the user AFTER a post's original
 * creation, i.e. the user opened an existing post and saved it
 * again. The initial save (which WordPress also writes as a revision)
 * is excluded so the per-day "updates" count doesn't double up with
 * the per-day "posts" count. On a dated post that means every
 * revision newer than the post's date. A draft or pending post has
 * no date yet (`post_date_gmt` stays zero until it is published or
 * scheduled), so there it means every revision after the post's
 * first one.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the route.
 */
function openstation_my_wordpress_register_user_footprint_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/user-footprint/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_my_wordpress_user_footprint_callback',
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
add_action( 'rest_api_init', 'openstation_my_wordpress_register_user_footprint_route' );

/**
 * Whether the current user may see footprint activity on a post.
 *
 * One gate for the timeline rows and for the counts that summarise
 * them (see openstation_my_wordpress_footprint_visible_counts()), so
 * the two cannot disagree about what a viewer is allowed to know.
 *
 * - A comment's parent goes through
 *   openstation_my_wordpress_can_read_comment_post(), the comment
 *   dossier's gate: an orphaned comment is moderators-only, and a
 *   password-protected or non-viewable parent needs `edit_post`.
 * - Any other post of a type with no readable front end needs
 *   `edit_post`. Core resolves `read_post` on a published post of such
 *   a type to plain `read`, which every logged-in user holds, so it
 *   would read like public content.
 * - A viewable post in a public status is public already.
 * - Anything else is `read_post`, which resolves per status: the
 *   post's author always, `read_private_posts` for a private post, and
 *   `edit_others_posts` for drafts, pending and scheduled posts.
 *
 * Core answers a post of an unregistered type or status with
 * `edit_others_posts`, after a `_doing_it_wrong()` notice. Rows a
 * deactivated plugin left behind get the same answer here, without
 * the notice.
 *
 * @param WP_Post|null $post        The post, or null when it no longer exists.
 * @param bool         $for_comment Whether the activity is a comment on the post.
 * @return bool
 */
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

/**
 * Sum grouped activity counts, keeping only the groups the viewer may see.
 *
 * A count query cannot run a capability check per row, so each one
 * groups its rows by everything the gate above reads (the post's type
 * and status, whether the viewer wrote it as `own` and, for comments,
 * its password) and names one post from each group as `rep`. Core's
 * capability mapping gives every post in a group the same answer, so
 * the gate runs once per distinct group, on that post. A plugin that
 * filters `map_meta_cap` on something else about a single post is
 * honoured by the timeline rows and approximated here.
 *
 * @param array[]|null $rows        Rows carrying `post_type`, `post_status`, `own`, `rep` and `n`,
 *                                  plus `post_password` for comments and `d` (Y-m-d) per day.
 * @param bool         $for_comment Whether the rows count comments on the grouped posts.
 * @return array{ total: int, by_day: array<string, int> }
 */
function openstation_my_wordpress_footprint_visible_counts( $rows, $for_comment = false ) {
	$verdicts = array();
	$total    = 0;
	$by_day   = array();
	foreach ( (array) $rows as $row ) {
		$key = implode(
			"\0",
			array(
				(string) $row['post_type'],
				(string) $row['post_status'],
				(string) $row['own'],
				$for_comment ? (string) $row['post_password'] : '',
			)
		);
		if ( ! isset( $verdicts[ $key ] ) ) {
			$rep              = (int) $row['rep'];
			$verdicts[ $key ] = openstation_my_wordpress_footprint_can_see_post( $rep > 0 ? get_post( $rep ) : null, $for_comment );
		}
		if ( ! $verdicts[ $key ] ) {
			continue;
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

/**
 * Aggregator callback. See the file docblock for the payload shape.
 *
 * @param WP_REST_Request $request REST request.
 * @return array|WP_Error
 */
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
	$days    = 365;
	$now     = time(); // UTC
	$from_ts = strtotime( '-' . ( $days - 1 ) . ' days', $now );
	$to_ts   = $now;
	$range   = array(
		'from' => gmdate( 'Y-m-d', $from_ts ),
		'to'   => gmdate( 'Y-m-d', $to_ts ),
		'days' => $days,
	);

	// ---- Daily counts (posts published, comments LEFT, updates saved) ----
	// One query per kind, each grouped by `DATE(post_date_gmt)` /
	// `DATE(comment_date_gmt)`. Then we densify to a full day-by-day
	// array so the heatmap renders every cell, even empty ones.
	//
	// Posts are published posts and pages, which anyone may see. A
	// comment or an update can land on a post the viewer may not read,
	// so those two queries also group by what the timeline's per-row
	// gate reads, and the groups it refuses are dropped: a heatmap cell
	// must not report "this user commented on, or edited, something
	// private on Tuesday" when the timeline withholds the row saying so.
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
			"SELECT DATE(c.comment_date_gmt) AS d, p.post_type, p.post_status, p.post_password,
				( p.post_author = %d ) AS own, MIN(p.ID) AS rep, COUNT(*) AS n
			FROM {$wpdb->comments} c
			LEFT JOIN {$wpdb->posts} p ON c.comment_post_ID = p.ID
			WHERE c.user_id = %d
				AND c.comment_approved = '1'
				AND c.comment_date_gmt >= %s
			GROUP BY d, p.post_type, p.post_status, p.post_password, own
			ORDER BY d ASC",
			$viewer_id,
			$user_id,
			gmdate( 'Y-m-d 00:00:00', $from_ts )
		),
		ARRAY_A
	);
	$comment_by_day = openstation_my_wordpress_footprint_visible_counts( $comment_rows, true )['by_day'];

	// Updates = revisions saved by this user, joined back to the parent
	// post so we can skip the initial-save revision. `r.post_author`
	// (not the parent's) tracks who hit Save, so updates an editor makes
	// to someone else's post show up on the editor's footprint, the same
	// shape GitHub's contribution graph uses for commits across repos you
	// don't own.
	//
	// "Not the initial save" is a date test on a dated post: the revision
	// is newer than the post. A draft or pending post has no date yet
	// (`post_date_gmt` stays zero until it is published or scheduled), so
	// every revision would pass, the very first Save Draft included.
	// There it means "not the post's first revision" instead. The lifetime
	// count and the timeline query below carry the same clause; keep the
	// three in step.
	$update_rows   = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT DATE(r.post_date_gmt) AS d, p.post_type, p.post_status,
				( p.post_author = %d ) AS own, MIN(p.ID) AS rep, COUNT(*) AS n
			FROM {$wpdb->posts} r
			INNER JOIN {$wpdb->posts} p ON r.post_parent = p.ID
			WHERE r.post_author = %d
				AND r.post_type = 'revision'
				AND r.post_status = 'inherit'
				AND (
					( p.post_date_gmt <> '0000-00-00 00:00:00' AND r.post_date_gmt > p.post_date_gmt )
					OR ( p.post_date_gmt = '0000-00-00 00:00:00' AND EXISTS (
						SELECT 1 FROM {$wpdb->posts} r0
						WHERE r0.post_parent = p.ID AND r0.post_type = 'revision' AND r0.ID < r.ID
					) )
				)
				AND r.post_date_gmt >= %s
			GROUP BY d, p.post_type, p.post_status, own
			ORDER BY d ASC",
			$viewer_id,
			$user_id,
			gmdate( 'Y-m-d 00:00:00', $from_ts )
		),
		ARRAY_A
	);
	$update_by_day = openstation_my_wordpress_footprint_visible_counts( $update_rows )['by_day'];

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
	$weekday      = array( 0, 0, 0, 0, 0, 0, 0 );
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
	$hour      = array_fill( 0, 24, 0 );
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
	// Current streak — walk backward from today.
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

	// ---- Timeline: 30 most recent posts + comments, interleaved by date -
	// One query per kind, then merge + sort + slice in PHP. Smaller and
	// simpler than a SQL `UNION ALL`, and each branch already has the
	// right index.
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
				AND (
					( p.post_date_gmt <> '0000-00-00 00:00:00' AND r.post_date_gmt > p.post_date_gmt )
					OR ( p.post_date_gmt = '0000-00-00 00:00:00' AND EXISTS (
						SELECT 1 FROM {$wpdb->posts} r0
						WHERE r0.post_parent = p.ID AND r0.post_type = 'revision' AND r0.ID < r.ID
					) )
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
	// Per-row gate: openstation_my_wordpress_footprint_can_see_post(), the
	// same one the counts above ask. Rows for non-published posts (draft,
	// pending, private, future, ...) carry titles the viewer may not be
	// allowed to see, and so do published rows of a type with no readable
	// front end and a comment's password-protected or deleted parent.
	// Authors and editors keep their full timeline, while ordinary
	// logged-in users only see published, viewable work.
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
		// Bulk-warm the post cache: the gate and get_permalink() read from it.
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
			'title'  => (string) $p['post_title'],
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
			'title'  => (string) ( $c['post_title'] ?? '' ),
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
	// Lifetime counts, each grouped for the timeline's per-row gate. Posts
	// and pages cover every non-internal status the viewer may read, so a
	// Subscriber gets published work only and cannot read how many
	// drafts, pending, private and scheduled posts another user is sitting
	// on (or watch that number move), while an Editor, whose timeline
	// lists those drafts, gets them counted too.
	$content_rows    = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT post_type, post_status, ( post_author = %d ) AS own, MIN(ID) AS rep, COUNT(*) AS n
			FROM {$wpdb->posts}
			WHERE post_author = %d
				AND post_type IN ( 'post', 'page' )
				AND post_status NOT IN ( 'auto-draft', 'inherit', 'trash' )
			GROUP BY post_type, post_status, own",
			$viewer_id,
			$user_id
		),
		ARRAY_A
	);
	$totals_posts    = openstation_my_wordpress_footprint_visible_counts(
		wp_list_filter( (array) $content_rows, array( 'post_type' => 'post' ) )
	)['total'];
	$totals_pages    = openstation_my_wordpress_footprint_visible_counts(
		wp_list_filter( (array) $content_rows, array( 'post_type' => 'page' ) )
	)['total'];
	$comment_totals  = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT p.post_type, p.post_status, p.post_password,
				( p.post_author = %d ) AS own, MIN(p.ID) AS rep, COUNT(*) AS n
			FROM {$wpdb->comments} c
			LEFT JOIN {$wpdb->posts} p ON c.comment_post_ID = p.ID
			WHERE c.user_id = %d
				AND c.comment_approved = '1'
			GROUP BY p.post_type, p.post_status, p.post_password, own",
			$viewer_id,
			$user_id
		),
		ARRAY_A
	);
	$totals_comments = openstation_my_wordpress_footprint_visible_counts( $comment_totals, true )['total'];
	// Lifetime updates = revisions this user saved after the initial
	// creation of the parent post. Matches the per-day `updates`
	// definition so the hero stat and heatmap rollups agree.
	$update_totals  = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT p.post_type, p.post_status,
				( p.post_author = %d ) AS own, MIN(p.ID) AS rep, COUNT(*) AS n
			FROM {$wpdb->posts} r
			INNER JOIN {$wpdb->posts} p ON r.post_parent = p.ID
			WHERE r.post_author = %d
				AND r.post_type = 'revision'
				AND r.post_status = 'inherit'
				AND (
					( p.post_date_gmt <> '0000-00-00 00:00:00' AND r.post_date_gmt > p.post_date_gmt )
					OR ( p.post_date_gmt = '0000-00-00 00:00:00' AND EXISTS (
						SELECT 1 FROM {$wpdb->posts} r0
						WHERE r0.post_parent = p.ID AND r0.post_type = 'revision' AND r0.ID < r.ID
					) )
				)
			GROUP BY p.post_type, p.post_status, own",
			$viewer_id,
			$user_id
		),
		ARRAY_A
	);
	$totals_updates = openstation_my_wordpress_footprint_visible_counts( $update_totals )['total'];
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

	/**
	 * Filter the per-user footprint payload before it's returned to
	 * the My WordPress folder window. Plugins can extend the timeline
	 * with their own activity rows, or replace the streak math with
	 * something domain-specific.
	 *
	 * @param array $payload Footprint payload.
	 * @param int   $user_id Subject user id.
	 */
	return apply_filters( 'openstation_my_wordpress_user_footprint', $payload, $user_id );
}
