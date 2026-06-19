<?php
/**
 * Tests for the Agents Gutenberg / Guidelines-experiment soft-gate.
 *
 * AJAX endpoint tests use the WP_Ajax_UnitTestCase harness — the
 * production handler calls `wp_send_json_error` / `wp_send_json_success`,
 * which `exit()` in a plain `WP_UnitTestCase` and would kill the test
 * process. The Ajax harness swaps `wp_die` for an exception that the
 * test catches and inspects.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-agents
 * @group ajax
 */
require_once ABSPATH . 'wp-admin/includes/ajax-actions.php';

class Tests_DesktopMode_Agents_GutenbergGate extends WP_Ajax_UnitTestCase {

	public function tear_down() {
		remove_all_filters( 'desktop_mode_agents_storage_available' );
		delete_option( 'gutenberg-experiments' );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_agents_storage_available
	 */
	public function test_storage_available_returns_true_when_substrate_present() {
		if ( ! post_type_exists( 'wp_guideline' ) ) {
			register_post_type( 'wp_guideline', array( 'public' => false ) );
			register_taxonomy( 'wp_guideline_type', 'wp_guideline', array( 'hierarchical' => true ) );
		}
		$this->assertTrue( desktop_mode_agents_storage_available() );
	}

	/**
	 * @covers ::desktop_mode_agents_storage_available
	 */
	public function test_storage_available_filter_can_force_true() {
		add_filter( 'desktop_mode_agents_storage_available', '__return_true' );
		$this->assertTrue( desktop_mode_agents_storage_available() );
	}

	/**
	 * @covers ::desktop_mode_agents_storage_available
	 */
	public function test_storage_available_filter_can_force_false() {
		add_filter( 'desktop_mode_agents_storage_available', '__return_false' );
		$this->assertFalse( desktop_mode_agents_storage_available() );
	}

	/**
	 * @covers ::desktop_mode_agents_window_config
	 */
	public function test_window_config_includes_required_keys() {
		$cfg = desktop_mode_agents_window_config();
		$this->assertArrayHasKey( 'enabled', $cfg );
		$this->assertArrayHasKey( 'gutenbergActive', $cfg );
		$this->assertArrayHasKey( 'skillTermId', $cfg );
		$this->assertArrayHasKey( 'restNamespace', $cfg );
		$this->assertArrayHasKey( 'enableExperimentNonce', $cfg );
		$this->assertArrayHasKey( 'gutenbergInstallUrl', $cfg );
		$this->assertSame( 'desktop-mode/v1', $cfg['restNamespace'] );
		$this->assertNotEmpty( $cfg['enableExperimentNonce'] );
	}

	/**
	 * AJAX endpoint requires `manage_options` — editors get a 403
	 * payload through the Ajax die handler.
	 *
	 * @covers ::desktop_mode_ajax_enable_guidelines_experiment
	 */
	public function test_ajax_endpoint_rejects_non_admin() {
		$this->_setRole( 'editor' );

		$_POST = array( 'nonce' => wp_create_nonce( 'desktop-mode-enable-guidelines' ) );

		try {
			$this->_handleAjax( 'desktop_mode_enable_guidelines_experiment' );
		} catch ( WPAjaxDieContinueException $e ) {
			// Expected.
		} catch ( WPAjaxDieStopException $e ) {
			// Some setups raise the Stop variant on error paths.
		}

		// Editor cannot have flipped the option.
		$opts = get_option( 'gutenberg-experiments', array() );
		$this->assertEmpty( $opts );
	}

	/**
	 * AJAX endpoint flips the experiment option for admins when
	 * Gutenberg is active.
	 *
	 * @covers ::desktop_mode_ajax_enable_guidelines_experiment
	 */
	public function test_ajax_endpoint_flips_option_for_admin() {
		$this->_setRole( 'administrator' );

		// Pretend Gutenberg is active so the endpoint runs past the
		// 412 short-circuit. We do this by adding it to active_plugins.
		$prev_active   = get_option( 'active_plugins', array() );
		$active_plugins = is_array( $prev_active ) ? $prev_active : array();
		if ( ! in_array( 'gutenberg/gutenberg.php', $active_plugins, true ) ) {
			$active_plugins[] = 'gutenberg/gutenberg.php';
			update_option( 'active_plugins', $active_plugins );
		}

		$_POST = array( 'nonce' => wp_create_nonce( 'desktop-mode-enable-guidelines' ) );

		try {
			$this->_handleAjax( 'desktop_mode_enable_guidelines_experiment' );
		} catch ( WPAjaxDieContinueException $e ) {
			// Expected on success.
		} catch ( WPAjaxDieStopException $e ) {
			// Same.
		}

		$opts = get_option( 'gutenberg-experiments', array() );
		$this->assertIsArray( $opts );
		$this->assertSame( 1, $opts['gutenberg-guidelines'] ?? null );

		update_option( 'active_plugins', $prev_active );
	}
}
