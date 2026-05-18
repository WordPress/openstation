<?php
/**
 * Tests for the Plugins window's Featured tab AJAX endpoint + curated
 * slug helper.
 *
 * The Featured tab is the third tab in the native Plugins window. It
 * surfaces plugins that depend on Desktop Mode — manually curated for
 * now (wp.org's plugins_api has no usable `requires_plugins` filter)
 * and topped up at runtime by scanning the popular-plugins feed for
 * rows whose `requires_plugins` array contains `desktop-mode`.
 *
 * Tests stub `plugins_api` via the `plugins_api` filter so we don't
 * make real wp.org HTTPS calls from the suite.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-plugins-window
 * @group ajax
 */
require_once ABSPATH . 'wp-admin/includes/ajax-actions.php';

class Tests_DesktopMode_PluginsWindowFeaturedAjax extends WP_Ajax_UnitTestCase {

	private $admin_id;
	private $subscriber_id;

	public function set_up() {
		parent::set_up();
		$this->admin_id      = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		delete_transient( 'dm_pwfeatured_v1' );
	}

	public function tear_down() {
		delete_transient( 'dm_pwfeatured_v1' );
		remove_all_filters( 'desktop_mode_plugins_featured_slugs' );
		remove_all_filters( 'desktop_mode_plugins_featured_response' );
		remove_all_filters( 'plugins_api' );
		parent::tear_down();
	}

	// ────────────────────────────────────────────────────────────────
	// Curated slugs helper.
	// ────────────────────────────────────────────────────────────────

	/**
	 * The seed list must include the manually curated entry — the wp.org
	 * author of the plugin omitted the `Requires Plugins` header, so
	 * without this seed users would never discover it from the tab.
	 *
	 * @covers ::desktop_mode_plugins_window_featured_slugs
	 */
	public function test_curated_slugs_contains_default_seed() {
		$slugs = desktop_mode_plugins_window_featured_slugs();
		$this->assertContains(
			'odd-outlandish-desktop-decorator',
			$slugs,
			'Curated list must include the hand-picked seed plugin.'
		);
	}

	/**
	 * `desktop_mode_plugins_featured_slugs` must be filterable so
	 * downstream plugins can append their own recommendations.
	 *
	 * @covers ::desktop_mode_plugins_window_featured_slugs
	 */
	public function test_curated_slugs_filter_can_append() {
		add_filter(
			'desktop_mode_plugins_featured_slugs',
			static function ( $slugs ) {
				$slugs[] = 'my-companion-plugin';
				return $slugs;
			}
		);
		$slugs = desktop_mode_plugins_window_featured_slugs();
		$this->assertContains( 'my-companion-plugin', $slugs );
	}

	/**
	 * Filter output is sanitized + deduped. A garbled or repeated entry
	 * mustn't leak into the AJAX payload (and the slug must be safe to
	 * concatenate into a wp.org URL).
	 *
	 * @covers ::desktop_mode_plugins_window_featured_slugs
	 */
	public function test_curated_slugs_filter_output_is_sanitized_and_deduped() {
		add_filter(
			'desktop_mode_plugins_featured_slugs',
			static function () {
				return array(
					'odd-outlandish-desktop-decorator',
					'odd-outlandish-desktop-decorator', // duplicate
					'BAD SLUG WITH SPACES',             // sanitize_key strips spaces/uppercase
					'',                                 // empty filtered out
					'fine-plugin',
				);
			}
		);
		$slugs = desktop_mode_plugins_window_featured_slugs();
		$this->assertSame(
			array( 'odd-outlandish-desktop-decorator', 'badslugwithspaces', 'fine-plugin' ),
			array_values( $slugs )
		);
	}

	// ────────────────────────────────────────────────────────────────
	// AJAX endpoint.
	// ────────────────────────────────────────────────────────────────

	/**
	 * Helper: dispatch the featured AJAX action and return decoded body.
	 */
	private function dispatch_featured( $with_nonce = true ) {
		$_POST = array();
		if ( $with_nonce ) {
			$_POST['_ajax_nonce'] = wp_create_nonce( 'desktop-mode-plugins' );
		}
		try {
			$this->_handleAjax( 'desktop_mode_plugins_featured' );
		} catch ( WPAjaxDieContinueException $e ) {
			// Expected — wp_send_json_* throws this in tests.
		} catch ( WPAjaxDieStopException $e ) {
			// Some Core paths throw this variant instead.
		}
		return json_decode( $this->_last_response, true );
	}

	/**
	 * Subscribers (no `install_plugins`) must be rejected — the AJAX
	 * guard re-validates the cap server-side.
	 *
	 * @covers ::desktop_mode_plugins_window_ajax_featured
	 */
	public function test_subscriber_rejected_with_403() {
		wp_set_current_user( $this->subscriber_id );
		$response = $this->dispatch_featured();
		$this->assertFalse( $response['success'] );
		$this->assertSame( 'desktop_mode_plugins_forbidden', $response['data']['code'] );
	}

	/**
	 * Missing nonce is a 403, not a 200. Plugin Check + WordPress
	 * security guidance both expect every admin-ajax handler to refuse
	 * unauthenticated callers.
	 *
	 * @covers ::desktop_mode_plugins_window_ajax_featured
	 */
	public function test_missing_nonce_rejected() {
		wp_set_current_user( $this->admin_id );
		$response = $this->dispatch_featured( false );
		$this->assertFalse( $response['success'] );
		$this->assertSame( 'desktop_mode_plugins_bad_nonce', $response['data']['code'] );
	}

	/**
	 * Happy path: an admin gets the curated rows in the response, with
	 * `featured: true`, and the discovery feed's row that declares
	 * `requires_plugins => [desktop-mode]` is appended.
	 *
	 * @covers ::desktop_mode_plugins_window_ajax_featured
	 */
	public function test_admin_receives_curated_plus_discovered_payload() {
		wp_set_current_user( $this->admin_id );
		$this->mock_plugins_api();

		$response = $this->dispatch_featured();
		$this->assertTrue( $response['success'] );

		$plugins = $response['data']['plugins'];
		$this->assertNotEmpty( $plugins );

		// First row must be the curated seed, flagged featured: true.
		$this->assertSame( 'odd-outlandish-desktop-decorator', $plugins[0]['slug'] );
		$this->assertTrue( $plugins[0]['featured'] );

		// The discovery feed includes one row that declares the
		// desktop-mode dependency — it should land in the payload too,
		// with featured: false. Unrelated rows must be filtered out.
		$slugs = array_column( $plugins, 'slug' );
		$this->assertContains( 'fake-dependent-plugin', $slugs );
		$this->assertNotContains( 'unrelated-plugin', $slugs );

		$dependent = null;
		foreach ( $plugins as $row ) {
			if ( 'fake-dependent-plugin' === $row['slug'] ) {
				$dependent = $row;
				break;
			}
		}
		$this->assertNotNull( $dependent );
		$this->assertFalse( $dependent['featured'] );

		// Info block carries counts the JS uses for headers / empty states.
		$this->assertSame( count( $plugins ), $response['data']['info']['results'] );
	}

	/**
	 * Discovery dedupes against curated slugs. If wp.org's popular feed
	 * happens to return a curated entry too, we must not emit it twice
	 * (and the curated `featured: true` flag wins).
	 *
	 * @covers ::desktop_mode_plugins_window_ajax_featured
	 */
	public function test_discovery_dedupes_against_curated() {
		wp_set_current_user( $this->admin_id );
		$this->mock_plugins_api( array(
			// Same slug appears in both the discovery feed AND the
			// curated list — the AJAX must only emit it once.
			'discovery' => array(
				array(
					'slug'             => 'odd-outlandish-desktop-decorator',
					'name'             => 'Outlandish Desktop Decorator',
					'requires_plugins' => array( 'desktop-mode' ),
				),
			),
		) );

		$response = $this->dispatch_featured();
		$slugs    = array_column( $response['data']['plugins'], 'slug' );
		$this->assertSame(
			1,
			count( array_filter( $slugs, static fn( $s ) => 'odd-outlandish-desktop-decorator' === $s ) ),
			'Curated + discovery overlap must collapse to a single row.'
		);
	}

	/**
	 * Second call within the cache window returns the same payload —
	 * proves the transient stuck, and that the helper isn't re-hitting
	 * `plugins_api` on every tab open. Important because each call is
	 * an outbound wp.org HTTPS round-trip when uncached.
	 *
	 * @covers ::desktop_mode_plugins_window_ajax_featured
	 */
	public function test_response_is_cached_for_subsequent_calls() {
		wp_set_current_user( $this->admin_id );
		$this->mock_plugins_api();

		$first = $this->dispatch_featured();

		// Reset the response buffer + swap the mock so a fresh call
		// would surface different data — if the cache works, we get the
		// FIRST response back unchanged.
		$this->_last_response = '';
		remove_all_filters( 'plugins_api' );
		$this->mock_plugins_api( array( 'curated_name' => 'DIFFERENT' ) );

		$second = $this->dispatch_featured();

		$this->assertSame(
			$first['data']['plugins'][0]['name'],
			$second['data']['plugins'][0]['name'],
			'Second dispatch must read from the transient, not re-call plugins_api.'
		);
	}

	/**
	 * `desktop_mode_plugins_featured_response` filter must run before
	 * the payload is cached + sent. Lets host plugins inject premium
	 * rows or enforce a cap.
	 *
	 * @covers ::desktop_mode_plugins_window_ajax_featured
	 */
	public function test_response_filter_can_inject_extra_rows() {
		wp_set_current_user( $this->admin_id );
		$this->mock_plugins_api();

		add_filter(
			'desktop_mode_plugins_featured_response',
			static function ( $payload ) {
				$payload['plugins'][] = array(
					'slug'     => 'private-premium-companion',
					'name'     => 'Private Premium',
					'featured' => true,
				);
				return $payload;
			}
		);

		$response = $this->dispatch_featured();
		$slugs    = array_column( $response['data']['plugins'], 'slug' );
		$this->assertContains( 'private-premium-companion', $slugs );
	}

	// ────────────────────────────────────────────────────────────────
	// Test helpers.
	// ────────────────────────────────────────────────────────────────

	/**
	 * Stub `plugins_api` so the test never makes a real wp.org call.
	 * Returns a curated info object for the `plugin_information` action
	 * and a small discovery feed for `query_plugins`.
	 */
	private function mock_plugins_api( array $overrides = array() ) {
		$curated_name = $overrides['curated_name'] ?? 'ODD — Outlandish Desktop Decorator';
		$discovery    = $overrides['discovery'] ?? array(
			// Row that explicitly depends on desktop-mode — should appear.
			array(
				'slug'             => 'fake-dependent-plugin',
				'name'             => 'Fake Dependent',
				'requires_plugins' => array( 'desktop-mode' ),
				'rating'           => 80,
				'short_description' => 'Depends on desktop-mode.',
			),
			// Row without the dependency — must be filtered out.
			array(
				'slug'             => 'unrelated-plugin',
				'name'             => 'Unrelated',
				'requires_plugins' => array(),
				'rating'           => 60,
				'short_description' => 'Has nothing to do with desktop mode.',
			),
		);

		add_filter(
			'plugins_api',
			static function ( $value, $action, $args ) use ( $curated_name, $discovery ) {
				if ( 'plugin_information' === $action ) {
					return (object) array(
						'slug'              => $args->slug,
						'name'              => $curated_name,
						'short_description' => 'Curated companion plugin.',
						'rating'            => 0,
						'requires_plugins'  => array(),
					);
				}
				if ( 'query_plugins' === $action ) {
					$plugins = array_map(
						static fn( $row ) => (object) $row,
						$discovery
					);
					return (object) array(
						'plugins' => $plugins,
						'info'    => array( 'page' => 1, 'pages' => 1, 'results' => count( $plugins ) ),
					);
				}
				return $value;
			},
			10,
			3
		);
	}
}
