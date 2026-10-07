<?php

class Tests_OpenStation_LivingTreeSnapshot extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		delete_transient( 'desktop_mode_living_tree_snapshot' );
		delete_transient( 'health-check-site-status-result' );
	}

	public function test_snapshot_has_the_full_expected_shape() {
		$snapshot = openstation_living_tree_build_snapshot();

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

	public function test_snapshot_field_types_and_bounds() {
		$snapshot = openstation_living_tree_build_snapshot();

		$this->assertNotEmpty( $snapshot['siteUrl'] );
		$this->assertIsString( $snapshot['siteUrl'] );

		$this->assertIsString( $snapshot['siteName'] );
		$this->assertSame( get_bloginfo( 'name' ), $snapshot['siteName'] );

		$this->assertGreaterThanOrEqual( 0, $snapshot['siteAgeDays'] );

		foreach ( array( 'totalPosts', 'totalPages', 'totalCategories', 'totalTags', 'totalComments', 'activeUsers', 'traffic' ) as $key ) {
			$this->assertGreaterThanOrEqual( 0, $snapshot[ $key ], "{$key} must be >= 0" );
		}

		foreach ( array( 'seoHealth', 'performance' ) as $key ) {
			$this->assertGreaterThanOrEqual( 0, $snapshot[ $key ], "{$key} must be >= 0" );
			$this->assertLessThanOrEqual( 1, $snapshot[ $key ], "{$key} must be <= 1" );
		}

		$this->assertIsArray( $snapshot['branches'] );
	}

	public function test_permission_gate_default_and_filter() {
		$admin = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin );
		$this->assertTrue( openstation_living_tree_user_can_use() );

		add_filter( 'openstation_living_tree_user_can_use', '__return_false' );
		$this->assertFalse( openstation_living_tree_user_can_use() );
		remove_filter( 'openstation_living_tree_user_can_use', '__return_false' );
	}

	public function test_snapshot_route_is_registered() {
		$routes = rest_get_server()->get_routes();
		$this->assertArrayHasKey( '/desktop-mode/v1/living-tree/snapshot', $routes );
	}

	public function test_flush_cache_clears_the_transient() {
		set_transient( 'desktop_mode_living_tree_snapshot', array( 'stale' => true ), HOUR_IN_SECONDS );
		openstation_living_tree_flush_cache();
		$this->assertFalse( get_transient( 'desktop_mode_living_tree_snapshot' ) );
	}

	public function test_snapshot_totals_reflect_published_content() {
		self::factory()->post->create_many( 3, array( 'post_status' => 'publish' ) );
		self::factory()->post->create( array( 'post_status' => 'draft' ) );
		self::factory()->post->create(
			array(
				'post_type'   => 'page',
				'post_status' => 'publish',
			)
		);

		$snapshot = openstation_living_tree_build_snapshot();
		$this->assertGreaterThanOrEqual( 3, $snapshot['totalPosts'] );
		$this->assertGreaterThanOrEqual( 1, $snapshot['totalPages'] );

		$this->assertLessThan( 5, $snapshot['totalPosts'] );
	}

	public function test_install_epoch_is_stable_and_site_age_non_negative() {
		$first  = openstation_living_tree_install_epoch();
		$second = openstation_living_tree_install_epoch();
		$this->assertSame( $first, $second );

		$this->assertGreaterThan( 0, $first );
		$this->assertGreaterThanOrEqual( 0, openstation_living_tree_site_age_days() );
	}

	public function test_branch_dna_is_capped_and_normalised() {
		self::factory()->post->create_many( 2, array( 'post_status' => 'publish' ) );
		$dna = openstation_living_tree_branch_dna();
		$this->assertLessThanOrEqual( 12, count( $dna ) );
		foreach ( $dna as $hint ) {
			$this->assertSame( array( 'depth', 'girth', 'length' ), array_keys( $hint ) );
			$this->assertGreaterThanOrEqual( 0, $hint['girth'] );
			$this->assertLessThanOrEqual( 1, $hint['girth'] );
		}
	}

	public function test_snapshot_filter_can_adjust_the_payload() {
		$filter = static function ( $snapshot ) {
			$snapshot['seoHealth'] = 0.25;
			return $snapshot;
		};
		add_filter( 'openstation_living_tree_snapshot', $filter );
		$snapshot = openstation_living_tree_build_snapshot();
		remove_filter( 'openstation_living_tree_snapshot', $filter );
		$this->assertSame( 0.25, $snapshot['seoHealth'] );
	}

	private function load_wpcom_stats_stub() {
		if ( ! class_exists( '\Automattic\Jetpack\Stats\WPCOM_Stats' ) ) {
			require_once dirname( __DIR__ ) . '/stubs/class-wpcom-stats-stub.php';
		}
		if ( property_exists( '\Automattic\Jetpack\Stats\WPCOM_Stats', 'visits_response' ) ) {
			\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = null;
			\Automattic\Jetpack\Stats\WPCOM_Stats::$last_args       = null;
		}
		if ( property_exists( '\Automattic\Jetpack\Modules', 'stats_active' ) ) {
			\Automattic\Jetpack\Modules::$stats_active = true;
		}
	}

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

		add_post_meta(
			$post_id,
			'_post_views_' . gmdate( 'Y-m-d', strtotime( $today . ' -20 days' ) ),
			100
		);

		$this->assertSame( 17, openstation_living_tree_traffic() );
	}

	public function test_traffic_prefers_jetpack_visits_over_the_meta_fallback() {
		$this->load_wpcom_stats_stub();
		if ( ! property_exists( '\Automattic\Jetpack\Stats\WPCOM_Stats', 'visits_response' ) ) {
			$this->markTestSkipped( 'Real Jetpack is loaded; the scriptable stub is unavailable.' );
		}

		$post_id = self::factory()->post->create();
		add_post_meta( $post_id, '_post_views_' . current_time( 'Y-m-d' ), 50 );

		\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = array(
			'unit'   => 'day',
			'fields' => array( 'period', 'views' ),
			'data'   => array(
				array( '2026-07-09', 3 ),
				array( '2026-07-10', 4 ),
				array( '2026-07-11', '2' ),
			),
		);
		try {
			$this->assertSame( 9, openstation_living_tree_traffic() );
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
			$this->assertSame( 13, openstation_living_tree_traffic() );
		} finally {
			\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = null;
		}
	}

	public function test_traffic_falls_back_to_meta_when_jetpack_errors_or_misbehaves() {
		$this->load_wpcom_stats_stub();
		if ( ! property_exists( '\Automattic\Jetpack\Stats\WPCOM_Stats', 'visits_response' ) ) {
			$this->markTestSkipped( 'Real Jetpack is loaded; the scriptable stub is unavailable.' );
		}

		$post_id = self::factory()->post->create();
		add_post_meta( $post_id, '_post_views_' . current_time( 'Y-m-d' ), 8 );

		$this->assertSame( 8, openstation_living_tree_traffic() );

		\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = array( 'unexpected' => true );
		try {
			$this->assertSame( 8, openstation_living_tree_traffic() );

			\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = array(
				'fields' => array( 'period', 'views' ),
				'data'   => array( array( '2026-07-11', 0 ) ),
			);
			\Automattic\Jetpack\Modules::$stats_active = false;
			$this->assertSame( 8, openstation_living_tree_traffic() );
		} finally {
			\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = null;
			\Automattic\Jetpack\Modules::$stats_active              = true;
		}
	}

	public function test_snapshot_withholds_jetpack_traffic_from_a_caller_outside_the_stats_gate() {
		$this->load_wpcom_stats_stub();
		if ( ! property_exists( '\Automattic\Jetpack\Stats\WPCOM_Stats', 'visits_response' ) ) {
			$this->markTestSkipped( 'Real Jetpack is loaded; the scriptable stub is unavailable.' );
		}

		$post_id = self::factory()->post->create();
		add_post_meta( $post_id, '_post_views_' . current_time( 'Y-m-d' ), 8 );
		delete_transient( 'desktop_mode_living_tree_snapshot' );

		\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = array(
			'fields' => array( 'period', 'views' ),
			'data'   => array( array( '2026-07-11', 900 ) ),
		);
		$traffic_reads   = 0;
		$count_reads     = static function ( $views ) use ( &$traffic_reads ) {
			++$traffic_reads;
			return $views;
		};
		$bump_traffic    = static function ( $snapshot ) {
			$snapshot['traffic'] += 1;
			return $snapshot;
		};
		add_filter( 'openstation_living_tree_traffic', $count_reads );
		add_filter( 'openstation_living_tree_snapshot', $bump_traffic );
		try {

			wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
			$data = openstation_living_tree_rest_snapshot()->get_data();
			$this->assertSame( 9, $data['traffic'] );
			$this->assertArrayNotHasKey( OPENSTATION_LIVING_TREE_GATED_TRAFFIC_KEY, $data );

			$reads_after_build = $traffic_reads;
			$this->assertSame( 9, openstation_living_tree_rest_snapshot()->get_data()['traffic'] );
			$this->assertSame( $reads_after_build, $traffic_reads, 'A cached snapshot is served without reading traffic again' );

			wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
			$data = openstation_living_tree_rest_snapshot()->get_data();
			$this->assertSame( 901, $data['traffic'] );
			$this->assertArrayNotHasKey( OPENSTATION_LIVING_TREE_GATED_TRAFFIC_KEY, $data );

			set_transient( 'desktop_mode_living_tree_snapshot', array( 'traffic' => 900 ), HOUR_IN_SECONDS );
			wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
			$this->assertSame( 9, openstation_living_tree_rest_snapshot()->get_data()['traffic'] );
		} finally {
			remove_filter( 'openstation_living_tree_traffic', $count_reads );
			remove_filter( 'openstation_living_tree_snapshot', $bump_traffic );
			\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = null;
		}
	}

	public function test_performance_defaults_when_site_health_has_never_run() {
		$this->assertSame( 0.8, openstation_living_tree_performance() );
	}

	public function test_performance_composes_site_health_tallies() {

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

		$this->assertEqualsWithDelta( 0.77, openstation_living_tree_performance(), 0.0001 );
	}

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
		$this->assertSame( 0.2, openstation_living_tree_performance() );
	}

	public function test_performance_falls_back_on_garbage_tallies() {
		set_transient( 'health-check-site-status-result', 'not json at all' );
		$this->assertSame( 0.8, openstation_living_tree_performance() );

		set_transient( 'health-check-site-status-result', wp_json_encode( array( 'surprise' => 1 ) ) );
		$this->assertSame( 0.8, openstation_living_tree_performance() );
	}

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
		add_filter( 'openstation_living_tree_performance', $filter );
		$performance = openstation_living_tree_performance();
		remove_filter( 'openstation_living_tree_performance', $filter );
		$this->assertSame( 0.33, $performance );
	}

	public function test_traffic_filter_is_the_final_word() {
		$this->load_wpcom_stats_stub();
		$filter = static function () {
			return 4321;
		};
		add_filter( 'openstation_living_tree_traffic', $filter );
		$traffic = openstation_living_tree_traffic();
		remove_filter( 'openstation_living_tree_traffic', $filter );
		$this->assertSame( 4321, $traffic );
	}
}
