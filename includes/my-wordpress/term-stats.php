<?php
/**
 * Desktop Mode — My WordPress: per-term stats endpoint.
 *
 * `GET /desktop-mode/v1/term-stats/<taxonomy>/<id>` returns an
 * aggregated profile for a single category or tag — counts, recent
 * posts in the term, top authors, co-occurring terms, 12-month
 * activity sparkline, milestones. Powers the right preview pane in
 * the My WordPress folder when a term is selected.
 *
 * Permissions: any logged-in user with `read` (default for most
 * roles) — terms are public-facing data on the WP site, so the same
 * cap that lets you read the front-end is enough to inspect their
 * stats. Author archives are also public so listing top authors is
 * not new disclosure.
 *
 * @package WPDesktopMode
 * @since   0.8.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the route.
 *
 * @since 0.8.0
 */
function desktop_mode_my_wordpress_register_term_stats_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/term-stats/(?P<taxonomy>[a-zA-Z0-9_-]+)/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'desktop_mode_my_wordpress_term_stats_callback',
			'permission_callback' => static function () {
				return is_user_logged_in() && current_user_can( 'read' );
			},
			'args'                => array(
				'taxonomy' => array(
					'required'          => true,
					'type'              => 'string',
					'sanitize_callback' => 'sanitize_key',
				),
				'id'       => array(
					'required'          => true,
					'type'              => 'integer',
					'sanitize_callback' => 'absint',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_my_wordpress_register_term_stats_route' );

/**
 * Aggregator callback. See file docblock for return shape.
 *
 * @since 0.8.0
 *
 * @param WP_REST_Request $request REST request.
 * @return array|WP_Error
 */
function desktop_mode_my_wordpress_term_stats_callback( $request ) {
	global $wpdb;
	$taxonomy = sanitize_key( (string) $request->get_param( 'taxonomy' ) );
	$term_id  = (int) $request->get_param( 'id' );

	$tax_obj = get_taxonomy( $taxonomy );
	if ( ! $tax_obj ) {
		return new WP_Error(
			'desktop_mode_invalid_taxonomy',
			__( 'Unknown taxonomy.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$term = get_term( $term_id, $taxonomy );
	if ( ! $term || is_wp_error( $term ) ) {
		return new WP_Error(
			'desktop_mode_term_not_found',
			__( 'Term not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	// ----- Profile -----------------------------------------------------
	$profile = array(
		'id'             => (int) $term->term_id,
		'name'           => $term->name,
		'slug'           => $term->slug,
		'taxonomy'       => $term->taxonomy,
		'taxonomyLabel'  => isset( $tax_obj->labels->singular_name )
			? (string) $tax_obj->labels->singular_name
			: $taxonomy,
		'description'    => (string) $term->description,
		'link'           => get_term_link( $term ) instanceof WP_Error
			? ''
			: (string) get_term_link( $term ),
		'parent'         => (int) $term->parent,
		'storedCount'    => (int) $term->count, // core's published-only count
	);
	if ( $term->parent > 0 ) {
		$parent = get_term( $term->parent, $taxonomy );
		if ( $parent && ! is_wp_error( $parent ) ) {
			$profile['parentName'] = $parent->name;
		}
	}

	$tt_id = (int) $term->term_taxonomy_id;

	// ----- Counts ------------------------------------------------------
	// Post-status breakdown for posts in this term.
	$status_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT p.post_status, COUNT(DISTINCT p.ID) AS n
			FROM {$wpdb->posts} p
			INNER JOIN {$wpdb->term_relationships} tr ON tr.object_id = p.ID
			WHERE tr.term_taxonomy_id = %d
				AND p.post_type = 'post'
				AND p.post_status NOT IN ( 'auto-draft', 'inherit', 'trash' )
			GROUP BY p.post_status",
			$tt_id
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
	foreach ( (array) $status_rows as $row ) {
		$status                = (string) $row['post_status'];
		$n                     = (int) $row['n'];
		$post_counts['total'] += $n;
		if ( isset( $post_counts[ $status ] ) ) {
			$post_counts[ $status ] = $n;
		}
	}

	// Comments on posts in this term (approved only).
	$comments_received = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(c.comment_ID)
			FROM {$wpdb->comments} c
			INNER JOIN {$wpdb->posts} p ON c.comment_post_ID = p.ID
			INNER JOIN {$wpdb->term_relationships} tr ON tr.object_id = p.ID
			WHERE tr.term_taxonomy_id = %d
				AND p.post_status = 'publish'
				AND c.comment_approved = '1'",
			$tt_id
		)
	);

	// Distinct authors using this term.
	$distinct_authors = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT( DISTINCT p.post_author )
			FROM {$wpdb->posts} p
			INNER JOIN {$wpdb->term_relationships} tr ON tr.object_id = p.ID
			WHERE tr.term_taxonomy_id = %d
				AND p.post_status = 'publish'",
			$tt_id
		)
	);

	$counts = array(
		'posts'            => $post_counts,
		'commentsReceived' => $comments_received,
		'distinctAuthors'  => $distinct_authors,
	);

	// ----- Recent posts (5 most recent) --------------------------------
	$recent_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT DISTINCT p.ID, p.post_title, p.post_date_gmt, p.post_status, p.post_type, p.post_author
			FROM {$wpdb->posts} p
			INNER JOIN {$wpdb->term_relationships} tr ON tr.object_id = p.ID
			WHERE tr.term_taxonomy_id = %d
				AND p.post_status IN ( 'publish', 'private', 'future', 'draft', 'pending' )
				AND p.post_type = 'post'
			ORDER BY p.post_date_gmt DESC
			LIMIT 5",
			$tt_id
		),
		ARRAY_A
	);
	$recent = array();
	foreach ( (array) $recent_rows as $row ) {
		$post_id    = (int) $row['ID'];
		$author_id  = (int) $row['post_author'];
		$author     = $author_id > 0 ? get_userdata( $author_id ) : null;
		$author_arr = $author
			? array(
				'id'        => (int) $author->ID,
				'name'      => $author->display_name,
				'avatarUrl' => get_avatar_url( $author->ID, array( 'size' => 48 ) ),
			)
			: null;
		$recent[] = array(
			'id'     => $post_id,
			'title'  => get_the_title( $post_id ),
			'date'   => mysql2date( 'c', (string) $row['post_date_gmt'], false ),
			'status' => (string) $row['post_status'],
			'type'   => (string) $row['post_type'],
			'link'   => (string) get_permalink( $post_id ),
			'author' => $author_arr,
		);
	}

	// ----- Top authors (most posts in this term) -----------------------
	$top_author_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT p.post_author, COUNT( DISTINCT p.ID ) AS n
			FROM {$wpdb->posts} p
			INNER JOIN {$wpdb->term_relationships} tr ON tr.object_id = p.ID
			WHERE tr.term_taxonomy_id = %d
				AND p.post_status = 'publish'
				AND p.post_author > 0
			GROUP BY p.post_author
			ORDER BY n DESC
			LIMIT 5",
			$tt_id
		),
		ARRAY_A
	);
	$top_authors = array();
	foreach ( (array) $top_author_rows as $row ) {
		$user_id = (int) $row['post_author'];
		$u       = get_userdata( $user_id );
		if ( ! $u ) {
			continue;
		}
		$top_authors[] = array(
			'userId'        => (int) $u->ID,
			'userName'      => (string) $u->display_name,
			'userAvatarUrl' => (string) get_avatar_url( $u->ID, array( 'size' => 48 ) ),
			'count'         => (int) $row['n'],
		);
	}

	// ----- Co-occurring terms (most frequent siblings in same tax) -----
	$co_term_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT t.term_id, t.name, t.slug, COUNT(*) AS n
			FROM {$wpdb->term_relationships} tr1
			INNER JOIN {$wpdb->term_relationships} tr2 ON tr1.object_id = tr2.object_id
			INNER JOIN {$wpdb->term_taxonomy} tt2 ON tr2.term_taxonomy_id = tt2.term_taxonomy_id
			INNER JOIN {$wpdb->terms} t ON tt2.term_id = t.term_id
			INNER JOIN {$wpdb->posts} p ON p.ID = tr1.object_id
			WHERE tr1.term_taxonomy_id = %d
				AND tt2.taxonomy = %s
				AND tt2.term_id != %d
				AND p.post_status = 'publish'
			GROUP BY t.term_id
			ORDER BY n DESC
			LIMIT 5",
			$tt_id,
			$taxonomy,
			$term_id
		),
		ARRAY_A
	);
	$co_terms = array();
	foreach ( (array) $co_term_rows as $row ) {
		$co_terms[] = array(
			'id'    => (int) $row['term_id'],
			'name'  => (string) $row['name'],
			'slug'  => (string) $row['slug'],
			'count' => (int) $row['n'],
		);
	}

	// ----- 12-month activity sparkline ---------------------------------
	$activity_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT DATE_FORMAT( p.post_date_gmt, '%%Y-%%m' ) AS ym, COUNT( DISTINCT p.ID ) AS n
			FROM {$wpdb->posts} p
			INNER JOIN {$wpdb->term_relationships} tr ON tr.object_id = p.ID
			WHERE tr.term_taxonomy_id = %d
				AND p.post_type = 'post'
				AND p.post_status = 'publish'
				AND p.post_date_gmt >= DATE_SUB( NOW(), INTERVAL 12 MONTH )
			GROUP BY ym
			ORDER BY ym ASC",
			$tt_id
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

	// ----- First & last post in this term ------------------------------
	$first_post_date = $wpdb->get_var(
		$wpdb->prepare(
			"SELECT MIN( p.post_date_gmt )
			FROM {$wpdb->posts} p
			INNER JOIN {$wpdb->term_relationships} tr ON tr.object_id = p.ID
			WHERE tr.term_taxonomy_id = %d
				AND p.post_status = 'publish'
				AND p.post_type = 'post'",
			$tt_id
		)
	);
	$last_post_date = $wpdb->get_var(
		$wpdb->prepare(
			"SELECT MAX( p.post_date_gmt )
			FROM {$wpdb->posts} p
			INNER JOIN {$wpdb->term_relationships} tr ON tr.object_id = p.ID
			WHERE tr.term_taxonomy_id = %d
				AND p.post_status = 'publish'
				AND p.post_type = 'post'",
			$tt_id
		)
	);
	$milestones = array(
		'firstPosted' => $first_post_date ? mysql2date( 'c', $first_post_date, false ) : null,
		'lastPosted'  => $last_post_date ? mysql2date( 'c', $last_post_date, false ) : null,
	);

	$payload = array(
		'profile'    => $profile,
		'counts'     => $counts,
		'recent'     => $recent,
		'topAuthors' => $top_authors,
		'coTerms'    => $co_terms,
		'activity'   => $activity,
		'milestones' => $milestones,
	);

	/**
	 * Filter the per-term stats payload before it returns to the
	 * My WordPress folder window.
	 *
	 * @since 0.8.0
	 *
	 * @param array  $payload  Stats payload.
	 * @param string $taxonomy Taxonomy slug.
	 * @param int    $term_id  Term id.
	 */
	return apply_filters(
		'desktop_mode_my_wordpress_term_stats',
		$payload,
		$taxonomy,
		$term_id
	);
}
