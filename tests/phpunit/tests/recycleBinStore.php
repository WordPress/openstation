<?php
/**
 * Tests for the Recycle Bin store helpers.
 *
 * Focuses on `open_station_recycle_bin_empty()` — specifically the
 * per-call chunk cap (issue #97). The function MUST keep its cap
 * (so a 10k-item bin doesn't blow PHP's max_execution_time on a
 * single REST call) AND MUST report `remaining > 0` so the client
 * can iterate.
 *
 * Also covers `open_station_recycle_bin_count()` capability scoping —
 * the badge count must mirror the per-item `edit_post` gate the list
 * applies, never disclosing the global trash total to users who can't
 * see those items.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 */
class Tests_OpenStation_RecycleBinStore extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $author_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$author_id     = $factory->user->create( array( 'role' => 'author' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		remove_all_filters( 'open_station_recycle_bin_empty_chunk_size' );
		parent::tear_down();
	}

	private function trash_n_posts( int $n ): array {
		$ids = array();
		for ( $i = 0; $i < $n; $i++ ) {
			$post_id = self::factory()->post->create(
				array(
					'post_status' => 'publish',
					'post_title'  => 'trash-target-' . $i,
				)
			);
			wp_trash_post( $post_id );
			$ids[] = $post_id;
		}
		return $ids;
	}

	/**
	 * @covers ::open_station_recycle_bin_empty
	 */
	public function test_single_call_purges_at_most_one_chunk_and_reports_remaining() {
		// 250 trashed items — well over the 200 default chunk size.
		$this->trash_n_posts( 250 );

		$result = open_station_recycle_bin_empty();

		$this->assertSame( 200, $result['purged'], 'Should cap at the chunk size.' );
		$this->assertSame( 0, $result['skipped'] );
		$this->assertSame(
			50,
			$result['remaining'],
			'Should report 50 items still in the bin so the client can loop.'
		);
	}

	/**
	 * @covers ::open_station_recycle_bin_empty
	 */
	public function test_iterating_until_remaining_is_zero_empties_the_bin() {
		$this->trash_n_posts( 250 );

		$total_purged = 0;
		$loops        = 0;
		do {
			$result        = open_station_recycle_bin_empty();
			$total_purged += $result['purged'];
			$loops++;
			$this->assertLessThanOrEqual(
				5,
				$loops,
				'Two chunks should be enough; bail out before pinning the test.'
			);
		} while ( $result['remaining'] > 0 );

		$this->assertSame( 250, $total_purged );
		$this->assertSame( 0, $result['remaining'] );

		// Sanity check — the bin really is empty now.
		$after = open_station_recycle_bin_get_items( array( 'per_page' => 1 ) );
		$this->assertSame( 0, $after['total'] );
	}

	/**
	 * @covers ::open_station_recycle_bin_empty
	 */
	public function test_chunk_size_filter_is_honored() {
		$this->trash_n_posts( 30 );
		add_filter(
			'open_station_recycle_bin_empty_chunk_size',
			static function () {
				return 10;
			}
		);

		$result = open_station_recycle_bin_empty();

		$this->assertSame( 10, $result['purged'], 'Filter should override the default chunk size.' );
		$this->assertSame( 20, $result['remaining'] );
	}

	/**
	 * @covers ::open_station_recycle_bin_empty
	 */
	public function test_chunk_size_filter_floors_to_one() {
		$this->trash_n_posts( 3 );
		add_filter(
			'open_station_recycle_bin_empty_chunk_size',
			static function () {
				return 0;
			}
		);

		$result = open_station_recycle_bin_empty();

		// Zero or negative should not freeze — clamp to 1.
		$this->assertSame( 1, $result['purged'] );
		$this->assertSame( 2, $result['remaining'] );
	}

	private function trash_post_as( int $author_id, string $title ): int {
		$post_id = self::factory()->post->create(
			array(
				'post_status' => 'publish',
				'post_author' => $author_id,
				'post_title'  => $title,
			)
		);
		wp_trash_post( $post_id );
		return $post_id;
	}

	/**
	 * @covers ::open_station_recycle_bin_count
	 */
	public function test_count_is_global_for_users_with_edit_others_posts() {
		$this->trash_post_as( self::$admin_id, 'admin-trash-1' );
		$this->trash_post_as( self::$admin_id, 'admin-trash-2' );
		$this->trash_post_as( self::$author_id, 'author-trash-1' );

		wp_set_current_user( self::$admin_id );

		$this->assertSame( 3, open_station_recycle_bin_count() );
	}

	/**
	 * @covers ::open_station_recycle_bin_count
	 */
	public function test_count_is_author_scoped_without_edit_others_posts() {
		$this->trash_post_as( self::$admin_id, 'admin-trash-1' );
		$this->trash_post_as( self::$admin_id, 'admin-trash-2' );
		$this->trash_post_as( self::$author_id, 'author-trash-1' );

		wp_set_current_user( self::$author_id );

		$this->assertSame(
			1,
			open_station_recycle_bin_count(),
			'Authors should only see their own trashed posts counted, not the global total.'
		);
	}

	/**
	 * @covers ::open_station_recycle_bin_count
	 */
	public function test_count_is_zero_for_users_without_edit_posts() {
		$this->trash_post_as( self::$admin_id, 'admin-trash-1' );
		$this->trash_post_as( self::$author_id, 'author-trash-1' );

		wp_set_current_user( self::$subscriber_id );

		$this->assertSame(
			0,
			open_station_recycle_bin_count(),
			'Subscribers must not learn the global trash total from the badge count.'
		);
	}

	/**
	 * @covers ::open_station_recycle_bin_heartbeat_received
	 */
	public function test_heartbeat_attaches_count_only_when_changed() {
		$this->trash_n_posts( 2 );
		$latest = (int) get_option( OPEN_STATION_RECYCLE_BIN_CHANGE_OPTION, 0 );
		$this->assertGreaterThan( 0, $latest, 'trashing bumps the change ts' );

		// Client behind the high-water mark → changed + count attached.
		$stale = open_station_recycle_bin_heartbeat_received(
			array(),
			array( 'open_station_recycle_bin_seen_ts' => 0 )
		);
		$this->assertTrue( $stale['open_station_recycle_bin']['changed'] );
		$this->assertSame( 2, $stale['open_station_recycle_bin']['count'] );

		// Client caught up → no count key, no COUNT(*) work.
		$caught_up = open_station_recycle_bin_heartbeat_received(
			array(),
			array( 'open_station_recycle_bin_seen_ts' => $latest )
		);
		$this->assertFalse( $caught_up['open_station_recycle_bin']['changed'] );
		$this->assertSame( $latest, $caught_up['open_station_recycle_bin']['ts'] );
		$this->assertArrayNotHasKey( 'count', $caught_up['open_station_recycle_bin'] );
	}

	/**
	 * @covers ::open_station_recycle_bin_heartbeat_received
	 */
	public function test_heartbeat_ignores_ticks_without_the_seen_ts_field() {
		$response = open_station_recycle_bin_heartbeat_received( array(), array() );
		$this->assertArrayNotHasKey( 'open_station_recycle_bin', $response );
	}

	/**
	 * @covers ::open_station_recycle_bin_inject_shell_config
	 * @covers ::open_station_recycle_bin_localize_config
	 */
	public function test_config_filters_inject_recycle_bin_post_types() {
		// Test shell config injection
		$config = apply_filters( 'open_station_shell_config', array() );
		$this->assertIsArray( $config );
		$this->assertArrayHasKey( 'recycleBinPostTypes', $config );
		$this->assertIsArray( $config['recycleBinPostTypes'] );
		$this->assertContains( 'post', $config['recycleBinPostTypes'] );
		$this->assertContains( 'page', $config['recycleBinPostTypes'] );
		$this->assertContains( 'attachment', $config['recycleBinPostTypes'] );

		// Register the script so wp_localize_script works
		wp_register_script( 'desktop-mode-recycle-bin', '' );

		// Test localized config injection
		open_station_recycle_bin_localize_config();
		$data = wp_scripts()->get_data( 'desktop-mode-recycle-bin', 'data' );
		$this->assertNotEmpty( $data );
		$this->assertStringContainsString( 'openStationRecycleBinConfig', $data );
		$this->assertStringContainsString( '"postTypes":["post","page","attachment"', $data );
	}
}
