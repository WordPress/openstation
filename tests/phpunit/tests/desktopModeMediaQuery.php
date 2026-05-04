<?php
/**
 * Tests for the media-query dimension-filter module.
 *
 * Covers the numeric dimension meta-stamping hook, the REST
 * `/wp/v2/media` query-arg injection, and the opportunistic
 * backfill sweep.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-media-query
 */
class Tests_DesktopMode_MediaQuery extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function tear_down() {
		delete_option( DESKTOP_MODE_BACKFILL_DONE_OPTION );
		parent::tear_down();
	}

	/**
	 * Helper: create an attachment with a known width/height stamped
	 * in `_wp_attachment_metadata`. Mirrors what real uploads look
	 * like without needing an actual file.
	 */
	private function make_attachment( int $width, int $height, string $mime = 'image/jpeg' ): int {
		$attachment_id = self::factory()->attachment->create(
			array( 'post_mime_type' => $mime )
		);
		wp_update_attachment_metadata(
			$attachment_id,
			array(
				'width'  => $width,
				'height' => $height,
			)
		);
		return $attachment_id;
	}

	/**
	 * @covers ::desktop_mode_stamp_media_dimensions
	 */
	public function test_stamp_writes_flat_numeric_meta_on_upload() {
		$attachment_id = $this->make_attachment( 1920, 1080 );

		$this->assertSame(
			'1920',
			get_post_meta( $attachment_id, DESKTOP_MODE_META_WIDTH, true )
		);
		$this->assertSame(
			'1080',
			get_post_meta( $attachment_id, DESKTOP_MODE_META_HEIGHT, true )
		);
	}

	/**
	 * @covers ::desktop_mode_stamp_media_dimensions
	 */
	public function test_stamp_handles_missing_dimensions_with_zero() {
		$attachment_id = self::factory()->attachment->create(
			array( 'post_mime_type' => 'image/svg+xml' )
		);
		wp_update_attachment_metadata( $attachment_id, array() );

		// Explicit zeros — lets the backfill sweep distinguish
		// "never inspected" (no meta) from "inspected, has no size".
		$this->assertSame( '0', get_post_meta( $attachment_id, DESKTOP_MODE_META_WIDTH, true ) );
		$this->assertSame( '0', get_post_meta( $attachment_id, DESKTOP_MODE_META_HEIGHT, true ) );
	}

	/**
	 * @covers ::desktop_mode_register_media_query_params
	 */
	public function test_collection_params_register_the_dimension_filters() {
		$route_options = rest_get_server()->get_routes( 'wp/v2' );

		$this->assertArrayHasKey( '/wp/v2/media', $route_options );

		$get_route = null;
		foreach ( $route_options['/wp/v2/media'] as $endpoint ) {
			if ( in_array( 'GET', $endpoint['methods'] ? array_keys( $endpoint['methods'] ) : array(), true ) ) {
				$get_route = $endpoint;
				break;
			}
		}
		$this->assertNotNull( $get_route, 'Expected a GET handler on /wp/v2/media.' );
		$this->assertArrayHasKey( 'desktop_mode_min_width', $get_route['args'] );
		$this->assertArrayHasKey( 'desktop_mode_min_height', $get_route['args'] );
	}

	/**
	 * End-to-end: a REST GET on `/wp/v2/media` with
	 * `desktop_mode_min_width` only returns images meeting the threshold.
	 *
	 * @covers ::desktop_mode_filter_media_by_dimensions
	 */
	public function test_rest_media_query_filters_by_min_width() {
		$small = $this->make_attachment( 800, 600 );
		$big   = $this->make_attachment( 1920, 1080 );

		wp_set_current_user( self::$admin_id );

		$request = new WP_REST_Request( 'GET', '/wp/v2/media' );
		$request->set_param( 'desktop_mode_min_width', 1920 );
		$request->set_param( 'media_type', 'image' );
		$request->set_param( 'per_page', 100 );

		$response = rest_do_request( $request );
		$this->assertSame( 200, $response->get_status() );

		$ids = wp_list_pluck( $response->get_data(), 'id' );
		$this->assertContains( $big, $ids );
		$this->assertNotContains( $small, $ids );
	}

	/**
	 * @covers ::desktop_mode_filter_media_by_dimensions
	 */
	public function test_rest_media_query_filters_by_min_width_and_height() {
		$wide   = $this->make_attachment( 2000, 500 );   // wide enough, too short
		$tall   = $this->make_attachment( 500, 2000 );   // tall enough, too narrow
		$hd     = $this->make_attachment( 1920, 1080 );  // both pass

		wp_set_current_user( self::$admin_id );

		$request = new WP_REST_Request( 'GET', '/wp/v2/media' );
		$request->set_param( 'desktop_mode_min_width', 1920 );
		$request->set_param( 'desktop_mode_min_height', 1080 );
		$request->set_param( 'media_type', 'image' );
		$request->set_param( 'per_page', 100 );

		$response = rest_do_request( $request );
		$ids      = wp_list_pluck( $response->get_data(), 'id' );

		$this->assertContains( $hd, $ids );
		$this->assertNotContains( $wide, $ids );
		$this->assertNotContains( $tall, $ids );
	}

	/**
	 * Without the dimension params, the filter is a no-op — every
	 * image comes back regardless of size.
	 *
	 * @covers ::desktop_mode_filter_media_by_dimensions
	 */
	public function test_rest_media_query_without_params_returns_all() {
		$small = $this->make_attachment( 100, 100 );
		$big   = $this->make_attachment( 1920, 1080 );

		wp_set_current_user( self::$admin_id );

		$request = new WP_REST_Request( 'GET', '/wp/v2/media' );
		$request->set_param( 'media_type', 'image' );
		$request->set_param( 'per_page', 100 );

		$response = rest_do_request( $request );
		$ids      = wp_list_pluck( $response->get_data(), 'id' );

		$this->assertContains( $small, $ids );
		$this->assertContains( $big, $ids );
	}

	/**
	 * @covers ::desktop_mode_backfill_media_dimensions
	 */
	public function test_backfill_stamps_attachments_without_dimension_meta() {
		// Create attachment but strip the dim meta to simulate a
		// pre-0.5.0 upload that predates the stamping hook.
		$attachment_id = $this->make_attachment( 1920, 1080 );
		delete_post_meta( $attachment_id, DESKTOP_MODE_META_WIDTH );
		delete_post_meta( $attachment_id, DESKTOP_MODE_META_HEIGHT );

		$processed = desktop_mode_backfill_media_dimensions( 10 );

		$this->assertSame( 1, $processed );
		$this->assertSame(
			'1920',
			get_post_meta( $attachment_id, DESKTOP_MODE_META_WIDTH, true )
		);
	}

	/**
	 * @covers ::desktop_mode_backfill_media_dimensions
	 */
	public function test_backfill_flips_completion_flag_when_nothing_left() {
		// Every attachment is already stamped; backfill should
		// process zero and flip the done flag so future filtered
		// requests skip the sweep query entirely.
		$this->make_attachment( 1920, 1080 );
		$this->make_attachment( 1024, 768 );

		$processed = desktop_mode_backfill_media_dimensions( 10 );

		$this->assertSame( 0, $processed );
		$this->assertSame( '1', (string) get_option( DESKTOP_MODE_BACKFILL_DONE_OPTION ) );
	}

	/**
	 * @covers ::desktop_mode_backfill_media_dimensions
	 */
	public function test_backfill_noop_after_flag_is_set() {
		update_option( DESKTOP_MODE_BACKFILL_DONE_OPTION, 1 );

		// Even with unstamped attachments, done flag short-circuits.
		$attachment_id = $this->make_attachment( 1920, 1080 );
		delete_post_meta( $attachment_id, DESKTOP_MODE_META_WIDTH );

		$processed = desktop_mode_backfill_media_dimensions( 10 );

		$this->assertSame( 0, $processed );
		$this->assertSame(
			'',
			get_post_meta( $attachment_id, DESKTOP_MODE_META_WIDTH, true )
		);
	}
}
