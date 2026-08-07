<?php
/**
 * Tests for the native User Edit window's PHP registration config.
 *
 * Regression guard for the role-update UX: the window's config blob
 * must surface BOTH `canPromote` (so the JS can hide the role select
 * for viewers who can't promote) AND `assignableRoles` (so the
 * select only lists roles the viewer can actually assign). Without
 * the latter the dropdown surfaces roles outside the viewer's
 * `editable_roles`; the server rejects the assignment, the user
 * reads it as "the update silently failed".
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-user-edit-window
 */
class Tests_OpenStation_UserEditWindowRegistration extends WP_UnitTestCase {

	private $admin_id;
	private $editor_id;

	public function set_up() {
		parent::set_up();
		$this->admin_id  = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->editor_id = self::factory()->user->create( array( 'role' => 'editor' ) );
	}

	/**
	 * The config blob must include the keys the JS reads to decide
	 * whether to render the role dropdown and which options to put
	 * in it.
	 *
	 * @covers ::openstation_user_edit_window_register_window
	 */
	public function test_admin_config_carries_promote_capability_and_assignable_roles() {
		wp_set_current_user( $this->admin_id );
		openstation_user_edit_window_register_window();

		$entry = openstation_native_window_registry( 'desktop-mode-user-edit' );
		$this->assertIsArray( $entry );
		$this->assertArrayHasKey( 'config', $entry );

		$config = $entry['config'];
		$this->assertArrayHasKey( 'canPromote', $config );
		$this->assertTrue( $config['canPromote'], 'admin should have promote_users' );

		$this->assertArrayHasKey( 'assignableRoles', $config );
		$this->assertIsArray( $config['assignableRoles'] );
		// Admin can assign any role.
		$this->assertArrayHasKey( 'administrator', $config['assignableRoles'] );
		$this->assertArrayHasKey( 'editor', $config['assignableRoles'] );
		$this->assertArrayHasKey( 'subscriber', $config['assignableRoles'] );

		// `allRoles` still ships so the role FILTER (which lists every
		// role on the install) keeps working.
		$this->assertArrayHasKey( 'allRoles', $config );
	}

	/**
	 * A viewer without `promote_users` (default editor) must see
	 * `canPromote => false` so the JS hides the dropdown.
	 *
	 * @covers ::openstation_user_edit_window_register_window
	 */
	public function test_editor_config_reports_no_promote_capability() {
		wp_set_current_user( $this->editor_id );
		openstation_user_edit_window_register_window();

		$entry  = openstation_native_window_registry( 'desktop-mode-user-edit' );
		$config = $entry['config'];

		$this->assertFalse(
			$config['canPromote'],
			'editor lacks promote_users by default'
		);
		$this->assertSame(
			array(),
			$config['assignableRoles'],
			'no promote_users → no assignable roles'
		);
	}
}
