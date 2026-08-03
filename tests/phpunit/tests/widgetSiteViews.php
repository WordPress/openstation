<?php
/**
 * Tests for the Site Views widget's meta-aggregation endpoint
 * (`includes/widgets/widget-site-views.php`) — the 14-day
 * `_post_views_YYYY-MM-DD` summer and its 5-minute transient cache.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 */
class Tests_OpenStation_WidgetSiteViews extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		delete_transient( 'desktop_mode_site_views_meta' );
	}

	public function tear_down() {
		delete_transient( 'desktop_mode_site_views_meta' );
		parent::tear_down();
	}

	/**
	 * @covers ::openstation_site_views_meta_callback
	 */
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

	/**
	 * @covers ::openstation_site_views_meta_callback
	 */
	public function test_result_is_served_from_the_transient() {
		$today = current_time( 'Y-m-d' );
		$a     = self::factory()->post->create();
		update_post_meta( $a, '_post_views_' . $today, 5 );

		$first = openstation_site_views_meta_callback( null );
		$this->assertSame( 5, end( $first['days'] )['views'] );

		// Bump the counter after the first call — cache must win.
		update_post_meta( $a, '_post_views_' . $today, 10 );
		$second = openstation_site_views_meta_callback( null );
		$this->assertSame( $first, $second, 'second call inside the TTL is a cache hit' );

		delete_transient( 'desktop_mode_site_views_meta' );
		$third = openstation_site_views_meta_callback( null );
		$this->assertSame( 10, end( $third['days'] )['views'] );
	}
}
