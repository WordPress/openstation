<?php
/**
 * Tests for the capability gate on the Users-window REST fields.
 *
 * The `desktop_mode_last_login` and `desktop_mode_presence` fields
 * register on the core `user` resource on every REST request, and
 * the `user` resource is partially public — any author with a
 * published post is visible to low-cap (or logged-out) viewers via
 * `/wp/v2/users/<id>`. The field callbacks must therefore gate on
 * `list_users` (or self) and return their empty defaults (`null` /
 * `'offline'`) to everyone else, so last-login times and live
 * presence of site authors never leak to unprivileged viewers.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-users-window
 */
class Tests_DesktopMode_UsersWindowRestFieldsCapGate extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;
	protected static $author_id;

	const LAST_LOGIN_TS = 1700000000;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
		self::$author_id     = $factory->user->create( array( 'role' => 'author' ) );

		// A published post makes the author publicly visible on
		// `/wp/v2/users/<id>` — the exact surface the gate protects.
		$factory->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'publish',
			)
		);
	}

	public function set_up() {
		parent::set_up();

		update_user_meta( self::$author_id, DESKTOP_MODE_LAST_LOGIN_META_KEY, self::LAST_LOGIN_TS );
		desktop_mode_presence_record( self::$author_id, true );
	}

	/**
	 * Fetch the author's user resource as the current user.
	 *
	 * @return array Response data.
	 */
	private function get_author_resource() {
		$request = new WP_REST_Request( 'GET', '/wp/v2/users/' . (int) self::$author_id );
		return rest_get_server()->dispatch( $request )->get_data();
	}

	/**
	 * A viewer without `list_users` must only ever see the empty
	 * defaults for another user's last-login and presence.
	 *
	 * @covers ::desktop_mode_users_window_register_rest_fields
	 */
	public function test_subscriber_gets_empty_defaults_for_other_user() {
		wp_set_current_user( self::$subscriber_id );

		$data = $this->get_author_resource();

		$this->assertArrayHasKey( 'desktop_mode_last_login', $data );
		$this->assertNull(
			$data['desktop_mode_last_login'],
			'last-login must not leak to viewers without list_users'
		);

		$this->assertArrayHasKey( 'desktop_mode_presence', $data );
		$this->assertSame(
			'offline',
			$data['desktop_mode_presence'],
			'live presence must not leak to viewers without list_users'
		);
	}

	/**
	 * A viewer with `list_users` gets the real values.
	 *
	 * @covers ::desktop_mode_users_window_register_rest_fields
	 */
	public function test_admin_sees_last_login_and_presence() {
		wp_set_current_user( self::$admin_id );

		$data = $this->get_author_resource();

		$this->assertSame( self::LAST_LOGIN_TS, $data['desktop_mode_last_login'] );
		$this->assertSame( 'online', $data['desktop_mode_presence'] );
	}

	/**
	 * Users can always see their own last-login and presence, even
	 * without `list_users`.
	 *
	 * @covers ::desktop_mode_users_window_register_rest_fields
	 */
	public function test_user_sees_own_last_login_and_presence() {
		wp_set_current_user( self::$author_id );

		$data = $this->get_author_resource();

		$this->assertSame( self::LAST_LOGIN_TS, $data['desktop_mode_last_login'] );
		$this->assertSame( 'online', $data['desktop_mode_presence'] );
	}
}
