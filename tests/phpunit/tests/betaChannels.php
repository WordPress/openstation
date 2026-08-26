<?php
/**
 * Tests for the OpenStation Beta companion plugin's build discovery
 * and target resolution (openstation-beta/).
 *
 * The companion is a standalone plugin that is not loaded by the test
 * bootstrap — its include files are required directly below. All
 * GitHub traffic is mocked through `pre_http_request`; the asset
 * existence probe is mocked through its dedicated
 * `openstation_beta_pre_probe_assets` seam (the parallel probe path
 * talks to the Requests library directly and would bypass
 * `pre_http_request`).
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group openstation-beta
 */
class Tests_OpenStationBeta_Channels extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;

	/**
	 * URLs the HTTP mock has served, in order.
	 *
	 * @var string[]
	 */
	protected $requested_urls = array();

	public static function set_up_before_class() {
		parent::set_up_before_class();

		if ( ! defined( 'OPENSTATION_BETA_VERSION' ) ) {
			define( 'OPENSTATION_BETA_VERSION', 'test' );
		}
		if ( ! defined( 'OPENSTATION_BETA_TARGET_PLUGIN' ) ) {
			define( 'OPENSTATION_BETA_TARGET_PLUGIN', 'desktop-mode/desktop-mode.php' );
		}
		$dir = dirname( __DIR__, 3 ) . '/openstation-beta/includes/';
		require_once $dir . 'github.php';
		require_once $dir . 'installer.php';
		require_once $dir . 'ajax.php';
	}

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		$this->requested_urls = array();
		delete_option( OPENSTATION_BETA_CURRENT_OPTION );
		foreach ( array( 'prs', 'stable', 'trunk', 'asset_map' ) as $key ) {
			delete_transient( 'openstation_beta_' . $key );
		}
	}

	// -----------------------------------------------------------------
	// Fixtures.
	// -----------------------------------------------------------------

	protected static function sha( $char ) {
		return str_repeat( $char, 40 );
	}

	protected static function json_response( $code, $data ) {
		return array(
			'headers'  => array(),
			'body'     => wp_json_encode( $data ),
			'response' => array(
				'code'    => $code,
				'message' => '',
			),
			'cookies'  => array(),
			'filename' => null,
		);
	}

	protected static function pr_fixture() {
		return array(
			array(
				'number'     => 501,
				'title'      => 'Add widget gallery',
				'draft'      => false,
				'updated_at' => '2026-07-26T10:00:00Z',
				'html_url'   => 'https://github.com/WordPress/openstation/pull/501',
				'user'       => array( 'login' => 'alice' ),
				'head'       => array(
					'ref' => 'add/widget-gallery',
					'sha' => self::sha( 'a' ),
				),
			),
			array(
				'number'     => 502,
				'title'      => 'Fix dock overflow',
				'draft'      => true,
				'updated_at' => '2026-07-25T09:00:00Z',
				'html_url'   => 'https://github.com/WordPress/openstation/pull/502',
				'user'       => array( 'login' => 'bob' ),
				'head'       => array(
					'ref' => 'fix/dock-overflow',
					'sha' => self::sha( 'b' ),
				),
			),
			// Malformed: no head SHA — must be dropped.
			array(
				'number' => 503,
				'title'  => 'Broken payload',
				'head'   => array( 'ref' => 'broken' ),
			),
			// Malformed: SHA is not 40 hex chars — must be dropped.
			array(
				'number' => 504,
				'title'  => 'Bad sha',
				'head'   => array(
					'ref' => 'bad-sha',
					'sha' => 'nope',
				),
			),
		);
	}

	protected static function release_fixture() {
		return array(
			'tag_name'     => 'v0.9.7',
			'published_at' => '2026-07-27T08:00:00Z',
			'assets'       => array(
				array(
					'name'                 => 'openstation.zip',
					'browser_download_url' => 'https://github.com/WordPress/openstation/releases/download/v0.9.7/openstation.zip',
				),
			),
		);
	}

	/**
	 * Route mocked HTTP by URL substring. Unmatched URLs 404.
	 *
	 * @param array $routes Map url-substring → response array.
	 */
	protected function mock_http( $routes ) {
		add_filter(
			'pre_http_request',
			function ( $pre, $args, $url ) use ( $routes ) {
				$this->requested_urls[] = $url;
				foreach ( $routes as $needle => $response ) {
					if ( false !== strpos( $url, $needle ) ) {
						return $response;
					}
				}
				return self::json_response( 404, array() );
			},
			10,
			3
		);
	}

	/**
	 * Mock the asset existence probe.
	 *
	 * @param array $map Map asset name → bool.
	 */
	protected function mock_probe( $map ) {
		add_filter(
			'openstation_beta_pre_probe_assets',
			static function () use ( $map ) {
				return $map;
			}
		);
	}

	// -----------------------------------------------------------------
	// Discovery.
	// -----------------------------------------------------------------

	public function test_fetch_open_prs_maps_fields_and_drops_malformed_entries() {
		$this->mock_http( array( '/pulls?' => self::json_response( 200, self::pr_fixture() ) ) );

		$prs = openstation_beta_fetch_open_prs();

		$this->assertIsArray( $prs );
		$this->assertCount( 2, $prs, 'Malformed PR entries must be dropped.' );
		$this->assertSame( 501, $prs[0]['number'] );
		$this->assertSame( 'Add widget gallery', $prs[0]['title'] );
		$this->assertSame( 'add/widget-gallery', $prs[0]['branch'] );
		$this->assertSame( self::sha( 'a' ), $prs[0]['sha'] );
		$this->assertSame( 'alice', $prs[0]['author'] );
		$this->assertFalse( $prs[0]['draft'] );
		$this->assertSame( 'pr-501-' . self::sha( 'a' ) . '.zip', $prs[0]['asset'] );
		$this->assertTrue( $prs[1]['draft'] );
	}

	public function test_fetch_open_prs_caches_until_forced() {
		$this->mock_http( array( '/pulls?' => self::json_response( 200, self::pr_fixture() ) ) );

		openstation_beta_fetch_open_prs();
		openstation_beta_fetch_open_prs();
		$this->assertCount( 1, $this->requested_urls, 'Second read must come from the transient cache.' );

		openstation_beta_fetch_open_prs( true );
		$this->assertCount( 2, $this->requested_urls, 'force=true must bypass the cache.' );
	}

	public function test_fetch_trunk_parses_manifest_and_rejects_bad_sha() {
		$this->mock_http(
			array(
				'/ci-artifacts/trunk.json' => self::json_response(
					200,
					array(
						'sha'      => self::sha( 'c' ),
						'version'  => '0.9.8',
						'built_at' => '2026-07-27T09:00:00Z',
					)
				),
			)
		);

		$trunk = openstation_beta_fetch_trunk();
		$this->assertSame( self::sha( 'c' ), $trunk['sha'] );
		$this->assertSame( '0.9.8', $trunk['version'] );
		$this->assertStringEndsWith( '/ci-artifacts/trunk.zip', $trunk['url'] );

		delete_transient( 'openstation_beta_trunk' );
		remove_all_filters( 'pre_http_request' );
		$this->mock_http(
			array(
				'/ci-artifacts/trunk.json' => self::json_response( 200, array( 'sha' => 'not-a-sha' ) ),
			)
		);
		$this->assertNull( openstation_beta_fetch_trunk(), 'A manifest with an invalid SHA must resolve to null.' );
	}

	public function test_fetch_trunk_missing_manifest_is_null_and_cached() {
		$this->mock_http( array() );

		$this->assertNull( openstation_beta_fetch_trunk() );
		openstation_beta_fetch_trunk();
		$this->assertCount( 1, $this->requested_urls, 'The 404 must be cached too.' );
	}

	public function test_fetch_stable_finds_zip_asset() {
		$this->mock_http( array( '/releases/latest' => self::json_response( 200, self::release_fixture() ) ) );

		$stable = openstation_beta_fetch_stable();
		$this->assertSame( 'v0.9.7', $stable['tag'] );
		$this->assertSame( '0.9.7', $stable['version'] );
		$this->assertStringContainsString( '/releases/download/v0.9.7/openstation.zip', $stable['url'] );
	}

	public function test_fetch_stable_without_zip_asset_is_error() {
		$release           = self::release_fixture();
		$release['assets'] = array();
		$this->mock_http( array( '/releases/latest' => self::json_response( 200, $release ) ) );

		$stable = openstation_beta_fetch_stable();
		$this->assertWPError( $stable );
		$this->assertSame( 'openstation_beta_no_stable_asset', $stable->get_error_code() );
	}

	public function test_github_api_error_status_propagates() {
		$this->mock_http( array( '/pulls?' => self::json_response( 403, array( 'message' => 'rate limited' ) ) ) );

		$prs = openstation_beta_fetch_open_prs();
		$this->assertWPError( $prs );
		$this->assertSame( 'openstation_beta_github_http', $prs->get_error_code() );
	}

	// -----------------------------------------------------------------
	// Assembled state.
	// -----------------------------------------------------------------

	public function test_state_marks_build_readiness_per_pr() {
		$this->mock_http(
			array(
				'/pulls?'          => self::json_response( 200, self::pr_fixture() ),
				'/releases/latest' => self::json_response( 200, self::release_fixture() ),
			)
		);
		$this->mock_probe( array( 'pr-501-' . self::sha( 'a' ) . '.zip' => true ) );

		$state = openstation_beta_state();

		$this->assertFalse( $state['current']['managed'] );
		$this->assertNull( $state['current']['update'] );
		$this->assertSame( '0.9.7', $state['stable']['version'] );
		$this->assertNull( $state['trunk'] );
		$this->assertTrue( $state['prs'][0]['build_ready'] );
		$this->assertFalse( $state['prs'][1]['build_ready'] );
	}

	public function test_state_flags_new_build_for_installed_pr() {
		update_option(
			OPENSTATION_BETA_CURRENT_OPTION,
			array(
				'source'       => 'pr',
				'id'           => '501',
				'sha'          => self::sha( '0' ),
				'branch'       => 'add/widget-gallery',
				'title'        => 'Add widget gallery',
				'version'      => '0.9.7',
				'installed_at' => time(),
				'installed_by' => 'admin',
			)
		);
		$this->mock_http(
			array(
				'/pulls?'          => self::json_response( 200, self::pr_fixture() ),
				'/releases/latest' => self::json_response( 200, self::release_fixture() ),
			)
		);
		$this->mock_probe( array() );

		$state = openstation_beta_state();

		$this->assertTrue( $state['current']['managed'] );
		$this->assertSame( 'new-build', $state['current']['update']['kind'] );
		$this->assertSame( self::sha( 'a' ), $state['current']['update']['sha'] );
	}

	public function test_state_flags_closed_pr() {
		update_option(
			OPENSTATION_BETA_CURRENT_OPTION,
			array(
				'source'       => 'pr',
				'id'           => '999',
				'sha'          => self::sha( '0' ),
				'branch'       => 'gone',
				'title'        => 'Merged already',
				'version'      => '0.9.7',
				'installed_at' => time(),
				'installed_by' => 'admin',
			)
		);
		$this->mock_http(
			array(
				'/pulls?'          => self::json_response( 200, self::pr_fixture() ),
				'/releases/latest' => self::json_response( 200, self::release_fixture() ),
			)
		);
		$this->mock_probe( array() );

		$state = openstation_beta_state();
		$this->assertSame( 'pr-closed', $state['current']['update']['kind'] );
	}

	public function test_state_flags_new_trunk_build() {
		update_option(
			OPENSTATION_BETA_CURRENT_OPTION,
			array(
				'source'       => 'trunk',
				'id'           => '',
				'sha'          => self::sha( '0' ),
				'branch'       => 'trunk',
				'title'        => '',
				'version'      => '0.9.7',
				'installed_at' => time(),
				'installed_by' => 'admin',
			)
		);
		$this->mock_http(
			array(
				'/pulls?'                  => self::json_response( 200, array() ),
				'/releases/latest'         => self::json_response( 200, self::release_fixture() ),
				'/ci-artifacts/trunk.json' => self::json_response(
					200,
					array(
						'sha'      => self::sha( 'c' ),
						'version'  => '0.9.8',
						'built_at' => '2026-07-27T09:00:00Z',
					)
				),
			)
		);
		$this->mock_probe( array() );

		$state = openstation_beta_state();
		$this->assertSame( 'new-build', $state['current']['update']['kind'] );
		$this->assertSame( self::sha( 'c' ), $state['current']['update']['sha'] );
	}

	// -----------------------------------------------------------------
	// Target resolution.
	// -----------------------------------------------------------------

	public function test_resolve_target_pr_with_ready_build() {
		$this->mock_http( array( '/pulls?' => self::json_response( 200, self::pr_fixture() ) ) );
		$this->mock_probe( array( 'pr-501-' . self::sha( 'a' ) . '.zip' => true ) );

		$target = openstation_beta_resolve_target( 'pr', '501' );

		$this->assertIsArray( $target );
		$this->assertSame(
			'https://github.com/WordPress/openstation/releases/download/ci-artifacts/pr-501-' . self::sha( 'a' ) . '.zip',
			$target['url']
		);
		$this->assertSame( 'pr', $target['record']['source'] );
		$this->assertSame( '501', $target['record']['id'] );
		$this->assertSame( self::sha( 'a' ), $target['record']['sha'] );
		$this->assertSame( 'add/widget-gallery', $target['record']['branch'] );
	}

	public function test_resolve_target_pr_without_build_is_conflict() {
		$this->mock_http( array( '/pulls?' => self::json_response( 200, self::pr_fixture() ) ) );
		$this->mock_probe( array() );

		$target = openstation_beta_resolve_target( 'pr', '501' );
		$this->assertWPError( $target );
		$this->assertSame( 'openstation_beta_build_pending', $target->get_error_code() );
	}

	public function test_resolve_target_unknown_pr_is_not_found() {
		$this->mock_http( array( '/pulls?' => self::json_response( 200, self::pr_fixture() ) ) );

		$target = openstation_beta_resolve_target( 'pr', '999' );
		$this->assertWPError( $target );
		$this->assertSame( 'openstation_beta_pr_missing', $target->get_error_code() );
	}

	public function test_resolve_target_stable_rejects_foreign_asset_url() {
		$release = self::release_fixture();

		$release['assets'][0]['browser_download_url'] = 'https://evil.example.com/desktop-mode.zip';
		$this->mock_http( array( '/releases/latest' => self::json_response( 200, $release ) ) );

		$target = openstation_beta_resolve_target( 'stable', '' );
		$this->assertWPError( $target );
		$this->assertSame( 'openstation_beta_unexpected_url', $target->get_error_code() );
	}

	public function test_resolve_target_trunk_without_build_is_not_found() {
		$this->mock_http( array() );

		$target = openstation_beta_resolve_target( 'trunk', '' );
		$this->assertWPError( $target );
		$this->assertSame( 'openstation_beta_no_trunk', $target->get_error_code() );
	}

	public function test_resolve_target_unknown_source_is_error() {
		$target = openstation_beta_resolve_target( 'nightly', '' );
		$this->assertWPError( $target );
		$this->assertSame( 'openstation_beta_bad_source', $target->get_error_code() );
	}

	// -----------------------------------------------------------------
	// Dev-checkout guard.
	// -----------------------------------------------------------------

	public function test_dev_checkout_marker_detects_worktree_git_file() {
		$dir = get_temp_dir() . 'dmb-clean-' . uniqid();
		mkdir( $dir );

		$this->assertSame( '', openstation_beta_dev_checkout_marker( $dir ), 'A bare directory is not a checkout.' );

		// Git worktrees have a plain-file .git, not a directory — the
		// marker check must catch both.
		file_put_contents( $dir . '/.git', 'gitdir: /elsewhere/.git/worktrees/x' );
		$this->assertSame( '.git', openstation_beta_dev_checkout_marker( $dir ) );

		unlink( $dir . '/.git' );
		rmdir( $dir );
		$this->assertSame( '', openstation_beta_dev_checkout_marker( $dir ), 'A missing directory is not a checkout.' );
	}

	public function test_wp_env_mount_is_detected_as_dev_checkout() {
		// The tests instance bind-mounts this repository as the
		// desktop-mode plugin directory — the exact hazard the guard
		// exists for, so it must fire right here.
		$this->assertNotSame( '', openstation_beta_dev_checkout_marker() );

		$blocked = openstation_beta_install_blocked();
		$this->assertIsArray( $blocked );
		$this->assertSame( 'dev-checkout', $blocked['code'] );
	}

	public function test_switch_refuses_dev_checkout_before_any_network() {
		add_filter(
			'pre_http_request',
			function () {
				$this->fail( 'The dev-checkout guard must refuse before any network request is made.' );
			}
		);

		$result = openstation_beta_switch( 'stable', '' );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_beta_dev_checkout', $result->get_error_code() );
		$data = $result->get_error_data();
		$this->assertSame( 409, $data['status'] );
	}

	public function test_allow_dev_overwrite_filter_unblocks_switch() {
		add_filter( 'openstation_beta_allow_dev_overwrite', '__return_true' );

		$this->assertNull( openstation_beta_install_blocked() );

		// With the override on, the switch proceeds past the guard into
		// target resolution — prove it by making GitHub fail and
		// asserting the error is the resolver's, not the guard's.
		$this->mock_http( array( '/releases/latest' => self::json_response( 403, array() ) ) );
		$result = openstation_beta_switch( 'stable', '' );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_beta_github_http', $result->get_error_code() );
	}

	public function test_state_exposes_install_blocked() {
		$this->mock_http(
			array(
				'/pulls?'          => self::json_response( 200, array() ),
				'/releases/latest' => self::json_response( 200, self::release_fixture() ),
			)
		);
		$this->mock_probe( array() );

		$state = openstation_beta_state();
		$this->assertIsArray( $state['install_blocked'], 'Running from a checkout, the state must carry the block.' );
		$this->assertSame( 'dev-checkout', $state['install_blocked']['code'] );
		$this->assertNotSame( '', $state['install_blocked']['reason'] );
	}

	// -----------------------------------------------------------------
	// Guards.
	// -----------------------------------------------------------------

	public function test_auto_updates_blocked_only_while_beta_build_installed() {
		$item  = (object) array( 'plugin' => OPENSTATION_BETA_TARGET_PLUGIN );
		$other = (object) array( 'plugin' => 'akismet/akismet.php' );

		$this->assertTrue( openstation_beta_block_auto_update( true, $item ), 'No beta build installed — auto-updates flow through.' );

		update_option(
			OPENSTATION_BETA_CURRENT_OPTION,
			array(
				'source' => 'pr',
				'id'     => '501',
				'sha'    => self::sha( 'a' ),
			)
		);
		$this->assertFalse( openstation_beta_block_auto_update( true, $item ), 'Beta build installed — Desktop Mode auto-updates are blocked.' );
		$this->assertTrue( openstation_beta_block_auto_update( true, $other ), 'Other plugins are unaffected.' );
	}

	public function test_ajax_guard_requires_capability_and_nonce() {
		wp_set_current_user( self::$admin_id );
		$_REQUEST['_ajax_nonce'] = wp_create_nonce( 'openstation-beta' );
		$this->assertTrue( openstation_beta_ajax_guard( 'update_plugins' ) );

		wp_set_current_user( self::$subscriber_id );
		$_REQUEST['_ajax_nonce'] = wp_create_nonce( 'openstation-beta' );
		$guard = openstation_beta_ajax_guard( 'update_plugins' );
		$this->assertWPError( $guard );
		$this->assertSame( 'openstation_beta_forbidden', $guard->get_error_code() );

		wp_set_current_user( self::$admin_id );
		$_REQUEST['_ajax_nonce'] = 'garbage';
		$guard                   = openstation_beta_ajax_guard( 'update_plugins' );
		$this->assertWPError( $guard );
		$this->assertSame( 'openstation_beta_bad_nonce', $guard->get_error_code() );

		unset( $_REQUEST['_ajax_nonce'] );
	}
}
