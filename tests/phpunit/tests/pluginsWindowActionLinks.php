<?php
/**
 * Tests for the Plugins app's row links (`apps/plugins/parts/action-links.php`):
 * the "Settings" / "Docs" links a plugin adds to its own row on
 * `plugins.php`, offered by the native window too. A plugin that hides
 * its settings page from the admin menu leaves that link as its only
 * way in.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-plugins-window
 * @group ajax
 */
require_once ABSPATH . 'wp-admin/includes/ajax-actions.php';

class Tests_OpenStation_PluginsWindowActionLinks extends WP_Ajax_UnitTestCase {

	const FILE = 'row-links/row-links.php';

	private $admin_id;
	private $subscriber_id;

	public function set_up() {
		parent::set_up();
		$this->admin_id      = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		if ( is_multisite() ) {
			grant_super_admin( $this->admin_id );
		}
	}

	public function tear_down() {
		remove_all_filters( 'plugin_action_links' );
		remove_all_filters( 'plugin_action_links_' . self::FILE );
		parent::tear_down();
	}

	/**
	 * The row's links as `plugins.php` would show them, minus Core's own
	 * verbs: relative hrefs resolve against wp-admin, an outside page is
	 * flagged as such, and entries that open nothing are dropped. The
	 * filters get Core's starting actions, so a plugin that adds its link
	 * only to an active row (one with `deactivate`) is seen too.
	 *
	 * @covers ::openstation_plugins_window_action_links
	 */
	public function test_returns_the_links_a_plugin_adds_to_its_row() {
		update_option( 'active_plugins', array( self::FILE ) );
		add_filter(
			'plugin_action_links_' . self::FILE,
			static function ( $actions ) {
				if ( isset( $actions['deactivate'] ) ) {
					$actions['settings'] = '<a href="options-general.php?page=row-links">Settings</a>';
				}
				$actions['docs']       = '<a href="https://docs.example.test/" target="_blank">Docs</a>';
				$actions['survey']     = '<a href="#" onclick="return false">Feedback</a>';
				$actions['script']     = '<a href="javascript:void(0)">Run</a>';
				$actions['required']   = 'Required by Another Plugin';
				$actions['deactivate'] = '<a href="#" class="survey-trigger">Deactivate</a>';
				return $actions;
			}
		);

		$links = openstation_plugins_window_action_links( self::FILE, array( 'Name' => 'Row Links' ) );

		$this->assertSame(
			array(
				array(
					'key'   => 'settings',
					'label' => 'Settings',
					'url'   => admin_url( 'options-general.php?page=row-links' ),
					'admin' => true,
				),
				array(
					'key'   => 'docs',
					'label' => 'Docs',
					'url'   => 'https://docs.example.test/',
					'admin' => false,
				),
			),
			$links
		);
	}

	/**
	 * The endpoint keys rows the way `/wp/v2/plugins` does (no `.php`),
	 * and is gated like the Plugins screen. OpenStation's own row link
	 * (open or turn on the shell) stays out: the window lives inside
	 * the shell already.
	 *
	 * @covers ::openstation_plugins_window_ajax_action_links
	 */
	public function test_endpoint_keys_rows_by_plugin_id_and_is_gated() {
		add_filter(
			'plugin_action_links',
			static function ( $actions ) {
				$actions['help'] = '<a href="https://help.example.test/">Help</a>';
				return $actions;
			}
		);

		wp_set_current_user( $this->subscriber_id );
		$denied = $this->dispatch();
		$this->assertFalse( $denied['success'] );
		$this->assertSame( 'openstation_plugins_forbidden', $denied['data']['code'] );

		wp_set_current_user( $this->admin_id );
		$response = $this->dispatch();
		$this->assertTrue( $response['success'] );
		$this->assertArrayHasKey( 'desktop-mode/desktop-mode', $response['data'] );
		$keys = array_column( $response['data']['desktop-mode/desktop-mode'], 'key' );
		$this->assertContains( 'help', $keys );
		$this->assertNotContains( 'openstation', $keys );
	}

	/** Dispatch the action-links AJAX action and return the decoded body. */
	private function dispatch() {
		$_POST                = array( '_ajax_nonce' => wp_create_nonce( 'desktop-mode-plugins' ) );
		$this->_last_response = '';
		try {
			$this->_handleAjax( 'openstation_plugins_action_links' );
		} catch ( WPAjaxDieContinueException $e ) {
			// Expected — wp_send_json_* throws this in tests.
		} catch ( WPAjaxDieStopException $e ) {
			// Some Core paths throw this variant instead.
		}
		return json_decode( $this->_last_response, true );
	}
}
