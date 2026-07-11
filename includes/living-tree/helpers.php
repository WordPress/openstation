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
 * Recent traffic signal, resolved with the same source ladder the
 * site-views widget uses: Jetpack Stats first, then the
 * `_post_views_YYYY-MM-DD` post-meta convention — both summed over the
 * last 14 days. Sites with neither simply report 0 (a windless day).
 *
 * The final value passes through the `desktop_mode_living_tree_traffic`
 * filter so analytics plugins with their own counters can feed the
 * real number in.
 *
 * @since 0.9.4
 *
 * @return int Recent view sum. >= 0.
 */
function desktop_mode_living_tree_traffic() {
	$views = desktop_mode_living_tree_jetpack_visits();
	if ( null === $views ) {
		$views = desktop_mode_living_tree_meta_views();
	}

	/**
	 * Filter the Living Tree traffic hormone source. Return a
	 * non-negative view count for the last ~14 days — it drives the
	 * wind (canopy sway amplitude / frequency).
	 *
	 * @since 0.9.5
	 *
	 * @param int $views Views in the window. Default: Jetpack Stats
	 *                   when available, else the `_post_views_*` meta
	 *                   sum, else 0.
	 */
	$views = (int) apply_filters( 'desktop_mode_living_tree_traffic', $views );
	return max( 0, $views );
}

/**
 * Last-14-days visits from Jetpack Stats, or `null` when unavailable.
 *
 * Reads through `Automattic\Jetpack\Stats\WPCOM_Stats::get_visits()` —
 * the same WPCOM endpoint the `jetpack/v4/stats/visits` REST route
 * (used by the site-views widget's client) proxies, but callable
 * server-side without a per-user capability check, so the snapshot's
 * transient cache holds the same value no matter which user primes it.
 * Any failure — Jetpack absent, no `get_visits` method, WP_Error,
 * unexpected payload — returns `null` and the caller falls back to the
 * post-views meta. A successful `0` is trusted (a quiet site is a
 * valid answer), matching the widget's source-ladder semantics.
 *
 * @since 0.9.5
 *
 * @return int|null Views over the last 14 days, or null when Jetpack
 *                  Stats can't answer.
 */
function desktop_mode_living_tree_jetpack_visits() {
	if ( ! class_exists( '\Automattic\Jetpack\Stats\WPCOM_Stats' ) ) {
		return null;
	}
	$wpcom_stats = new \Automattic\Jetpack\Stats\WPCOM_Stats();
	if ( ! method_exists( $wpcom_stats, 'get_visits' ) ) {
		return null;
	}

	try {
		$stats = $wpcom_stats->get_visits(
			array(
				'unit'     => 'day',
				'quantity' => 14,
			)
		);
	} catch ( \Throwable $e ) {
		return null;
	}
	if ( is_wp_error( $stats ) ) {
		return null;
	}

	// Jetpack versions differ on object-vs-assoc-array decoding —
	// normalise to arrays before reading.
	$stats = json_decode( wp_json_encode( $stats ), true );
	if ( ! is_array( $stats ) || empty( $stats['data'] ) || ! is_array( $stats['data'] ) ) {
		return null;
	}

	// Rows are positional per the response's `fields` list — usually
	// array( 'period', 'views' ). Locate 'views' rather than assuming.
	$views_index = 1;
	if ( isset( $stats['fields'] ) && is_array( $stats['fields'] ) ) {
		$idx = array_search( 'views', $stats['fields'], true );
		if ( false !== $idx ) {
			$views_index = (int) $idx;
		}
	}

	$total = 0;
	foreach ( $stats['data'] as $row ) {
		if ( is_array( $row ) && isset( $row[ $views_index ] ) && is_numeric( $row[ $views_index ] ) ) {
			$total += (int) $row[ $views_index ];
		}
	}
	return $total;
}

/**
 * Last-14-days view sum from the `_post_views_YYYY-MM-DD` post-meta
 * convention — the plain-WP fallback shared with the site-views
 * widget. Sites without a view-counter plugin report 0.
 *
 * @since 0.9.5
 *
 * @return int Recent view sum. >= 0.
 */
function desktop_mode_living_tree_meta_views() {
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
 * KNOWN GAP: unlike `traffic` (Jetpack Stats → post-views meta) and
 * `performance` (core Site Health tallies), this hormone still has no
 * first-party source — WordPress ships nothing SEO-shaped to read, so
 * the default is a healthy 0.7 and the filter is the only integration
 * point. Candidate future source: aggregate the per-post scores that
 * SEO plugins store in post-meta into a site-wide average. Until then,
 * an SEO or monitoring plugin that *does* know the site's health can
 * feed the real value in via the filter.
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
 * Sourced from core's own Site Health tallies when available (see
 * {@see desktop_mode_living_tree_site_health_performance()}), falling
 * back to a comfortable 0.8 until the weekly Site Health cron has run
 * at least once. The filter remains the integration point for plugins
 * with real runtime telemetry.
 *
 * @since 0.9.4
 *
 * @return float Performance score in [0, 1].
 */
function desktop_mode_living_tree_performance() {
	$performance = desktop_mode_living_tree_site_health_performance();
	if ( null === $performance ) {
		$performance = 0.8;
	}

	/**
	 * Filter the Living Tree performance hormone source. Return 0..1 —
	 * it throttles growth vigour.
	 *
	 * @since 0.9.4
	 *
	 * @param float $performance Default: a composite of core's Site
	 *                           Health issue counts when the
	 *                           `health-check-site-status-result`
	 *                           transient exists, else 0.8.
	 */
	$performance = (float) apply_filters( 'desktop_mode_living_tree_performance', $performance );
	return min( 1.0, max( 0.0, $performance ) );
}

/**
 * Performance composite from core's Site Health tallies, or `null`
 * when unavailable.
 *
 * WordPress runs every Site Health test on a weekly cron
 * (`wp_site_health_scheduled_check`) and persists the tallies in the
 * `health-check-site-status-result` transient as JSON counts
 * (`good` / `recommended` / `critical`) — the same source the
 * dashboard's Site Health widget reads. Mapping: start at 1.0,
 * subtract 0.15 per critical issue and 0.04 per recommendation, clamp
 * to [0.2, 1] — a clean install grows vigorously, a neglected one
 * visibly slows down but never fully stalls.
 *
 * Site Health measures broad install health (PHP version, HTTPS,
 * updates, object caching…), not pure runtime speed — the right
 * flavour for a "growth vigour" hormone. The transient is absent on a
 * brand-new site until the weekly cron first fires or someone opens
 * the Site Health screen; callers fall back to the 0.8 default then.
 *
 * @since 0.9.5
 *
 * @return float|null Composite in [0.2, 1], or null when the Site
 *                    Health tallies aren't available (yet).
 */
function desktop_mode_living_tree_site_health_performance() {
	$raw = get_transient( 'health-check-site-status-result' );
	if ( is_string( $raw ) && '' !== $raw ) {
		$counts = json_decode( $raw, true );
	} elseif ( is_array( $raw ) ) {
		// Defensive: some object-cache drop-ins hand back the decoded
		// array. Core itself always stores a JSON string.
		$counts = $raw;
	} else {
		return null;
	}

	if ( ! is_array( $counts )
		|| ( ! isset( $counts['critical'] ) && ! isset( $counts['recommended'] ) && ! isset( $counts['good'] ) )
	) {
		return null;
	}

	$critical    = max( 0, (int) ( $counts['critical'] ?? 0 ) );
	$recommended = max( 0, (int) ( $counts['recommended'] ?? 0 ) );

	$score = 1.0 - ( 0.15 * $critical ) - ( 0.04 * $recommended );
	return min( 1.0, max( 0.2, $score ) );
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
