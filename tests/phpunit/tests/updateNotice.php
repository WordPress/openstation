<?php
/**
 * Tests for the core-update toast pipeline:
 *
 *   - `desktop_mode_get_core_update()` — the server-side descriptor
 *     (capability gating, update-state reading, the
 *     `desktop_mode_core_update_notice` filter).
 *   - `desktop_mode_chromeless_suppress_update_nags()` — the in-window
 *     nag suppressor.
 *   - that the descriptor lands in the shell config as `coreUpdate`.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-update-notice
 */
class Tests_DesktopMode_UpdateNotice extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		delete_site_transient( 'update_core' );
	}

	public function tear_down() {
		delete_site_transient( 'update_core' );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		unset( $_GET['desktop_mode_chromeless'] );
		remove_all_filters( 'desktop_mode_core_update_notice' );
		remove_all_filters( 'desktop_mode_core_update_release' );
		remove_all_filters( 'pre_http_request' );
		foreach ( array( '7.0', '9.9', '5.5' ) as $k ) {
			delete_transient( 'desktop_mode_release_art_' . $k );
		}
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_get_core_update
	 */
	public function test_returns_descriptor_when_update_available() {
		wp_set_current_user( self::$admin_id );
		$this->fake_core_update( '9.9.9' );

		$update = desktop_mode_get_core_update();
		$this->assertIsArray( $update );
		$this->assertSame( '9.9.9', $update['version'] );
		$this->assertStringContainsString( 'update-core.php', $update['url'] );
		$this->assertArrayHasKey( 'major', $update );
		$this->assertArrayHasKey( 'release', $update );
	}

	/**
	 * @covers ::desktop_mode_is_major_update
	 */
	public function test_major_update_detection() {
		$this->assertTrue( desktop_mode_is_major_update( '6.9.2', '7.0' ) );
		$this->assertTrue( desktop_mode_is_major_update( '6.8', '6.9' ) );
		$this->assertFalse( desktop_mode_is_major_update( '7.0', '7.0.2' ) );
		$this->assertFalse( desktop_mode_is_major_update( '7.0', '7.0' ) );
	}

	/**
	 * @covers ::desktop_mode_get_core_update
	 */
	public function test_descriptor_flags_major_for_new_branch() {
		wp_set_current_user( self::$admin_id );
		// A version far above any test-WP branch is always a major.
		$this->fake_core_update( '99.9' );

		$update = desktop_mode_get_core_update();
		$this->assertTrue( $update['major'] );
		// No bundled art for 99.9 → release is null (toast fallback).
		$this->assertNull( $update['release'] );
	}

	/**
	 * @covers ::desktop_mode_parse_release_post
	 */
	public function test_parse_matches_major_announcement() {
		$post = $this->news_post( 'WordPress 7.0 “Armstrong”', 'https://i0.wp.com/x/7.0.png' );
		$release = desktop_mode_parse_release_post( $post, '7.0' );
		$this->assertIsArray( $release );
		$this->assertSame( 'Armstrong', $release['name'] );
		$this->assertSame( 'https://i0.wp.com/x/7.0.png', $release['artUrl'] );
		$this->assertNotEmpty( $release['accent'] );
	}

	/**
	 * @covers ::desktop_mode_parse_release_post
	 */
	public function test_parse_rejects_maintenance_release() {
		$post = $this->news_post( 'WordPress 7.0.1 Maintenance Release', 'https://x/m.png' );
		$this->assertNull( desktop_mode_parse_release_post( $post, '7.0' ) );
	}

	/**
	 * @covers ::desktop_mode_fetch_release_art
	 */
	public function test_fetch_resolves_art_from_news_api_and_caches() {
		$this->mock_news_http(
			array(
				// Maintenance post first — must be skipped for the major.
				$this->news_post( 'WordPress 7.0.1 Maintenance Release', 'https://x/m.png' ),
				$this->news_post( 'WordPress 7.0 “Armstrong”', 'https://i0.wp.com/x/7.0.png' ),
			)
		);

		desktop_mode_fetch_release_art( '7.0' );

		$cached = get_transient( 'desktop_mode_release_art_7.0' );
		$this->assertIsArray( $cached );
		$this->assertSame( 'Armstrong', $cached['name'] );
		$this->assertSame( 'https://i0.wp.com/x/7.0.png', $cached['artUrl'] );

		// The public resolver now returns it straight from cache (no fetch).
		$release = desktop_mode_core_update_release( '7.0' );
		$this->assertSame( 'Armstrong', $release['name'] );
	}

	/**
	 * @covers ::desktop_mode_fetch_release_art
	 */
	public function test_fetch_caches_miss_when_no_announcement() {
		$this->mock_news_http( array( $this->news_post( 'An unrelated post', '' ) ) );

		desktop_mode_fetch_release_art( '9.9' );

		$this->assertSame( 'none', get_transient( 'desktop_mode_release_art_9.9' ) );
		$this->assertNull( desktop_mode_core_update_release( '9.9' ) );
	}

	/**
	 * @covers ::desktop_mode_core_update_release
	 */
	public function test_release_null_on_cold_cache() {
		// Nothing cached, no HTTP mock → resolver returns null and
		// schedules a background fetch it can't complete synchronously.
		$this->assertNull( desktop_mode_core_update_release( '5.5' ) );
	}

	/**
	 * @covers ::desktop_mode_core_update_release
	 */
	public function test_release_filter_can_supply_art() {
		add_filter(
			'desktop_mode_core_update_release',
			static function ( $release, $version, $key ) {
				if ( '99.9' === $key ) {
					return array(
						'name'      => 'Custom',
						'artUrl'    => 'https://example.com/art.jpg',
						'accent'    => '#123456',
						'accentInk' => '#ffffff',
					);
				}
				return $release;
			},
			10,
			3
		);
		$release = desktop_mode_core_update_release( '99.9' );
		$this->assertSame( 'Custom', $release['name'] );

		remove_all_filters( 'desktop_mode_core_update_release' );
	}

	/**
	 * @covers ::desktop_mode_get_core_update
	 */
	public function test_returns_null_without_update() {
		wp_set_current_user( self::$admin_id );
		// No transient (cleared in set_up) → response is 'latest'.
		$this->assertNull( desktop_mode_get_core_update() );
	}

	/**
	 * @covers ::desktop_mode_get_core_update
	 */
	public function test_returns_null_without_capability() {
		$subscriber = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber );
		$this->fake_core_update( '9.9.9' );

		$this->assertNull( desktop_mode_get_core_update() );
	}

	/**
	 * @covers ::desktop_mode_get_core_update
	 */
	public function test_filter_can_suppress_the_toast() {
		wp_set_current_user( self::$admin_id );
		$this->fake_core_update( '9.9.9' );
		add_filter( 'desktop_mode_core_update_notice', '__return_null' );

		$this->assertNull( desktop_mode_get_core_update() );
	}

	/**
	 * @covers ::desktop_mode_get_core_update
	 */
	public function test_filter_can_mutate_the_descriptor() {
		wp_set_current_user( self::$admin_id );
		$this->fake_core_update( '9.9.9' );
		add_filter(
			'desktop_mode_core_update_notice',
			static function ( $update ) {
				$update['version'] = '9.9.9-custom';
				return $update;
			}
		);

		$update = desktop_mode_get_core_update();
		$this->assertSame( '9.9.9-custom', $update['version'] );
	}

	/**
	 * The chromeless suppressor detaches core's per-window update /
	 * maintenance nags so they don't repeat inside every window.
	 *
	 * @covers ::desktop_mode_chromeless_suppress_update_nags
	 */
	public function test_suppressor_removes_nags_in_chromeless() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless'] = '1';

		add_action( 'admin_notices', 'update_nag', 3 );
		add_action( 'network_admin_notices', 'update_nag', 3 );
		add_action( 'admin_notices', 'maintenance_nag', 10 );

		desktop_mode_chromeless_suppress_update_nags();

		$this->assertFalse( has_action( 'admin_notices', 'update_nag' ) );
		$this->assertFalse( has_action( 'network_admin_notices', 'update_nag' ) );
		$this->assertFalse( has_action( 'admin_notices', 'maintenance_nag' ) );
	}

	/**
	 * Outside a chromeless request the nags are left in place.
	 *
	 * @covers ::desktop_mode_chromeless_suppress_update_nags
	 */
	public function test_suppressor_leaves_nags_when_not_chromeless() {
		wp_set_current_user( self::$admin_id );
		add_action( 'admin_notices', 'update_nag', 3 );

		desktop_mode_chromeless_suppress_update_nags();

		$this->assertNotFalse( has_action( 'admin_notices', 'update_nag' ) );

		remove_action( 'admin_notices', 'update_nag', 3 );
	}

	/**
	 * Build a minimal news-feed REST post (with an embedded featured
	 * image) for the parser/fetcher tests.
	 *
	 * @param string $title Post title (rendered).
	 * @param string $art   Featured-image URL, or '' for none.
	 * @return array
	 */
	private function news_post( $title, $art ) {
		$embedded = array();
		if ( '' !== $art ) {
			$embedded = array(
				'wp:featuredmedia' => array(
					array(
						'source_url'    => $art,
						'media_details' => array(
							'sizes' => array(
								'medium_large' => array( 'source_url' => $art ),
							),
						),
					),
				),
			);
		}
		return array(
			'title'     => array( 'rendered' => $title ),
			'_embedded' => $embedded,
		);
	}

	/**
	 * Short-circuit the wordpress.org/news request with a canned post
	 * list so the fetcher runs without real HTTP.
	 *
	 * @param array $posts Decoded posts to return as the response body.
	 */
	private function mock_news_http( $posts ) {
		add_filter(
			'pre_http_request',
			static function ( $pre, $args, $url ) use ( $posts ) {
				if ( false !== strpos( (string) $url, 'wordpress.org/news/wp-json' ) ) {
					return array(
						'response' => array( 'code' => 200 ),
						'body'     => wp_json_encode( $posts ),
					);
				}
				return $pre;
			},
			10,
			3
		);
	}

	/**
	 * Seed the `update_core` site transient so
	 * `get_preferred_from_update_core()` reports an available upgrade.
	 *
	 * @param string $version Version string to advertise.
	 */
	private function fake_core_update( $version ) {
		$item = (object) array(
			'response' => 'upgrade',
			'current'  => $version,
			'locale'   => 'en_US',
			'url'      => 'https://wordpress.org/download/',
			'packages' => (object) array( 'full' => 'https://example.com/wp.zip' ),
		);

		set_site_transient(
			'update_core',
			(object) array(
				'updates'         => array( $item ),
				'version_checked' => '1.0',
				'last_checked'    => time(),
			)
		);
	}
}
