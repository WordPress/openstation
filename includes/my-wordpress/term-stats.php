<?php
/**
 * OpenStation — My WordPress: per-term stats endpoint.
 *
 * `GET /desktop-mode/v1/term-stats/<taxonomy>/<id>` returns an
 * aggregated profile for a single category or tag — counts, recent
 * posts in the term, top authors, co-occurring terms, 12-month
 * activity sparkline, milestones. Powers the right preview pane in
 * the My WordPress folder when a term is selected.
 *
 * Permissions: the My WordPress module's gate,
 * `openstation_my_wordpress_user_can_use()` (`edit_posts` unless a site
 * filters it), so a site that narrows WP Explorer narrows this data
 * with it. Terms are public-facing data and author archives are
 * public, so the term row and its top authors are no new disclosure to
 * anyone past that gate.
 *
 * That reasoning covers the term row and the aggregates over its
 * *published* posts; it does not carry to the unpublished posts inside
 * the term, nor to terms of a non-viewable taxonomy. So hidden
 * taxonomies answer 400 unless the caller can manage their terms,
 * every post-level query is scoped to the statuses the caller may
 * read — resolved from each status's registered visibility flags and
 * the post type's cap map, plus the caller's own posts — and the
 * recent list is gated per row with `read_post`. Otherwise a
 * subscriber could read an administrator's private and draft post
 * titles, authors and dates, and the per-status counts would leak how
 * many hidden posts a term holds. The readable-status clause is built
 * in the callback, right above the queries that splice it in.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the route.
 */
function openstation_my_wordpress_register_term_stats_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/term-stats/(?P<taxonomy>[a-zA-Z0-9_-]+)/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_my_wordpress_term_stats_callback',
			'permission_callback' => static function () {
				// The module's gate, so a site that narrows WP Explorer
				// narrows this data with it. The per-viewer scoping lives
				// in the callback, which in-process callers invoke directly.
				return openstation_my_wordpress_user_can_use();
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
add_action( 'rest_api_init', 'openstation_my_wordpress_register_term_stats_route' );

/**
 * Aggregator callback. See file docblock for return shape.
 *
 * @param WP_REST_Request $request REST request.
 * @return array|WP_Error
 */
function openstation_my_wordpress_term_stats_callback( $request ) {
	global $wpdb;
	$taxonomy = sanitize_key( (string) $request->get_param( 'taxonomy' ) );
	$term_id  = (int) $request->get_param( 'id' );

	$tax_obj = get_taxonomy( $taxonomy );
	// A registered-but-hidden taxonomy (nav_menu, link_category, a
	// plugin's internal one) is not public-facing data the way
	// categories and tags are, so the file docblock's `read` reasoning
	// does not cover it: answer exactly as if it were unregistered
	// unless the caller can manage its terms.
	if ( ! $tax_obj || ( ! is_taxonomy_viewable( $tax_obj ) && ! current_user_can( $tax_obj->cap->manage_terms ) ) ) {
		return new WP_Error(
			'openstation_invalid_taxonomy',
			__( 'Unknown taxonomy.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$term = get_term( $term_id, $taxonomy );
	if ( ! $term || is_wp_error( $term ) ) {
		return new WP_Error(
			'openstation_term_not_found',
			__( 'Term not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	// ----- Profile -----------------------------------------------------
	$profile = array(
		'id'            => (int) $term->term_id,
		'name'          => $term->name,
		'slug'          => $term->slug,
		'taxonomy'      => $term->taxonomy,
		'taxonomyLabel' => isset( $tax_obj->labels->singular_name )
			? (string) $tax_obj->labels->singular_name
			: $taxonomy,
		'description'   => (string) $term->description,
		'link'          => get_term_link( $term ) instanceof WP_Error
			? ''
			: (string) get_term_link( $term ),
		'parent'        => (int) $term->parent,
		'storedCount'   => (int) $term->count, // core's published-only count
	);
	if ( $term->parent > 0 ) {
		$parent = get_term( $term->parent, $taxonomy );
		if ( $parent && ! is_wp_error( $parent ) ) {
			$profile['parentName'] = $parent->name;
		}
	}

	$tt_id = (int) $term->term_taxonomy_id;

	// Every query below that can touch unpublished posts is scoped to
	// the statuses the caller may read (the remaining aggregates are
	// publish-only). The endpoint gates on the term (public), but the
	// posts inside it are not: without this, a subscriber gets the
	// titles, authors and dates of administrator-owned drafts/private
	// posts, and the per-status counts become an oracle for content
	// they cannot see.
	//
	// The sets come from the registered status objects, so a plugin's
	// custom status follows its own visibility flags: public statuses
	// for everyone; private-flagged ones with the post type's
	// read_private_posts; the remaining non-internal statuses (draft,
	// pending, future and any registered workflow status — trash and
	// auto-draft are internal) with edit_others_posts, because core
	// maps reading them to editing them, plus edit_published_posts for
	// a scheduled post, mirroring map_meta_cap(); and the caller's own
	// posts in any of those statuses, since core grants an author read
	// on their own post whatever its status. The clause is a close
	// approximation of read_post used where a per-row gate is
	// impossible (the counts); the recent list re-checks read_post per
	// row as the authoritative gate. It is built inline, from literal
	// %s/%d placeholder lists only, so its values are visibly bound
	// through prepare() at both use sites.
	$type          = get_post_type_object( 'post' );
	$statuses      = array_values( get_post_stati( array( 'public' => true ) ) );
	$private_stati = array_values( get_post_stati( array( 'private' => true ) ) );
	$hidden_stati  = array_values(
		get_post_stati(
			array(
				'internal' => false,
				'public'   => false,
				'private'  => false,
			)
		)
	);
	if ( current_user_can( $type->cap->read_private_posts ) ) {
		$statuses = array_merge( $statuses, $private_stati );
	}
	if ( current_user_can( $type->cap->edit_others_posts ) ) {
		foreach ( $hidden_stati as $status ) {
			if ( 'future' === $status && ! current_user_can( $type->cap->edit_published_posts ) ) {
				continue;
			}
			$statuses[] = $status;
		}
	}

	$placeholders  = implode( ', ', array_fill( 0, count( $statuses ), '%s' ) );
	$status_clause = "p.post_status IN ( {$placeholders} )";
	$status_args   = $statuses;

	$user_id = get_current_user_id();
	$own     = array_values( array_diff( array_merge( $private_stati, $hidden_stati ), $statuses ) );
	if ( $user_id > 0 && $own ) {
		$own_ph        = implode( ', ', array_fill( 0, count( $own ), '%s' ) );
		$status_clause = "( {$status_clause} OR ( p.post_author = %d AND p.post_status IN ( {$own_ph} ) ) )";
		$status_args   = array_merge( $status_args, array( $user_id ), $own );
	}

	// ----- Counts ------------------------------------------------------
	// Post-status breakdown, restricted to the readable set so the
	// counts never reveal how many hidden posts a term holds.
	$status_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT p.post_status, COUNT(DISTINCT p.ID) AS n
			FROM {$wpdb->posts} p
			INNER JOIN {$wpdb->term_relationships} tr ON tr.object_id = p.ID
			WHERE tr.term_taxonomy_id = %d
				AND p.post_type = 'post'
				AND {$status_clause}
			GROUP BY p.post_status",
			array_merge( array( $tt_id ), $status_args )
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

	// ----- Recent posts (5 most recent the caller may read) ------------
	// The clause narrows the pool to readable statuses; the per-row
	// read_post gate below is authoritative (it resolves the exact meta
	// cap per post, and it is the hook where membership plugins restrict
	// even published posts). Fetch headroom past 5 because the gate may
	// drop rows the coarse clause admitted.
	$recent_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT DISTINCT p.ID, p.post_title, p.post_date_gmt, p.post_status, p.post_type, p.post_author
			FROM {$wpdb->posts} p
			INNER JOIN {$wpdb->term_relationships} tr ON tr.object_id = p.ID
			WHERE tr.term_taxonomy_id = %d
				AND {$status_clause}
				AND p.post_type = 'post'
			ORDER BY p.post_date_gmt DESC
			LIMIT 15",
			array_merge( array( $tt_id ), $status_args )
		),
		ARRAY_A
	);
	$recent      = array();
	if ( $recent_rows ) {
		// Bulk-warm the post cache — the read_post checks,
		// get_the_title() and get_permalink() below all read from it.
		_prime_post_caches( array_map( 'intval', wp_list_pluck( $recent_rows, 'ID' ) ), false, false );
	}
	foreach ( (array) $recent_rows as $row ) {
		$post_id = (int) $row['ID'];
		if ( ! current_user_can( 'read_post', $post_id ) ) {
			continue;
		}
		$author_id  = (int) $row['post_author'];
		$author     = $author_id > 0 ? get_userdata( $author_id ) : null;
		$author_arr = $author
			? array(
				'id'        => (int) $author->ID,
				'name'      => $author->display_name,
				'avatarUrl' => get_avatar_url( $author->ID, array( 'size' => 48 ) ),
			)
			: null;
		$recent[]   = array(
			'id'     => $post_id,
			'title'  => get_the_title( $post_id ),
			'date'   => mysql2date( 'c', (string) $row['post_date_gmt'], false ),
			'status' => (string) $row['post_status'],
			'type'   => (string) $row['post_type'],
			'link'   => (string) get_permalink( $post_id ),
			'author' => $author_arr,
		);
		if ( count( $recent ) >= 5 ) {
			break;
		}
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
	$top_authors     = array();
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
	$co_terms     = array();
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
	$activity      = array();
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
	$last_post_date  = $wpdb->get_var(
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
	$milestones      = array(
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
	 * @param array  $payload  Stats payload.
	 * @param string $taxonomy Taxonomy slug.
	 * @param int    $term_id  Term id.
	 */
	return apply_filters(
		'openstation_my_wordpress_term_stats',
		$payload,
		$taxonomy,
		$term_id
	);
}
