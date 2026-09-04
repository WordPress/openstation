<?php
/**
 * Tests for the User Edit app — the App Framework port of the
 * native User Edit window: the manifest, the gate, the params-driven
 * target and the `reopen` retarget, the facts the form reads, the
 * companion profile bundle, the personal-options meta core's PUT
 * saves, and the account routes' gate and scopes.
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

	/**
	 * The profile surface is one bundle, registered once and appended
	 * to the companion scripts of both windows that host it.
	 *
	 * @covers ::openstation_users_profile_register_script
	 * @covers ::openstation_users_profile_window_args
	 */
	public function test_the_profile_bundle_is_registered_and_rides_both_windows() {
		// Registered on `init` at bootstrap; a test class that rebuilds
		// `$wp_scripts` loses it, so the filter path re-registers — that
		// safety net is what this asserts.
		$this->assertArrayHasKey( 'scripts', openstation_users_profile_window_args( array(), 'desktop-mode-users' ) );
		$this->assertTrue( wp_script_is( 'openstation-user-profile', 'registered' ) );

		$edit = openstation_users_profile_window_args( array( 'scripts' => array( 'x' ) ), 'desktop-mode-user-edit' );
		$this->assertSame( array( 'x', 'openstation-user-profile' ), $edit['scripts'] );
		$this->assertSame( $edit, openstation_users_profile_window_args( $edit, 'desktop-mode-user-edit' ), 'appended once' );
		$users = openstation_users_profile_window_args( array(), 'desktop-mode-users' );
		$this->assertSame( array( 'openstation-user-profile' ), $users['scripts'] );
		$this->assertSame( array(), openstation_users_profile_window_args( array(), 'desktop-mode-posts' ) );
	}

	/**
	 * The personal options and the contact methods save through core's
	 * `PUT /wp/v2/users/<id>` `meta` field, which only carries keys
	 * registered with `show_in_rest`.
	 *
	 * @covers ::openstation_user_edit_window_register_meta
	 */
	public function test_personal_options_and_contact_methods_round_trip_through_core_put() {
		$signal = static function ( $methods ) {
			$methods['signal'] = 'Signal';
			return $methods;
		};
		add_filter( 'user_contactmethods', $signal );
		// The registration runs on `rest_api_init`; in the full suite an
		// earlier class may have created the REST server (so the hook
		// already fired) AND reset the meta-key registry between tests.
		// Register for this test the way core's own meta REST tests do.
		openstation_user_edit_window_register_meta();
		$request = new WP_REST_Request( 'PUT', '/wp/v2/users/' . self::$editor_id );
		$request->set_body_params(
			array(
				'meta' => array(
					'admin_color'  => 'midnight',
					'rich_editing' => 'false',
					'signal'       => '@edgar',
				),
			)
		);
		$response = rest_do_request( $request );
		remove_filter( 'user_contactmethods', $signal );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'midnight', get_user_meta( self::$editor_id, 'admin_color', true ) );
		$this->assertSame( 'false', get_user_meta( self::$editor_id, 'rich_editing', true ) );
		$this->assertSame( '@edgar', get_user_meta( self::$editor_id, 'signal', true ) );
		$this->assertSame( 'midnight', $response->get_data()['meta']['admin_color'] );
	}

	/**
	 * Every route gates on `edit_user` for the target: an editor may
	 * read and act on their own profile, and on nobody else's.
	 *
	 * @covers ::openstation_user_edit_window_rest_permission
	 */
	public function test_the_routes_refuse_a_viewer_without_edit_user_on_the_target() {
		wp_set_current_user( self::$editor_id );
		$base   = '/desktop-mode/v1/users/' . self::$admin_id;
		$routes = array(
			array( 'GET', $base . '/insights' ),
			array( 'POST', $base . '/destroy-sessions' ),
			array( 'GET', $base . '/application-passwords' ),
			array( 'POST', $base . '/application-passwords' ),
			array( 'DELETE', $base . '/application-passwords/0123abcd-0000-4000-8000-000000000000' ),
		);
		foreach ( $routes as $route ) {
			list( $method, $path ) = $route;
			$request               = new WP_REST_Request( $method, $path );
			if ( 'POST' === $method ) {
				$request->set_body_params( array( 'name' => 'x' ) );
			}
			$response = rest_do_request( $request );
			$this->assertSame( 403, $response->get_status(), "$method $path" );
		}

		$own = rest_do_request( new WP_REST_Request( 'GET', '/desktop-mode/v1/users/' . self::$editor_id . '/insights' ) );
		$this->assertSame( 200, $own->get_status() );
		$this->assertSame( self::$editor_id, $own->get_data()['userId'] );
	}

	/**
	 * Logging out elsewhere: self keeps this device unless asked for
	 * `all`; another user loses every session whatever the scope.
	 *
	 * @covers ::openstation_user_edit_window_rest_destroy_sessions
	 */
	public function test_destroy_sessions_spares_this_device_for_self_by_default() {
		$manager = WP_Session_Tokens::get_instance( self::$admin_id );
		$manager->destroy_all();
		$mine  = $manager->create( time() + HOUR_IN_SECONDS );
		$other = $manager->create( time() + HOUR_IN_SECONDS );
		$_COOKIE[ LOGGED_IN_COOKIE ] = wp_generate_auth_cookie( self::$admin_id, time() + HOUR_IN_SECONDS, 'logged_in', $mine );
		$this->assertSame( $mine, wp_get_session_token() );

		$response = rest_do_request( new WP_REST_Request( 'POST', '/desktop-mode/v1/users/' . self::$admin_id . '/destroy-sessions' ) );
		$this->assertSame( 200, $response->get_status() );
		$this->assertIsArray( $manager->get( $mine ), 'this device stays logged in' );
		$this->assertNull( $manager->get( $other ) );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/users/' . self::$admin_id . '/destroy-sessions' );
		$request->set_body_params( array( 'scope' => 'all' ) );
		rest_do_request( $request );
		$this->assertNull( $manager->get( $mine ), '`all` logs this device out too' );

		$theirs = WP_Session_Tokens::get_instance( self::$editor_id );
		$token  = $theirs->create( time() + HOUR_IN_SECONDS );
		rest_do_request( new WP_REST_Request( 'POST', '/desktop-mode/v1/users/' . self::$editor_id . '/destroy-sessions' ) );
		$this->assertNull( $theirs->get( $token ), 'another user: everything, whatever the scope' );

		unset( $_COOKIE[ LOGGED_IN_COOKIE ] );
	}
}
