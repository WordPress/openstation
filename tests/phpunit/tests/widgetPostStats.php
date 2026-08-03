<?php
/**
 * Tests for the Post Stats widget's aggregation endpoint
 * (`includes/widgets/widget-post-stats.php`).
 *
 * Covers the bucket shape (fixed 6-month zero-filled axis), the
 * capability scoping (drafts are own-only without
 * `edit_others_posts`), and the 5-minute transient cache.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 */
class Tests_OpenStation_WidgetPostStats extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $author_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$author_id = $factory->user->create( array( 'role' => 'author' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
		$this->flush_stats_cache();
	}

	public function tear_down() {
		$this->flush_stats_cache();
		parent::tear_down();
	}

	private function flush_stats_cache() {
		delete_transient( 'desktop_mode_post_stats_all' );
		delete_transient( 'desktop_mode_post_stats_own_' . self::$admin_id );
		delete_transient( 'desktop_mode_post_stats_own_' . self::$author_id );
	}

	/**
	 * @covers ::open_station_post_stats_callback
	 */
	public function test_six_zero_filled_buckets_oldest_first() {
		$result = open_station_post_stats_callback();

		$this->assertCount( 6, $result['months'] );
		$yms = wp_list_pluck( $result['months'], 'ym' );
		$this->assertSame( current_time( 'Y-m' ), end( $yms ), 'newest bucket is the current month' );
		$sorted = $yms;
		sort( $sorted );
		$this->assertSame( $sorted, $yms, 'buckets are oldest-first' );
		foreach ( $result['months'] as $bucket ) {
			$this->assertSame( 0, $bucket['publish'] );
			$this->assertSame( 0, $bucket['draft'] );
			$this->assertSame( 0, $bucket['pending'] );
		}
	}

	/**
	 * @covers ::open_station_post_stats_callback
	 */
	public function test_counts_land_in_the_current_month_bucket() {
		self::factory()->post->create_many( 2, array( 'post_status' => 'publish' ) );
		self::factory()->post->create( array( 'post_status' => 'draft' ) );
		self::factory()->post->create( array( 'post_status' => 'pending' ) );

		$result  = open_station_post_stats_callback();
		$current = end( $result['months'] );

		$this->assertSame( 2, $current['publish'] );
		$this->assertSame( 1, $current['draft'] );
		$this->assertSame( 1, $current['pending'] );
	}

	/**
	 * @covers ::open_station_post_stats_callback
	 */
	public function test_drafts_are_own_only_without_edit_others_posts() {
		self::factory()->post->create( array(
			'post_status' => 'draft',
			'post_author' => self::$admin_id,
		) );
		self::factory()->post->create( array(
			'post_status' => 'draft',
			'post_author' => self::$author_id,
		) );
		self::factory()->post->create( array(
			'post_status' => 'publish',
			'post_author' => self::$admin_id,
		) );

		// Admin (edit_others_posts) sees every draft.
		$admin_current = end( open_station_post_stats_callback()['months'] );
		$this->assertSame( 2, $admin_current['draft'] );

		// Author sees only their own draft — but all published posts.
		wp_set_current_user( self::$author_id );
		$author_current = end( open_station_post_stats_callback()['months'] );
		$this->assertSame( 1, $author_current['draft'] );
		$this->assertSame( 1, $author_current['publish'] );
	}

	/**
	 * @covers ::open_station_post_stats_callback
	 */
	public function test_result_is_served_from_the_transient() {
		$first = open_station_post_stats_callback();

		// New post after the first call — the cached result must win.
		self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$second = open_station_post_stats_callback();
		$this->assertSame( $first, $second, 'second call inside the TTL is a cache hit' );

		// Busting the transient recomputes.
		delete_transient( 'desktop_mode_post_stats_all' );
		$third_current = end( open_station_post_stats_callback()['months'] );
		$this->assertSame( 1, $third_current['publish'] );
	}
}
