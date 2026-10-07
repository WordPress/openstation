<?php

defined( 'ABSPATH' ) || exit;

function openstation_living_tree_install_epoch() {
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

function openstation_living_tree_site_age_days() {
	$epoch = openstation_living_tree_install_epoch();
	if ( $epoch <= 0 ) {
		return 0;
	}
	return max( 0, (int) floor( ( time() - $epoch ) / DAY_IN_SECONDS ) );
}

function openstation_living_tree_traffic( $with_jetpack = true ) {
	$views = $with_jetpack ? openstation_living_tree_jetpack_visits() : null;
	if ( null === $views ) {
		$views = openstation_living_tree_meta_views();
	}

	$views = (int) apply_filters( 'openstation_living_tree_traffic', $views );
	return max( 0, $views );
}

function openstation_living_tree_jetpack_visits() {
	$days = openstation_site_views_jetpack_days();
	return null === $days ? null : (int) array_sum( array_column( $days, 'views' ) );
}

function openstation_living_tree_meta_views() {
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

function openstation_living_tree_active_users() {
	if ( ! function_exists( 'openstation_presence_snapshot' ) ) {
		return 0;
	}
	$count = 0;
	foreach ( openstation_presence_snapshot() as $record ) {
		if ( isset( $record['status'] ) && 'online' === $record['status'] ) {
			++$count;
		}
	}
	return $count;
}

function openstation_living_tree_seo_health() {

	$health = (float) apply_filters( 'openstation_living_tree_seo_health', 0.7 );
	return min( 1.0, max( 0.0, $health ) );
}

function openstation_living_tree_performance() {
	$performance = openstation_living_tree_site_health_performance();
	if ( null === $performance ) {
		$performance = 0.8;
	}

	$performance = (float) apply_filters( 'openstation_living_tree_performance', $performance );
	return min( 1.0, max( 0.0, $performance ) );
}

function openstation_living_tree_site_health_performance() {
	$raw = get_transient( 'health-check-site-status-result' );
	if ( is_string( $raw ) && '' !== $raw ) {
		$counts = json_decode( $raw, true );
	} elseif ( is_array( $raw ) ) {

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

function openstation_living_tree_branch_dna() {
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
		++$depth;
	}
	return $out;
}
