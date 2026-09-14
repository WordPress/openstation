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
 * Permissions: the My WordPress module's gate,
 * `openstation_my_wordpress_user_can_use()` (`edit_posts` unless a site
 * filters it), so a site that narrows WP Explorer narrows this data
 * with it. Past that gate, anyone with `list_users` (or the subject
 * user viewing their own dossier) sees full data; everyone else sees
 * the public subset (display name, avatar, post archive link,
 * published-only counts and recent posts). Sensitive fields (email,
 * registered date, role) are gated on the cap.
 *
 * For the unprivileged subset, `publish` alone is not the test for
 * the counts that reach beyond the subject's own posts and pages
 * (`cpt`, `commentsReceived`, `commentsLeft`): a type with no readable
 * front end holds `publish` rows a visitor could never open, so those
 * counts ask `is_post_type_viewable()` as well. The comment counts also
 * skip password-protected and deleted parents, and ask the comment
 * dossier's gate of every parent they count, so a plugin that filters
 * `read_post` for a single published post takes its comments out of
 * them. For every viewer, `cpt` leaves out the post types Core
 * registers (`_builtin`). The payload is viewer-dependent: never cache
 * it under a subject-only key.
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
				// The module's gate, so a site that narrows WP Explorer
				// narrows this data with it. The per-viewer scoping lives
				// in the callback, which in-process callers invoke directly.
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
add_action( 'rest_api_init', 'openstation_my_wordpress_register_user_stats_route' );

/**
 * Sum per-parent comment counts over the parents the viewer may read.
 *
 * The query behind the rows has already kept only published, unsealed
 * parents of a viewable type. That settles the parent's status, type
 * and password, but not the post itself: `read_post` is filterable per
 * post, and the comment dossier asks it of a published parent too, so a
 * plugin can withhold one post and `/comment-stats` then refuses its
 * comments. Every parent goes through that same gate,
 * openstation_my_wordpress_can_read_comment_post(), so a count never
 * reports comments the dossier withholds. The parents are loaded in one
 * query, and each is decided once per request.
 *
 * @param array[]|null $rows     Rows carrying the parent's `post_id` and its comment count `n`.
 * @param bool[]       $verdicts Gate answers already reached in this request, keyed by post id.
 * @return int
 */
function openstation_my_wordpress_user_stats_readable_comment_count( $rows, array &$verdicts ) {
	$rows   = (array) $rows;
	$unseen = array();
	foreach ( $rows as $row ) {
		$id = (int) $row['post_id'];
		if ( $id > 0 && ! isset( $verdicts[ $id ] ) ) {
			$unseen[ $id ] = $id;
		}
	}
	if ( $unseen ) {
		_prime_post_caches( array_values( $unseen ), false, false );
	}

	$total = 0;
	foreach ( $rows as $row ) {
		$id = (int) $row['post_id'];
		if ( ! isset( $verdicts[ $id ] ) ) {
			$verdicts[ $id ] = openstation_my_wordpress_can_read_comment_post( $id > 0 ? get_post( $id ) : null );
		}
		if ( $verdicts[ $id ] ) {
			$total += (int) $row['n'];
		}
	}
	return $total;
}

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
	$post_counts      = array(
		'publish' => 0,
		'draft'   => 0,
		'pending' => 0,
		'private' => 0,
		'future'  => 0,
		'total'   => 0,
	);
	foreach ( (array) $post_status_rows as $row ) {
		$status                = (string) $row['post_status'];
		$n                     = (int) $row['n'];
		$post_counts['total'] += $n;
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
	$page_counts      = array(
		'publish' => 0,
		'draft'   => 0,
		'total'   => 0,
	);
	foreach ( (array) $page_status_rows as $row ) {
		$status                = (string) $row['post_status'];
		$n                     = (int) $row['n'];
		$page_counts['total'] += $n;
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

	// ----- Counts beyond the subject's own posts and pages -------------
	// For a viewer without `list_users`, each count below takes two gates,
	// because `publish` is not visibility on its own: the row has to be
	// published, AND its post type has to be one a visitor could actually
	// open. A plugin's internal type (an order, a submission log, an
	// internal note) registers rows with a `publish` status and no front
	// end at all, so the type list comes from `is_post_type_viewable()`,
	// the question the comment tools and the term-stats endpoint settled
	// on. A comment count also skips a password-protected parent, whose
	// comments are sealed along with it, and a parent that no longer
	// exists. Those three settle the parent's status, type and password,
	// but not the post itself: `read_post` is filterable per post, so each
	// comment count also asks the comment dossier's gate of every parent
	// it counts, through
	// openstation_my_wordpress_user_stats_readable_comment_count().
	// Privileged viewers keep every count whole.
	$viewable_types = array_values( array_filter( get_post_types(), 'is_post_type_viewable' ) );
	$viewable_list  = implode( ', ', array_fill( 0, count( $viewable_types ), '%s' ) );

	// Gate answers per parent post, shared by both comment counts.
	$comment_verdicts = array();

	// Comments received on posts authored by this user, approved only.
	if ( $can_see_private ) {
		$comments_received = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(c.comment_ID)
				FROM {$wpdb->comments} c
				INNER JOIN {$wpdb->posts} p ON c.comment_post_ID = p.ID
				WHERE p.post_author = %d
					AND c.comment_approved = '1'
					AND p.post_status NOT IN ( 'auto-draft', 'trash' )",
				$user_id
			)
		);
	} elseif ( $viewable_types ) {
		$received_rows     = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT p.ID AS post_id, COUNT(c.comment_ID) AS n
				FROM {$wpdb->comments} c
				INNER JOIN {$wpdb->posts} p ON c.comment_post_ID = p.ID
				WHERE p.post_author = %d
					AND c.comment_approved = '1'
					AND p.post_status = 'publish'
					AND p.post_password = ''
					AND p.post_type IN ( {$viewable_list} )
				GROUP BY p.ID",
				array_merge( array( $user_id ), $viewable_types )
			),
			ARRAY_A
		);
		$comments_received = openstation_my_wordpress_user_stats_readable_comment_count( $received_rows, $comment_verdicts );
	} else {
		$comments_received = 0;
	}

	// Comments left BY this user (regardless of post author).
	if ( $can_see_private ) {
		$comments_left = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*)
				FROM {$wpdb->comments}
				WHERE user_id = %d
					AND comment_approved = '1'",
				$user_id
			)
		);
	} elseif ( $viewable_types ) {
		$left_rows     = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT p.ID AS post_id, COUNT(c.comment_ID) AS n
				FROM {$wpdb->comments} c
				INNER JOIN {$wpdb->posts} p ON c.comment_post_ID = p.ID
				WHERE c.user_id = %d
					AND c.comment_approved = '1'
					AND p.post_status = 'publish'
					AND p.post_password = ''
					AND p.post_type IN ( {$viewable_list} )
				GROUP BY p.ID",
				array_merge( array( $user_id ), $viewable_types )
			),
			ARRAY_A
		);
		$comments_left = openstation_my_wordpress_user_stats_readable_comment_count( $left_rows, $comment_verdicts );
	} else {
		$comments_left = 0;
	}

	// Total content in custom post types. Every type Core registers is
	// left out (`_builtin`): posts and pages because they are counted
	// above, and the rest (attachments, revisions, menu items, synced
	// patterns, templates, navigation menus, global styles, changesets,
	// oEmbed caches, ...) because none of it is a custom post type. An
	// exclusion list naming a handful of them counted every one it did
	// not name.
	$builtin_types = array_values( get_post_types( array( '_builtin' => true ) ) );
	if ( $can_see_private ) {
		$builtin_list = implode( ', ', array_fill( 0, count( $builtin_types ), '%s' ) );
		$cpt_count    = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*)
				FROM {$wpdb->posts}
				WHERE post_author = %d
					AND post_type NOT IN ( {$builtin_list} )
					AND post_status NOT IN ( 'auto-draft', 'inherit', 'trash' )",
				array_merge( array( $user_id ), $builtin_types )
			)
		);
	} else {
		$cpt_types = array_values( array_diff( $viewable_types, $builtin_types ) );
		if ( $cpt_types ) {
			$cpt_list  = implode( ', ', array_fill( 0, count( $cpt_types ), '%s' ) );
			$cpt_count = (int) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COUNT(*)
					FROM {$wpdb->posts}
					WHERE post_author = %d
						AND post_type IN ( {$cpt_list} )
						AND post_status = 'publish'",
					array_merge( array( $user_id ), $cpt_types )
				)
			);
		} else {
			$cpt_count = 0;
		}
	}

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
	$recent       = array();
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
	$top_terms     = array();
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
	$activity      = array();
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
	$last_post  = $wpdb->get_var(
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
