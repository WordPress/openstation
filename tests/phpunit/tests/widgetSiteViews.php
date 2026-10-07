<?php

class Tests_OpenStation_WidgetSiteViews extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		delete_transient( 'desktop_mode_site_views_meta' );
	}

	public function tear_down() {
		delete_transient( 'desktop_mode_site_views_meta' );
		$this->reset_jetpack_stubs();
		parent::tear_down();
	}

	private function reset_jetpack_stubs() {
		if ( property_exists( '\Automattic\Jetpack\Stats\WPCOM_Stats', 'visits_response' ) ) {
			\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = null;
			\Automattic\Jetpack\Stats\WPCOM_Stats::$last_args       = null;
		}
		if ( property_exists( '\Automattic\Jetpack\Modules', 'stats_active' ) ) {
			\Automattic\Jetpack\Modules::$stats_active = true;
		}
	}

	private function load_wpcom_stats_stub() {
		if ( ! class_exists( '\Automattic\Jetpack\Stats\WPCOM_Stats' ) ) {
			require_once dirname( __DIR__ ) . '/stubs/class-wpcom-stats-stub.php';
		}
		if ( ! property_exists( '\Automattic\Jetpack\Stats\WPCOM_Stats', 'visits_response' )
			|| ! property_exists( '\Automattic\Jetpack\Modules', 'stats_active' ) ) {
			$this->markTestSkipped( 'Real Jetpack is loaded; the scriptable stubs are unavailable.' );
		}
		$this->reset_jetpack_stubs();
	}

	private function get_jetpack_route_as( $role ) {
		wp_set_current_user( self::factory()->user->create( array( 'role' => $role ) ) );
		return rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/desktop-mode/v1/site-views-jetpack' ) );
	}

	public function test_jetpack_visits_are_mapped_to_daily_rows() {
		$this->load_wpcom_stats_stub();
		\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = array(
			'unit'   => 'day',
			'fields' => array( 'views', 'period', 'visitors' ),
			'data'   => array(
				array( '4', '2026-07-11', 2 ),
				array( 3, '2026-07-10', 1 ),
			),
		);

		$response = $this->get_jetpack_route_as( 'administrator' );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array(
				'available'  => true,
				'restricted' => false,
				'days'       => array(
					array(
						'date'  => '2026-07-10',
						'views' => 3,
					),
					array(
						'date'  => '2026-07-11',
						'views' => 4,
					),
				),
			),
			$response->get_data()
		);
		$this->assertSame(
			array(
				'unit'     => 'day',
				'quantity' => 14,
			),
			\Automattic\Jetpack\Stats\WPCOM_Stats::$last_args
		);
	}

	public function test_jetpack_source_is_restricted_without_the_stats_gate() {
		$this->load_wpcom_stats_stub();
		\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = array(
			'fields' => array( 'period', 'views' ),
			'data'   => array( array( '2026-07-11', 9 ) ),
		);

		$response = $this->get_jetpack_route_as( 'author' );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array(
				'available'  => false,
				'restricted' => true,
				'days'       => array(),
			),
			$response->get_data()
		);
		$this->assertNull( \Automattic\Jetpack\Stats\WPCOM_Stats::$last_args, 'WordPress.com is not asked for a caller without the gate' );

		$this->assertSame( 403, $this->get_jetpack_route_as( 'subscriber' )->get_status() );
	}

	public function test_jetpack_source_is_unavailable_when_stats_cannot_answer() {
		$this->load_wpcom_stats_stub();

		$this->assertFalse( $this->get_jetpack_route_as( 'administrator' )->get_data()['available'] );

		\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = array(
			'fields' => array( 'period', 'visitors' ),
			'data'   => array( array( '2026-07-11', 9 ) ),
		);
		$this->assertFalse( $this->get_jetpack_route_as( 'administrator' )->get_data()['available'] );

		\Automattic\Jetpack\Stats\WPCOM_Stats::$visits_response = array(
			'fields' => array( 'period', 'views' ),
			'data'   => array( array( '2026-07-11', 0 ) ),
		);
		\Automattic\Jetpack\Stats\WPCOM_Stats::$last_args = null;
		\Automattic\Jetpack\Modules::$stats_active        = false;
		$data = $this->get_jetpack_route_as( 'author' )->get_data();
		$this->assertFalse( $data['available'] );
		$this->assertFalse( $data['restricted'], 'Nothing is withheld on a site where Jetpack Stats is off' );
		$this->assertFalse( $this->get_jetpack_route_as( 'administrator' )->get_data()['available'] );
		$this->assertNull( \Automattic\Jetpack\Stats\WPCOM_Stats::$last_args );
	}

	public function test_aggregates_todays_views_across_posts() {
		$today = current_time( 'Y-m-d' );
		$a     = self::factory()->post->create();
		$b     = self::factory()->post->create();
		update_post_meta( $a, '_post_views_' . $today, 3 );
		update_post_meta( $b, '_post_views_' . $today, 4 );

		$result = openstation_site_views_meta_callback( null );

		$this->assertSame( 'post-meta', $result['source'] );
		$this->assertTrue( $result['has_data'] );
		$this->assertCount( 14, $result['days'] );
		$last = end( $result['days'] );
		$this->assertSame( $today, $last['date'] );
		$this->assertSame( 7, $last['views'] );
	}

	public function test_result_is_served_from_the_transient() {
		$today = current_time( 'Y-m-d' );
		$a     = self::factory()->post->create();
		update_post_meta( $a, '_post_views_' . $today, 5 );

		$first = openstation_site_views_meta_callback( null );
		$this->assertSame( 5, end( $first['days'] )['views'] );

		update_post_meta( $a, '_post_views_' . $today, 10 );
		$second = openstation_site_views_meta_callback( null );
		$this->assertSame( $first, $second, 'second call inside the TTL is a cache hit' );

		delete_transient( 'desktop_mode_site_views_meta' );
		$third = openstation_site_views_meta_callback( null );
		$this->assertSame( 10, end( $third['days'] )['views'] );
	}
}
