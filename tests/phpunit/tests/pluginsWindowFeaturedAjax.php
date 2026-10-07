<?php

require_once ABSPATH . 'wp-admin/includes/ajax-actions.php';

class Tests_OpenStation_PluginsWindowFeaturedAjax extends WP_Ajax_UnitTestCase {

	private $admin_id;
	private $subscriber_id;

	public function set_up() {
		parent::set_up();
		$this->admin_id      = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );

		if ( is_multisite() ) {
			grant_super_admin( $this->admin_id );
		}
		delete_transient( 'dm_pwfeatured_v1' );
	}

	private function skip_on_multisite() {
		if ( is_multisite() ) {
			$this->markTestSkipped( 'Marketplace surfaces are network-managed on multisite.' );
		}
	}

	public function tear_down() {
		delete_transient( 'dm_pwfeatured_v1' );
		remove_all_filters( 'openstation_plugins_featured_slugs' );
		remove_all_filters( 'openstation_plugins_featured_response' );
		remove_all_filters( 'plugins_api' );
		parent::tear_down();
	}

	public function test_curated_slugs_contains_default_seed() {
		$slugs = openstation_plugins_window_featured_slugs();
		$this->assertContains( 'allterrain-forms', $slugs );
		$this->assertContains( 'allterrain-photo-editor', $slugs );
		$this->assertContains(
			'odd-outlandish-desktop-decorator',
			$slugs,
			'Curated list must include the hand-picked seed plugin.'
		);
	}

	public function test_curated_slugs_filter_can_append() {
		add_filter(
			'openstation_plugins_featured_slugs',
			static function ( $slugs ) {
				$slugs[] = 'my-companion-plugin';
				return $slugs;
			}
		);
		$slugs = openstation_plugins_window_featured_slugs();
		$this->assertContains( 'my-companion-plugin', $slugs );
	}

	public function test_curated_slugs_filter_output_is_sanitized_and_deduped() {
		add_filter(
			'openstation_plugins_featured_slugs',
			static function () {
				return array(
					'odd-outlandish-desktop-decorator',
					'odd-outlandish-desktop-decorator',
					'BAD SLUG WITH SPACES',
					'',
					'fine-plugin',
				);
			}
		);
		$slugs = openstation_plugins_window_featured_slugs();
		$this->assertSame(
			array( 'odd-outlandish-desktop-decorator', 'badslugwithspaces', 'fine-plugin' ),
			array_values( $slugs )
		);
	}

	private function dispatch_featured( $with_nonce = true ) {
		$_POST = array();
		if ( $with_nonce ) {
			$_POST['_ajax_nonce'] = wp_create_nonce( 'desktop-mode-plugins' );
		}
		try {
			$this->_handleAjax( 'openstation_plugins_featured' );
		} catch ( WPAjaxDieContinueException $e ) {

		} catch ( WPAjaxDieStopException $e ) {

		}
		return json_decode( $this->_last_response, true );
	}

	public function test_subscriber_rejected_with_403() {
		wp_set_current_user( $this->subscriber_id );
		$response = $this->dispatch_featured();
		$this->assertFalse( $response['success'] );

		$this->assertSame(
			is_multisite() ? 'openstation_plugins_network_managed' : 'openstation_plugins_forbidden',
			$response['data']['code']
		);
	}

	public function test_multisite_denies_marketplace_even_for_super_admin() {
		if ( ! is_multisite() ) {
			$this->markTestSkipped( 'Multisite-only behavior.' );
		}
		wp_set_current_user( $this->admin_id );
		$response = $this->dispatch_featured();
		$this->assertFalse( $response['success'] );
		$this->assertSame( 'openstation_plugins_network_managed', $response['data']['code'] );
	}

	public function test_missing_nonce_rejected() {
		wp_set_current_user( $this->admin_id );
		$response = $this->dispatch_featured( false );
		$this->assertFalse( $response['success'] );
		$this->assertSame( 'openstation_plugins_bad_nonce', $response['data']['code'] );
	}

	public function test_admin_receives_curated_plus_discovered_payload() {
		$this->skip_on_multisite();
		wp_set_current_user( $this->admin_id );
		$this->mock_plugins_api();

		$response = $this->dispatch_featured();
		$this->assertTrue( $response['success'] );

		$plugins = $response['data']['plugins'];
		$this->assertNotEmpty( $plugins );

		$this->assertSame( 'odd-outlandish-desktop-decorator', $plugins[0]['slug'] );
		$this->assertTrue( $plugins[0]['featured'] );

		$slugs = array_column( $plugins, 'slug' );
		$this->assertContains( 'allterrain-forms', $slugs );
		$this->assertContains( 'allterrain-photo-editor', $slugs );
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

		$this->assertSame( count( $plugins ), $response['data']['info']['results'] );
	}

	public function test_discovery_dedupes_against_curated() {
		$this->skip_on_multisite();
		wp_set_current_user( $this->admin_id );
		$this->mock_plugins_api( array(

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

	public function test_response_is_cached_for_subsequent_calls() {
		$this->skip_on_multisite();
		wp_set_current_user( $this->admin_id );
		$this->mock_plugins_api();

		$first = $this->dispatch_featured();

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

	public function test_response_filter_can_inject_extra_rows() {
		$this->skip_on_multisite();
		wp_set_current_user( $this->admin_id );
		$this->mock_plugins_api();

		add_filter(
			'openstation_plugins_featured_response',
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

	private function mock_plugins_api( array $overrides = array() ) {
		$curated_name = $overrides['curated_name'] ?? 'ODD — Outlandish Desktop Decorator';
		$discovery    = $overrides['discovery'] ?? array(

			array(
				'slug'             => 'fake-dependent-plugin',
				'name'             => 'Fake Dependent',
				'requires_plugins' => array( 'desktop-mode' ),
				'rating'           => 80,
				'short_description' => 'Depends on openstation.',
			),

			array(
				'slug'             => 'unrelated-plugin',
				'name'             => 'Unrelated',
				'requires_plugins' => array(),
				'rating'           => 60,
				'short_description' => 'Has nothing to do with OpenStation.',
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
