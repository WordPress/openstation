<?php
/**
 * AJAX endpoint tests for the OpenStation toggle.
 *
 * @package WordPress
 * @subpackage UnitTests
 */
require_once ABSPATH . 'wp-admin/includes/ajax-actions.php';

/**
 * @group openstation
 * @group ajax
 *
 * @covers ::openstation_ajax_save
 */
class Tests_OpenStation_AjaxSave extends WP_Ajax_UnitTestCase {

	public function tear_down() {
		remove_all_filters( 'openstation_mode_enabled' );
		parent::tear_down();
	}

	/**
	 * Helper: prime $_POST and dispatch the AJAX action, capturing
	 * the JSON response body via the standard WP_Ajax_UnitTestCase
	 * exception handshake.
	 */
	private function dispatch( $enabled, $with_nonce = true, $extra = array() ) {
		$_POST = array_merge( array( 'enabled' => $enabled ), $extra );
		if ( $with_nonce ) {
			$_POST['nonce'] = wp_create_nonce( 'save-openstation' );
		}

		try {
			$this->_handleAjax( 'save-openstation' );
		} catch ( WPAjaxDieContinueException $e ) {
			// Expected — wp_send_json_* throws this in tests.
		}

		return json_decode( $this->_last_response, true );
	}

	public function test_enables_openstation_for_user() {
		$this->_setRole( 'administrator' );
		$response = $this->dispatch( '1' );

		$this->assertTrue( $response['success'] );
		$this->assertSame( '1', $response['data']['enabled'] );
		$this->assertSame( '1', get_user_meta( get_current_user_id(), 'desktop_mode_mode', true ) );
	}

	/**
	 * Enabling must return the shell screen with the Dashboard as its
	 * target so the client navigates straight into the desktop on a
	 * stable entry point. The explicit "Switch to OpenStation" action
	 * is a deliberate user gesture that benefits from a predictable
	 * starting point; visiting `/openstation/` directly (a bookmark or
	 * shared link) still goes through the portal handler and its
	 * session-restore / default-window logic. Only the toggle's
	 * redirect is pinned here.
	 */
	public function test_enable_response_redirects_to_shell_screen_with_dashboard_target() {
		$this->_setRole( 'administrator' );
		$response = $this->dispatch( '1' );

		$expected = openstation_shell_url( admin_url( 'index.php' ) );
		$this->assertSame( $expected, $response['data']['redirect'] );
		$this->assertTrue( openstation_url_is_shell_screen( $response['data']['redirect'] ) );
		$this->assertStringContainsString( 'target=', $response['data']['redirect'] );
		// Not the home-relative `/openstation/` portal URL — that path
		// keeps working for users hitting it directly, but the toggle
		// does not forward through it.
		$this->assertNotSame( openstation_portal_url(), $response['data']['redirect'] );
	}

	public function test_disables_openstation_for_user() {
		$this->_setRole( 'administrator' );
		update_user_meta( get_current_user_id(), 'desktop_mode_mode', '1' );

		$response = $this->dispatch( '' );

		$this->assertTrue( $response['success'] );
		$this->assertSame( '', $response['data']['enabled'] );
		$this->assertSame( '', get_user_meta( get_current_user_id(), 'desktop_mode_mode', true ) );
	}

	/**
	 * Disabling must NOT redirect through the portal. The portal's
	 * auto-enable filter would flip the user meta back to '1' on the next
	 * request and trap them in OpenStation. Send them to a plain admin
	 * URL instead.
	 */
	/**
	 * The toggle's `network` flag is client-supplied, so the handler
	 * confirms the capability first. Off a network nobody holds it.
	 */
	public function test_network_claim_without_the_capability_is_ignored() {
		$this->_setRole( 'administrator' );
		$response = $this->dispatch( '1', true, array( 'network' => '1' ) );

		$this->assertSame(
			openstation_shell_url( admin_url( 'index.php' ), false, false ),
			$response['data']['redirect']
		);
	}

	public function test_disable_response_redirects_to_plain_admin_not_portal() {
		$this->_setRole( 'administrator' );
		update_user_meta( get_current_user_id(), 'desktop_mode_mode', '1' );

		$response = $this->dispatch( '' );

		$this->assertSame( admin_url(), $response['data']['redirect'] );
		$this->assertNotSame( openstation_portal_url(), $response['data']['redirect'] );
	}

	/**
	 * Anything other than the literal string '1' is normalized to off.
	 * Prevents stray truthy values from accidentally enabling the mode.
	 */
	public function test_non_one_truthy_values_disable_mode() {
		$this->_setRole( 'administrator' );
		update_user_meta( get_current_user_id(), 'desktop_mode_mode', '1' );

		$response = $this->dispatch( 'true' );

		$this->assertTrue( $response['success'] );
		$this->assertSame( '', $response['data']['enabled'] );
		$this->assertSame( '', get_user_meta( get_current_user_id(), 'desktop_mode_mode', true ) );
	}

	public function test_missing_nonce_dies() {
		$this->_setRole( 'administrator' );

		$this->expectException( WPAjaxDieStopException::class );
		$this->_last_response = '';
		$_POST                = array( 'enabled' => '1' );
		$this->_handleAjax( 'save-openstation' );
	}

	public function test_invalid_nonce_dies() {
		$this->_setRole( 'administrator' );

		$this->expectException( WPAjaxDieStopException::class );
		$_POST = array(
			'enabled' => '1',
			'nonce'   => 'not-a-real-nonce',
		);
		$this->_handleAjax( 'save-openstation' );
	}

	/**
	 * The openstation_mode_enabled filter must be honored: if a plugin
	 * disables OpenStation for this user, the AJAX endpoint refuses
	 * to update the meta.
	 */
	public function test_openstation_mode_enabled_filter_blocks_save() {
		$this->_setRole( 'administrator' );
		add_filter( 'openstation_mode_enabled', '__return_false' );

		$response = $this->dispatch( '1' );

		$this->assertFalse( $response['success'] );
		$this->assertSame( 'openstation_disabled', $response['data'] );
		$this->assertSame( '', get_user_meta( get_current_user_id(), 'desktop_mode_mode', true ) );
	}

	/**
	 * A user whose role lacks the `read` capability must be turned away
	 * even if they managed to obtain a valid save-openstation nonce:
	 * nonce ≠ authorization. Verifies the current_user_can( 'read' )
	 * gate that sits after the nonce check.
	 */
	public function test_user_without_read_cap_is_forbidden() {
		// Build a throwaway role with no capabilities, including no `read`.
		add_role( 'openstation_test_nonread', 'No Read', array() );
		$uid = self::factory()->user->create( array( 'role' => 'openstation_test_nonread' ) );
		wp_set_current_user( $uid );

		$response = $this->dispatch( '1' );

		$this->assertFalse( $response['success'] );
		$this->assertSame( 'openstation_forbidden', $response['data'] );
		$this->assertSame( '', get_user_meta( $uid, 'desktop_mode_mode', true ) );

		remove_role( 'openstation_test_nonread' );
	}

	/**
	 * The filter receives the user ID so plugins can make role-based
	 * decisions.
	 */
	public function test_openstation_mode_enabled_filter_receives_user_id() {
		$this->_setRole( 'administrator' );
		$expected_id = get_current_user_id();
		$received_id = null;

		add_filter(
			'openstation_mode_enabled',
			function ( $enabled, $user_id ) use ( &$received_id ) {
				$received_id = $user_id;
				return $enabled;
			},
			10,
			2
		);

		$this->dispatch( '1' );

		$this->assertSame( $expected_id, $received_id );
	}
}
