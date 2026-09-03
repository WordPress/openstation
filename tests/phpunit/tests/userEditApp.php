<?php
/**
 * Tests for the User Edit app — the App Framework port of the
 * native User Edit window: the manifest, the gate, the params-driven
 * target and the `reopen` retarget, and the facts the form reads.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group user-edit-app
 */
class Tests_OpenStation_UserEditApp extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		foreach ( array_keys( openstation_apps_registry()->all() ) as $id ) {
			openstation_unregister_icon( $id );
		}
		parent::tear_down();
	}

	/**
	 * Run one dispatch against the registered app.
	 *
	 * @param string $action Action name.
	 * @param array  $params Open-time params.
	 * @param array  $state  Client state.
	 * @return array Runtime response.
	 */
	protected function dispatch( $action, array $params = array(), array $state = array() ) {
		return openstation_apps_runtime()->dispatch(
			'desktop-mode-user-edit',
			array(
				'action' => $action,
				'state'  => $state,
				'params' => $params,
			),
			openstation_apps_os()
		);
	}

	/**
	 * @covers \OpenStation\App::manifest
	 */
	public function test_manifest_mirrors_the_legacy_windows_registration() {
		$app = openstation_apps_registry()->get( 'desktop-mode-user-edit' );
		$this->assertNotNull( $app );
		$manifest = $app->manifest();
		$this->assertSame( 'Edit user', $manifest['title'] );
		$this->assertSame( 'dashicons-admin-users', $manifest['icon'] );
		$this->assertSame( 1100, $manifest['width'] );
		$this->assertSame( 760, $manifest['height'] );
		$this->assertSame( 720, $manifest['min_width'] );
		$this->assertSame( 520, $manifest['min_height'] );
		$this->assertSame( 'none', $manifest['placement'] );
		$this->assertSame( array( 'userId' => 0 ), $manifest['state'] );
		// A live singleton reopened on someone else retargets.
		$this->assertSame( array( 'reopen' ), $manifest['lifecycle'] );
	}

	/**
	 * @covers \OpenStation\App::allows
	 */
	public function test_gate_admits_any_logged_in_user_and_follows_the_legacy_filter() {
		$app = openstation_apps_registry()->get( 'desktop-mode-user-edit' );
		$this->assertTrue( $app->allows( openstation_apps_os() ) );
		wp_set_current_user( self::$editor_id );
		$this->assertTrue( $app->allows( openstation_apps_os() ), 'everyone has a profile to edit' );

		add_filter( 'openstation_user_edit_window_user_can_register', '__return_false' );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );
		remove_filter( 'openstation_user_edit_window_user_can_register', '__return_false' );

		wp_set_current_user( 0 );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );
	}

	/**
	 * The role dropdown lists what the viewer can assign: everything
	 * for an admin, nothing for an editor (`promote_users`).
	 *
	 * @covers ::openstation_users_window_role_label_map
	 */
	public function test_the_role_facts_follow_the_viewers_promote_capability() {
		$app = openstation_apps_registry()->get( 'desktop-mode-user-edit' );

		$config = $app->manifest()['config'];
		$this->assertTrue( $config['canPromote'], 'admin should have promote_users' );
		$this->assertArrayHasKey( 'administrator', $config['assignableRoles'] );
		$this->assertArrayHasKey( 'editor', $config['assignableRoles'] );
		$this->assertArrayHasKey( 'subscriber', $config['assignableRoles'] );
		// `allRoles` still ships as the fallback catalogue.
		$this->assertArrayHasKey( 'subscriber', $config['allRoles'] );
		$this->assertSame( self::$admin_id, $config['currentUserId'] );
		$this->assertNotEmpty( $config['colorSchemes'] );
		$this->assertArrayHasKey( '', $config['locales'] );

		wp_set_current_user( self::$editor_id );
		$config = $app->manifest()['config'];
		$this->assertFalse( $config['canPromote'], 'editor lacks promote_users by default' );
		$this->assertSame( array(), $config['assignableRoles'], 'no promote_users → no assignable roles' );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_mount_reads_the_user_from_the_params_and_falls_back_to_the_viewer() {
		$targeted = $this->dispatch( 'mount', array( 'userId' => self::$editor_id ) );
		$this->assertTrue( $targeted['ok'] );
		$this->assertSame( self::$editor_id, $targeted['state']['userId'] );
		$this->assertSame( self::$editor_id, $targeted['data']['userId'] );

		// `profile.php` carries no id: the viewer's own profile.
		$own = $this->dispatch( 'mount' );
		$this->assertSame( self::$admin_id, $own['state']['userId'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_reopen_retargets_the_live_window() {
		$response = $this->dispatch( 'reopen', array( 'userId' => self::$editor_id ), array( 'userId' => self::$admin_id ) );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( self::$editor_id, $response['state']['userId'] );

		$plain = $this->dispatch( 'reopen', array(), array( 'userId' => self::$editor_id ) );
		$this->assertSame( self::$admin_id, $plain['state']['userId'], 'a reopen without an id lands on the viewer' );
	}
}
