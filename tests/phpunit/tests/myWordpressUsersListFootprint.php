<?php
/**
 * Tests for the "View activity footprint" row action added to the
 * classic Users list table (`open_station_user_footprint_row_action`,
 * hooked on `user_row_actions`).
 *
 * @package OpenStation
 *
 * @group openstation
 */
class Tests_OpenStation_MyWordpress_UsersListFootprint extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create(
			array(
				'role'         => 'editor',
				'display_name' => 'Edie & Co',
			)
		);
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		delete_user_meta( self::$editor_id, 'desktop_mode_mode' );
		unset( $_GET['open_station_chromeless'], $_GET[ OPEN_STATION_CLASSIC_FLAG ] );
		remove_all_filters( 'open_station_user_footprint_row_action' );
		parent::tear_down();
	}

	/**
	 * Put the current user into a genuine chromeless request: desktop
	 * mode enabled + the iframe query flag the shell stamps.
	 */
	private function enable_chromeless( $user_id ) {
		update_user_meta( $user_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';
	}

	/**
	 * Run the filter against a user the way `WP_Users_List_Table` does.
	 */
	private function row_actions_for( $user_id ) {
		return open_station_user_footprint_row_action(
			array(),
			get_userdata( $user_id )
		);
	}

	/**
	 * @covers ::open_station_user_footprint_row_action
	 */
	public function test_action_absent_when_mode_off() {
		$actions = $this->row_actions_for( self::$editor_id );
		$this->assertArrayNotHasKey( 'os-footprint', $actions );
	}

	/**
	 * OpenStation on but a normal (non-iframe) request — the action
	 * is omitted so it never renders as a dead link outside the shell.
	 *
	 * @covers ::open_station_user_footprint_row_action
	 */
	public function test_action_absent_when_enabled_but_not_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$actions = $this->row_actions_for( self::$editor_id );
		$this->assertArrayNotHasKey( 'os-footprint', $actions );
	}

	/**
	 * A detached classic tab carries `?desktop_mode_classic=1` but NOT
	 * the chromeless flag, so the shell is absent — the action must be
	 * omitted (the link would otherwise open the profile editor under a
	 * misleading "footprint" label).
	 *
	 * @covers ::open_station_user_footprint_row_action
	 */
	public function test_action_absent_in_detached_classic_tab() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET[ OPEN_STATION_CLASSIC_FLAG ] = '1';
		$actions                           = $this->row_actions_for( self::$editor_id );
		$this->assertArrayNotHasKey( 'os-footprint', $actions );
	}

	/**
	 * @covers ::open_station_user_footprint_row_action
	 */
	public function test_action_present_on_chromeless_request() {
		$this->enable_chromeless( self::$admin_id );
		$actions = $this->row_actions_for( self::$editor_id );
		$this->assertArrayHasKey( 'os-footprint', $actions );
		$this->assertStringContainsString(
			'View activity footprint',
			$actions['os-footprint']
		);
	}

	/**
	 * Carries the target user id in the data attribute the chromeless
	 * bridge reads, escapes the display name, and links to the user's
	 * edit screen as the no-JS fallback.
	 *
	 * @covers ::open_station_user_footprint_row_action
	 */
	public function test_action_markup_attributes_and_escaping() {
		$this->enable_chromeless( self::$admin_id );
		$html = $this->row_actions_for( self::$editor_id )['os-footprint'];

		$this->assertStringContainsString(
			'data-os-footprint="' . self::$editor_id . '"',
			$html
		);
		// `display_name` is "Edie & Co" — esc_attr() must encode the
		// ampersand.
		$this->assertStringContainsString(
			'data-os-footprint-name="Edie &amp; Co"',
			$html
		);
		$this->assertStringContainsString( 'user-edit.php', $html );
		$this->assertStringContainsString( 'user_id=' . self::$editor_id, $html );
	}

	/**
	 * The viewer's own row falls back to `profile.php`, not
	 * `user-edit.php` (which would redirect there anyway in core).
	 *
	 * @covers ::open_station_user_footprint_row_action
	 */
	public function test_self_row_fallback_uses_profile_php() {
		$this->enable_chromeless( self::$admin_id );
		$html = $this->row_actions_for( self::$admin_id )['os-footprint'];
		$this->assertStringContainsString( 'profile.php', $html );
		$this->assertStringNotContainsString( 'user-edit.php', $html );
	}

	/**
	 * The `open_station_user_footprint_row_action` filter can suppress
	 * the action for a given user.
	 *
	 * @covers ::open_station_user_footprint_row_action
	 */
	public function test_filter_can_suppress_the_action() {
		$this->enable_chromeless( self::$admin_id );
		add_filter( 'open_station_user_footprint_row_action', '__return_false' );
		$actions = $this->row_actions_for( self::$editor_id );
		$this->assertArrayNotHasKey( 'os-footprint', $actions );
	}

	/**
	 * An invalid user object leaves the incoming actions untouched.
	 *
	 * @covers ::open_station_user_footprint_row_action
	 */
	public function test_invalid_user_object_returns_actions_unchanged() {
		$this->enable_chromeless( self::$admin_id );
		$actions = open_station_user_footprint_row_action(
			array( 'edit' => '<a>Edit</a>' ),
			null
		);
		$this->assertArrayNotHasKey( 'os-footprint', $actions );
		$this->assertArrayHasKey( 'edit', $actions );
	}
}
