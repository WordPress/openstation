<?php
/**
 * OpenStation — My WordPress: per-user stats endpoint.
 *
 * `GET /desktop-mode/v1/user-stats/<id>` returns an aggregated
 * profile + activity blob for the requested user. The right
 * preview pane in the My WordPress folder uses it to paint a rich
 * dossier (post / page / comment counts, recent posts, top
 * categories, role + member-since) without forcing the client to
 * make N parallel REST calls.
 *
 * Permissions: anyone with `list_users` — or the subject user
 * viewing their own dossier — sees full data; everyone else sees
 * the public subset (display name, avatar, post archive link,
 * published-only counts and recent posts). Sensitive fields
 * (email, registered date, role) are gated on the cap.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the route.
 */
function openstation_my_wordpress_register_user_stats_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/user-stats/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_my_wordpress_user_stats_callback',
			'permission_callback' => static function () {
				// Logged-in users only — author archives are public,
				// but the dossier mixes counts that aren't.
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
add_action( 'rest_api_init', 'openstation_my_wordpress_register_user_stats_route' );

/**
 * Aggregator callback. Returns the dossier shape (see file
 * docblock above for fields).
 *
 * @param WP_REST_Request $request REST request.
 * @return array|WP_Error
 */
function openstation_my_wordpress_user_stats_callback( $request ) {
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

	$can_see_private = current_user_can( 'list_users' )
		|| ( get_current_user_id() === $user_id );

	// ----- Profile -----------------------------------------------------
	$profile = array(
		'id'          => (int) $user->ID,
		'name'        => $user->display_name,
		'description' => (string) $user->description,
		'link'        => get_author_posts_url( $user->ID ),
		'website'     => esc_url_raw( $user->user_url ),
		'avatarUrl'   => get_avatar_url( $user->ID, array( 'size' => 192 ) ),
	);
	if ( $can_see_private ) {
		$profile['email']      = $user->user_email;
		$profile['username']   = $user->user_login;
		$profile['registered'] = mysql2date( 'c', $user->user_registered, false );
		$profile['roles']      = array_values( (array) $user->roles );
		$role_labels           = array();
		if ( function_exists( 'wp_roles' ) ) {
			$wp_roles = wp_roles();
			foreach ( (array) $user->roles as $slug ) {
				$role_labels[] = isset( $wp_roles->role_names[ $slug ] )
					? translate_user_role( $wp_roles->role_names[ $slug ] )
					: $slug;
			}
		}
		$profile['roleLabels'] = $role_labels;
	}

	// ----- Counts ------------------------------------------------------
	// Posts (the post type) by status.
	$post_status_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT post_status, COUNT(*) AS n
			FROM {$wpdb->posts}
			WHERE post_author = %d
				AND post_type = 'post'
				AND post_status NOT IN ( 'auto-draft', 'inherit', 'trash' )
			GROUP BY post_status",
			$user_id
		),
		ARRAY_A
	);
	$post_counts = array(
		'publish' => 0,
		'draft'   => 0,
		'pending' => 0,
		'private' => 0,
		'future'  => 0,
		'total'   => 0,
	);
	foreach ( (array) $post_status_rows as $row ) {
		$status                 = (string) $row['post_status'];
		$n                      = (int) $row['n'];
		$post_counts['total']  += $n;
		if ( isset( $post_counts[ $status ] ) ) {
			$post_counts[ $status ] = $n;
		}
	}

	// Pages by status.
	$page_status_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT post_status, COUNT(*) AS n
			FROM {$wpdb->posts}
			WHERE post_author = %d
				AND post_type = 'page'
				AND post_status NOT IN ( 'auto-draft', 'inherit', 'trash' )
			GROUP BY post_status",
			$user_id
		),
		ARRAY_A
	);
	$page_counts = array(
		'publish' => 0,
		'draft'   => 0,
		'total'   => 0,
	);
	foreach ( (array) $page_status_rows as $row ) {
		$status                 = (string) $row['post_status'];
		$n                      = (int) $row['n'];
		$page_counts['total']  += $n;
		if ( isset( $page_counts[ $status ] ) ) {
			$page_counts[ $status ] = $n;
		}
	}

	if ( ! $can_see_private ) {
		// Viewers without `list_users` (and who aren't the subject)
		// only get published counts — see the permissions note in
		// the file docblock.
		$post_counts = array(
			'publish' => $post_counts['publish'],
			'total'   => $post_counts['publish'],
		);
		$page_counts = array(
			'publish' => $page_counts['publish'],
			'total'   => $page_counts['publish'],
		);
	}

	// Comments received on posts authored by this user, approved only.
	// Non-privileged viewers only see engagement on published content.
	$received_status_sql = $can_see_private
		? "p.post_status NOT IN ( 'auto-draft', 'trash' )"
		: "p.post_status = 'publish'";
	$comments_received   = (int) $wpdb->get_var(
		$wpdb->prepare(
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- literal status clause chosen above.
			"SELECT COUNT(c.comment_ID)
			FROM {$wpdb->comments} c
			INNER JOIN {$wpdb->posts} p ON c.comment_post_ID = p.ID
			WHERE p.post_author = %d
				AND c.comment_approved = '1'
				AND {$received_status_sql}",
			$user_id
		)
	);

	// Comments left BY this user (regardless of post author).
	$comments_left = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*)
			FROM {$wpdb->comments}
			WHERE user_id = %d
				AND comment_approved = '1'",
			$user_id
		)
	);

	// Total content (posts + pages + any custom public post types).
	// Same gating as above: published-only unless privileged.
	$cpt_status_sql = $can_see_private
		? "post_status NOT IN ( 'auto-draft', 'inherit', 'trash' )"
		: "post_status = 'publish'";
	$cpt_count      = (int) $wpdb->get_var(
		$wpdb->prepare(
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- literal status clause chosen above.
			"SELECT COUNT(*)
			FROM {$wpdb->posts}
			WHERE post_author = %d
				AND post_type NOT IN ( 'post', 'page', 'attachment', 'revision', 'nav_menu_item' )
				AND {$cpt_status_sql}",
			$user_id
		)
	);

	$counts = array(
		'posts'            => $post_counts,
		'pages'            => $page_counts,
		'commentsReceived' => $comments_received,
		'commentsLeft'     => $comments_left,
		'cpt'              => $cpt_count,
	);

	// ----- Recent posts (latest 5) -------------------------------------
	// Privileged viewers also see private/scheduled/draft/pending;
	// everyone else gets published posts only.
	$recent_posts = get_posts(
		array(
			'author'           => $user_id,
			'post_type'        => array( 'post', 'page' ),
			'post_status'      => $can_see_private
				? array( 'publish', 'private', 'future', 'draft', 'pending' )
				: array( 'publish' ),
			'posts_per_page'   => 5,
			'orderby'          => 'date',
			'order'            => 'DESC',
			'suppress_filters' => false,
		)
	);
	$recent = array();
	foreach ( (array) $recent_posts as $p ) {
		if ( ! ( $p instanceof WP_Post ) ) {
			continue;
		}
		$recent[] = array(
			'id'     => (int) $p->ID,
			'title'  => get_the_title( $p ),
			'date'   => mysql2date( 'c', $p->post_date_gmt, false ),
			'status' => (string) $p->post_status,
			'type'   => (string) $p->post_type,
			'link'   => get_permalink( $p ),
		);
	}

	// ----- Top categories (most used by this author) -------------------
	$top_term_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT t.term_id, t.name, t.slug, tt.taxonomy, COUNT(*) AS n
			FROM {$wpdb->term_relationships} tr
			INNER JOIN {$wpdb->term_taxonomy} tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
			INNER JOIN {$wpdb->terms} t ON tt.term_id = t.term_id
			INNER JOIN {$wpdb->posts} p ON tr.object_id = p.ID
			WHERE p.post_author = %d
				AND p.post_type = 'post'
				AND p.post_status = 'publish'
				AND tt.taxonomy IN ( 'category', 'post_tag' )
			GROUP BY t.term_id, tt.taxonomy
			ORDER BY n DESC
			LIMIT 5",
			$user_id
		),
		ARRAY_A
	);
	$top_terms = array();
	foreach ( (array) $top_term_rows as $row ) {
		$top_terms[] = array(
			'id'       => (int) $row['term_id'],
			'name'     => (string) $row['name'],
			'slug'     => (string) $row['slug'],
			'taxonomy' => (string) $row['taxonomy'],
			'count'    => (int) $row['n'],
		);
	}

	// ----- Activity (posts published per month, last 12 months) --------
	// Lightweight sparkline source. Exclude trash + auto-draft, group by
	// year-month so the JS can fill gaps.
	$activity_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT DATE_FORMAT( post_date_gmt, '%%Y-%%m' ) AS ym, COUNT(*) AS n
			FROM {$wpdb->posts}
			WHERE post_author = %d
				AND post_type IN ( 'post', 'page' )
				AND post_status = 'publish'
				AND post_date_gmt >= DATE_SUB( NOW(), INTERVAL 12 MONTH )
			GROUP BY ym
			ORDER BY ym ASC",
			$user_id
		),
		ARRAY_A
	);
	$activity = array();
	foreach ( (array) $activity_rows as $row ) {
		$activity[] = array(
			'ym'    => (string) $row['ym'],
			'count' => (int) $row['n'],
		);
	}

	// ----- First & last published --------------------------------------
	// (Streak math lives in the separate user-footprint endpoint.)
	$first_post = $wpdb->get_var(
		$wpdb->prepare(
			"SELECT MIN(post_date_gmt) FROM {$wpdb->posts}
			WHERE post_author = %d AND post_type IN ( 'post', 'page' ) AND post_status = 'publish'",
			$user_id
		)
	);
	$last_post = $wpdb->get_var(
		$wpdb->prepare(
			"SELECT MAX(post_date_gmt) FROM {$wpdb->posts}
			WHERE post_author = %d AND post_type IN ( 'post', 'page' ) AND post_status = 'publish'",
			$user_id
		)
	);
	$milestones = array(
		'firstPublished' => $first_post ? mysql2date( 'c', $first_post, false ) : null,
		'lastPublished'  => $last_post ? mysql2date( 'c', $last_post, false ) : null,
	);

	$payload = array(
		'profile'    => $profile,
		'counts'     => $counts,
		'recent'     => $recent,
		'topTerms'   => $top_terms,
		'activity'   => $activity,
		'milestones' => $milestones,
	);

	/**
	 * Filter the per-user stats payload before it's returned to
	 * the My WordPress folder window. Plugins can drop additional
	 * stat sections (badges, milestones, contribution streaks)
	 * here without forking the JS render.
	 *
	 * @param array $payload Stats payload.
	 * @param int   $user_id Subject user id.
	 */
	return apply_filters( 'openstation_my_wordpress_user_stats', $payload, $user_id );
}
