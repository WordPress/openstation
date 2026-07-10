<?php
/**
 * Desktop Mode — Living Tree: metric helpers.
 *
 * The scalar signals the snapshot builder folds into the site's DNA.
 * Each helper composes existing WordPress aggregates (`wp_count_posts`,
 * `wp_count_comments`, `wp_count_terms`), the site-views traffic signal,
 * and framework presence — never a per-row payload. The golden rule
 * (WordPress emits hormones, never geometry) starts here: everything
 * returned is a scalar or a tiny capped list.
 *
 * @package WPDesktopMode
 * @since   0.9.4
 */

defined( 'ABSPATH' ) || exit;

/**
 * The site's inception moment as a unix timestamp — the stable half of
 * the determinism seed (`siteUrl|installEpoch`), so it must never drift
 * between requests. Composed (core has no first-party "install time"):
 * the earlier of the oldest user registration and the oldest published
 * post date.
 *
 * @since 0.9.4
 *
 * @return int Unix timestamp, or 0 when the site has neither.
 */
function desktop_mode_living_tree_install_epoch() {
	global $wpdb;

	$oldest_user = $wpdb->get_var(
		"SELECT MIN( user_registered ) FROM {$wpdb->users}"
	);
	$oldest_post = $wpdb->get_var(
		"SELECT MIN( post_date_gmt ) FROM {$wpdb->posts}
		WHERE post_status = 'publish' AND post_date_gmt > '1970-01-01 00:00:01'"
	);

	$candidates = array();
	foreach ( array( $oldest_user, $oldest_post ) as $mysql_date ) {
		if ( $mysql_date ) {
			$ts = strtotime( $mysql_date . ' UTC' );
			if ( $ts > 0 ) {
				$candidates[] = $ts;
			}
		}
	}

	return empty( $candidates ) ? 0 : min( $candidates );
}

/**
 * Age of the site in whole days, from the install epoch. Clamped to be
 * non-negative — the master clock never runs backwards.
 *
 * @since 0.9.4
 *
 * @return int Whole days since the site's inception. >= 0.
 */
function desktop_mode_living_tree_site_age_days() {
	$epoch = desktop_mode_living_tree_install_epoch();
	if ( $epoch <= 0 ) {
		return 0;
	}
	return max( 0, (int) floor( ( time() - $epoch ) / DAY_IN_SECONDS ) );
}

/**
 * Recent traffic signal: the `_post_views_YYYY-MM-DD` post-meta summed
 * over the last 14 days — the same aggregation the site-views widget
 * uses. Sites without a view counter simply report 0 (a windless day).
 *
 * @since 0.9.4
 *
 * @return int Recent view sum. >= 0.
 */
function desktop_mode_living_tree_traffic() {
	global $wpdb;

	$total = 0;
	$today = current_time( 'Y-m-d' );
	for ( $i = 0; $i < 14; $i++ ) {
		$date     = gmdate( 'Y-m-d', strtotime( $today . ' -' . $i . ' days' ) );
		$meta_key = '_post_views_' . $date;
		$total   += (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COALESCE( SUM( CAST( meta_value AS UNSIGNED ) ), 0 )
				FROM {$wpdb->postmeta}
				WHERE meta_key = %s",
				$meta_key
			)
		);
	}

	return max( 0, $total );
}

/**
 * Number of users currently online, from framework presence.
 *
 * @since 0.9.4
 *
 * @return int Count of users with `online` presence status. >= 0.
 */
function desktop_mode_living_tree_active_users() {
	if ( ! function_exists( 'desktop_mode_presence_snapshot' ) ) {
		return 0;
	}
	$count = 0;
	foreach ( desktop_mode_presence_snapshot() as $record ) {
		if ( isset( $record['status'] ) && 'online' === $record['status'] ) {
			$count++;
		}
	}
	return $count;
}

/**
 * SEO / site-health score, normalised 0..1.
 *
 * There is no cheap first-party score to read synchronously (Site Health
 * tests are async and expensive), so the default is a healthy 0.7 and
 * the filter is the integration point — an SEO or monitoring plugin that
 * *does* know the site's health can feed the real value in.
 *
 * @since 0.9.4
 *
 * @return float Health score in [0, 1].
 */
function desktop_mode_living_tree_seo_health() {
	/**
	 * Filter the Living Tree health hormone source. Return 0..1 — it
	 * drives the canopy's colour temperature (green → yellow → red →
	 * grey).
	 *
	 * @since 0.9.4
	 *
	 * @param float $health Default 0.7.
	 */
	$health = (float) apply_filters( 'desktop_mode_living_tree_seo_health', 0.7 );
	return min( 1.0, max( 0.0, $health ) );
}

/**
 * Performance headroom, normalised 0..1 (1 = plenty, 0 = under load).
 *
 * Same story as the health score: no synchronous first-party signal, so
 * a comfortable default plus a filter for plugins with real telemetry.
 *
 * @since 0.9.4
 *
 * @return float Performance score in [0, 1].
 */
function desktop_mode_living_tree_performance() {
	/**
	 * Filter the Living Tree performance hormone source. Return 0..1 —
	 * it throttles growth vigour.
	 *
	 * @since 0.9.4
	 *
	 * @param float $performance Default 0.8.
	 */
	$performance = (float) apply_filters( 'desktop_mode_living_tree_performance', 0.8 );
	return min( 1.0, max( 0.0, $performance ) );
}

/**
 * Top tag co-occurrence edges for the liana overlay.
 *
 * The strongest `$limit` pairs of tags that appear together on the same
 * posts, as `array( 'a' => term_id, 'b' => term_id, 'weight' =>
 * shared_post_count )`, weight-descending. Compact by construction —
 * never the full matrix. One grouped self-join, capped.
 *
 * @since 0.9.4
 *
 * @param int $limit Maximum number of edges. Default 40.
 * @return array[] List of co-occurrence edges.
 */
function desktop_mode_living_tree_tag_cooccurrence( $limit = 40 ) {
	global $wpdb;

	$limit = max( 0, min( 100, (int) $limit ) );
	if ( 0 === $limit ) {
		return array();
	}

	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT tt1.term_id AS a, tt2.term_id AS b, COUNT(*) AS weight
			FROM {$wpdb->term_relationships} tr1
			INNER JOIN {$wpdb->term_relationships} tr2
				ON tr1.object_id = tr2.object_id
			INNER JOIN {$wpdb->term_taxonomy} tt1
				ON tr1.term_taxonomy_id = tt1.term_taxonomy_id AND tt1.taxonomy = 'post_tag'
			INNER JOIN {$wpdb->term_taxonomy} tt2
				ON tr2.term_taxonomy_id = tt2.term_taxonomy_id AND tt2.taxonomy = 'post_tag'
			WHERE tt1.term_id < tt2.term_id
			GROUP BY tt1.term_id, tt2.term_id
			ORDER BY weight DESC, a ASC, b ASC
			LIMIT %d",
			$limit
		),
		ARRAY_A
	);

	$out = array();
	foreach ( (array) $rows as $row ) {
		$out[] = array(
			'a'      => (int) $row['a'],
			'b'      => (int) $row['b'],
			'weight' => (int) $row['weight'],
		);
	}
	return $out;
}

/**
 * Compact per-region structural hints (the `branches` array): published
 * posts grouped by year, each year mapped to a depth/girth/length hint
 * normalised against the busiest year. This is DNA, not geometry — the
 * simulator may bias growth density with it, never position anything.
 *
 * @since 0.9.4
 *
 * @return array[] Compact branch DNA hints (max 12 entries).
 */
function desktop_mode_living_tree_branch_dna() {
	global $wpdb;

	$rows = $wpdb->get_results(
		"SELECT YEAR( post_date_gmt ) AS y, COUNT(*) AS n
		FROM {$wpdb->posts}
		WHERE post_status = 'publish' AND post_type = 'post'
			AND post_date_gmt > '1970-01-01 00:00:01'
		GROUP BY y
		ORDER BY y ASC
		LIMIT 12",
		ARRAY_A
	);
	if ( empty( $rows ) ) {
		return array();
	}

	$max = 1;
	foreach ( $rows as $row ) {
		$max = max( $max, (int) $row['n'] );
	}

	$out   = array();
	$depth = 0;
	foreach ( $rows as $row ) {
		$out[] = array(
			'depth'  => $depth,
			'girth'  => round( (int) $row['n'] / $max, 3 ),
			'length' => round( min( 1.0, (int) $row['n'] / $max + 0.2 ), 3 ),
		);
		$depth++;
	}
	return $out;
}
