<?php
/**
 * Tests for the Living Tree wallpaper's server module — the compact
 * site-DNA snapshot, its permission gate, its REST route, and the
 * aggregate metric helpers behind it.
 *
 * The snapshot is the contract the JS client trusts blind: shape, bounds,
 * compactness (aggregates only, never per-post identities), and seed
 * stability (installEpoch must not drift between calls).
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group living-tree
 */
class Tests_OpenStation_LivingTreeSnapshot extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		delete_transient( 'desktop_mode_living_tree_snapshot' );
		delete_transient( 'health-check-site-status-result' );
	}

	/**
	 * @covers ::open_station_living_tree_build_snapshot
	 */
	public function test_snapshot_has_the_full_expected_shape() {
		$snapshot = open_station_living_tree_build_snapshot();

		$this->assertIsArray( $snapshot );
		$expected_keys = array(
			'siteUrl',
			'siteName',
			'installEpoch',
			'siteAgeDays',
			'totalPosts',
			'totalPages',
			'totalCategories',
			'totalTags',
			'totalComments',
			'activeUsers',
			'traffic',
			'seoHealth',
			'performance',
			'branches',
		);
		foreach ( $expected_keys as $key ) {
			$this->assertArrayHasKey( $key, $snapshot, "missing snapshot key: {$key}" );
		}
	}

	/**
	 * @covers ::open_station_living_tree_build_snapshot
	 */
	public function test_snapshot_field_types_and_bounds() {
		$snapshot = open_station_living_tree_build_snapshot();

		$this->assertNotEmpty( $snapshot['siteUrl'] );
		$this->assertIsString( $snapshot['siteUrl'] );
		// The blog name is part of the determinism seed — two blogs sharing
		// a URL shape (localhost installs) must still grow distinct trees.
		$this->assertIsString( $snapshot['siteName'] );
		$this->assertSame( get_bloginfo( 'name' ), $snapshot['siteName'] );

		// Age is a non-negative whole number — the master clock never runs
		// backwards.
		$this->assertGreaterThanOrEqual( 0, $snapshot['siteAgeDays'] );

		// Aggregate counts are non-negative.
		foreach ( array( 'totalPosts', 'totalPages', 'totalCategories', 'totalTags', 'totalComments', 'activeUsers', 'traffic' ) as $key ) {
			$this->assertGreaterThanOrEqual( 0, $snapshot[ $key ], "{$key} must be >= 0" );
		}

		// Normalised scores stay within [0, 1].
		foreach ( array( 'seoHealth', 'performance' ) as $key ) {
			$this->assertGreaterThanOrEqual( 0, $snapshot[ $key ], "{$key} must be >= 0" );
			$this->assertLessThanOrEqual( 1, $snapshot[ $key ], "{$key} must be <= 1" );
		}

		// Compact DNA collections are arrays (never a full post list).
		$this->assertIsArray( $snapshot['branches'] );
	}

	/**
	 * @covers ::open_station_living_tree_user_can_use
	 */
	public function test_permission_gate_default_and_filter() {
		$admin = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin );
		$this->assertTrue( open_station_living_tree_user_can_use() );

		add_filter( 'open_station_living_tree_user_can_use', '__return_false' );
		$this->assertFalse( open_station_living_tree_user_can_use() );
		remove_filter( 'open_station_living_tree_user_can_use', '__return_false' );
	}

	/**
	 * The route registers on `rest_api_init` (fired lazily when the REST
	 * server is first built) — we don't call the registrar directly, which
	 * would trip core's "register on rest_api_init" notice.
	 *
	 * @covers ::open_station_living_tree_register_routes
	 */
	public function test_snapshot_route_is_registered() {
		$routes = rest_get_server()->get_routes();
		$this->assertArrayHasKey( '/desktop-mode/v1/living-tree/snapshot', $routes );
	}

	/**
	 * @covers ::open_station_living_tree_flush_cache
	 */
	public function test_flush_cache_clears_the_transient() {
		set_transient( 'desktop_mode_living_tree_snapshot', array( 'stale' => true ), HOUR_IN_SECONDS );
		open_station_living_tree_flush_cache();
		$this->assertFalse( get_transient( 'desktop_mode_living_tree_snapshot' ) );
	}

	/**
	 * @covers ::open_station_living_tree_build_snapshot
	 */
	public function test_snapshot_totals_reflect_published_content() {
		self::factory()->post->create_many( 3, array( 'post_status' => 'publish' ) );
		self::factory()->post->create( array( 'post_status' => 'draft' ) );
		self::factory()->post->create(
			array(
				'post_type'   => 'page',
				'post_status' => 'publish',
			)
		);

		$snapshot = open_station_living_tree_build_snapshot();
		$this->assertGreaterThanOrEqual( 3, $snapshot['totalPosts'] );
		$this->assertGreaterThanOrEqual( 1, $snapshot['totalPages'] );
		// Drafts are invisible to the tree: only published content grows
		// leaves, so publish count stays below the raw row count.
		$this->assertLessThan( 5, $snapshot['totalPosts'] );
	}

	/**
	 * The determinism seed is `siteUrl|installEpoch` — the epoch must be
	 * stable across calls or the skeleton would reshuffle on every load.
	 *
	 * @covers ::open_station_living_tree_install_epoch
	 */
	public function test_install_epoch_is_stable_and_site_age_non_negative() {
		$first  = open_station_living_tree_install_epoch();
		$second = open_station_living_tree_install_epoch();
		$this->assertSame( $first, $second );
		// The tests factory always seeds an admin user, so an epoch exists.
		$this->assertGreaterThan( 0, $first );
		$this->assertGreaterThanOrEqual( 0, open_station_living_tree_site_age_days() );
	}

	/**
	 * @covers ::open_station_living_tree_branch_dna
	 */
	public function test_branch_dna_is_capped_and_normalised() {
		self::factory()->post->create_many( 2, array( 'post_status' => 'publish' ) );
		$dna = open_station_living_tree_branch_dna();
		$this->assertLessThanOrEqual( 12, count( $dna ) );
		foreach ( $dna as $hint ) {
			$this->assertSame( array( 'depth', 'girth', 'length' ), array_keys( $hint ) );
			$this->assertGreaterThanOrEqual( 0, $hint['girth'] );
			$this->assertLessThanOrEqual( 1, $hint['girth'] );
		}
	}

	/**
	 * @covers ::open_station_living_tree_build_snapshot
	 */
	public function test_snapshot_filter_can_adjust_the_payload() {
		$filter = static function ( $snapshot ) {
			$snapshot['seoHealth'] = 0.25;
			return $snapshot;
		};
		add_filter( 'desktop_mode_living_tree_snapshot', $filter );
		$snapshot = open_station_living_tree_build_snapshot();
		remove_filter( 'desktop_mode_living_tree_snapshot', $filter );
		$this->assertSame( 0.25, $snapshot['seoHealth'] );
	}

	/**
	 * Load the WPCOM_Stats stub (unless real Jetpack is present) and
	 * reset its script so each test starts from the erroring default —
	 * which behaves exactly like "no Jetpack" (meta fallback).
	 */
	private function load_wpcom_stats_stub() {
		if ( ! class_exists( '\Automattic\Jetpack\Stats\WPCOM_Stats' ) ) {
			require_once dirname( __DIR__ ) . '/stubs/class-wpcom-stats-stub.php';
		}
		if ( property_exists( '\Automattic\Jetpack\Stats\WPCOM_Stats', 'visits_response' ) ) {
			\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = null;
			\Automattic\Jetpack\Stats\WPCOM_Stats::$last_args       = null;
		}
	}

	/**
	 * @covers ::open_station_living_tree_traffic
	 */
	public function test_traffic_sums_recent_post_views_meta() {
		$this->load_wpcom_stats_stub();
		$post_id = self::factory()->post->create();
		$today   = current_time( 'Y-m-d' );
		add_post_meta( $post_id, '_post_views_' . $today, 12 );
		add_post_meta(
			$post_id,
			'_post_views_' . gmdate( 'Y-m-d', strtotime( $today . ' -3 days' ) ),
			5
		);
		// Outside the 14-day window — must not count.
		add_post_meta(
			$post_id,
			'_post_views_' . gmdate( 'Y-m-d', strtotime( $today . ' -20 days' ) ),
			100
		);

		$this->assertSame( 17, open_station_living_tree_traffic() );
	}

	/**
	 * @covers ::open_station_living_tree_traffic
	 * @covers ::open_station_living_tree_jetpack_visits
	 */
	public function test_traffic_prefers_jetpack_visits_over_the_meta_fallback() {
		$this->load_wpcom_stats_stub();
		if ( ! property_exists( '\Automattic\Jetpack\Stats\WPCOM_Stats', 'visits_response' ) ) {
			$this->markTestSkipped( 'Real Jetpack is loaded; the scriptable stub is unavailable.' );
		}

		// Meta says 50 — Jetpack must win anyway (same ladder as the
		// site-views widget).
		$post_id = self::factory()->post->create();
		add_post_meta( $post_id, '_post_views_' . current_time( 'Y-m-d' ), 50 );

		\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = array(
			'unit'   => 'day',
			'fields' => array( 'period', 'views' ),
			'data'   => array(
				array( '2026-07-09', 3 ),
				array( '2026-07-10', 4 ),
				array( '2026-07-11', '2' ), // Numeric strings ship too.
			),
		);
		try {
			$this->assertSame( 9, open_station_living_tree_traffic() );
			$this->assertSame(
				array(
					'unit'     => 'day',
					'quantity' => 14,
				),
				\Automattic\Jetpack\Stats\WPCOM_Stats::$last_args
			);
		} finally {
			\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = null;
		}
	}

	/**
	 * @covers ::open_station_living_tree_jetpack_visits
	 */
	public function test_traffic_honours_the_fields_order_of_the_jetpack_payload() {
		$this->load_wpcom_stats_stub();
		if ( ! property_exists( '\Automattic\Jetpack\Stats\WPCOM_Stats', 'visits_response' ) ) {
			$this->markTestSkipped( 'Real Jetpack is loaded; the scriptable stub is unavailable.' );
		}

		\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = array(
			'fields' => array( 'views', 'period' ),
			'data'   => array( array( 7, '2026-07-11' ), array( 6, '2026-07-10' ) ),
		);
		try {
			$this->assertSame( 13, open_station_living_tree_traffic() );
		} finally {
			\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = null;
		}
	}

	/**
	 * @covers ::open_station_living_tree_traffic
	 * @covers ::open_station_living_tree_jetpack_visits
	 */
	public function test_traffic_falls_back_to_meta_when_jetpack_errors_or_misbehaves() {
		$this->load_wpcom_stats_stub();
		if ( ! property_exists( '\Automattic\Jetpack\Stats\WPCOM_Stats', 'visits_response' ) ) {
			$this->markTestSkipped( 'Real Jetpack is loaded; the scriptable stub is unavailable.' );
		}

		$post_id = self::factory()->post->create();
		add_post_meta( $post_id, '_post_views_' . current_time( 'Y-m-d' ), 8 );

		// Default script → WP_Error → fallback.
		$this->assertSame( 8, open_station_living_tree_traffic() );

		// Garbage payload (no data rows) → fallback too.
		\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = array( 'unexpected' => true );
		try {
			$this->assertSame( 8, open_station_living_tree_traffic() );
		} finally {
			\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = null;
		}
	}

	/**
	 * @covers ::open_station_living_tree_performance
	 * @covers ::open_station_living_tree_site_health_performance
	 */
	public function test_performance_defaults_when_site_health_has_never_run() {
		$this->assertSame( 0.8, open_station_living_tree_performance() );
	}

	/**
	 * @covers ::open_station_living_tree_performance
	 * @covers ::open_station_living_tree_site_health_performance
	 */
	public function test_performance_composes_site_health_tallies() {
		// Core's weekly cron stores the tallies as a JSON string.
		set_transient(
			'health-check-site-status-result',
			wp_json_encode(
				array(
					'good'        => 15,
					'recommended' => 2,
					'critical'    => 1,
				)
			)
		);
		// 1.0 − 0.15·1 − 0.04·2 = 0.77.
		$this->assertEqualsWithDelta( 0.77, open_station_living_tree_performance(), 0.0001 );
	}

	/**
	 * @covers ::open_station_living_tree_site_health_performance
	 */
	public function test_performance_is_floored_so_a_broken_site_never_fully_stalls() {
		set_transient(
			'health-check-site-status-result',
			wp_json_encode(
				array(
					'good'        => 0,
					'recommended' => 10,
					'critical'    => 10,
				)
			)
		);
		$this->assertSame( 0.2, open_station_living_tree_performance() );
	}

	/**
	 * @covers ::open_station_living_tree_site_health_performance
	 */
	public function test_performance_falls_back_on_garbage_tallies() {
		set_transient( 'health-check-site-status-result', 'not json at all' );
		$this->assertSame( 0.8, open_station_living_tree_performance() );

		set_transient( 'health-check-site-status-result', wp_json_encode( array( 'surprise' => 1 ) ) );
		$this->assertSame( 0.8, open_station_living_tree_performance() );
	}

	/**
	 * @covers ::open_station_living_tree_performance
	 */
	public function test_performance_filter_is_the_final_word() {
		set_transient(
			'health-check-site-status-result',
			wp_json_encode(
				array(
					'good'        => 20,
					'recommended' => 0,
					'critical'    => 0,
				)
			)
		);
		$filter = static function () {
			return 0.33;
		};
		add_filter( 'open_station_living_tree_performance', $filter );
		$performance = open_station_living_tree_performance();
		remove_filter( 'open_station_living_tree_performance', $filter );
		$this->assertSame( 0.33, $performance );
	}

	/**
	 * @covers ::open_station_living_tree_traffic
	 */
	public function test_traffic_filter_is_the_final_word() {
		$this->load_wpcom_stats_stub();
		$filter = static function () {
			return 4321;
		};
		add_filter( 'open_station_living_tree_traffic', $filter );
		$traffic = open_station_living_tree_traffic();
		remove_filter( 'open_station_living_tree_traffic', $filter );
		$this->assertSame( 4321, $traffic );
	}
}
