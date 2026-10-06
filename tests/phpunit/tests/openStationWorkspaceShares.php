<?php
/**
 * Shared workspaces: the share record, the link claim, the pin, the
 * fence and "Hide settings".
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-workspace-shares
 */
class Tests_OpenStation_WorkspaceShares extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;
	protected static $author_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );
		self::$author_id     = $factory->user->create( array( 'role' => 'author' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function tear_down() {
		foreach ( array( self::$admin_id, self::$editor_id, self::$author_id, self::$subscriber_id ) as $user_id ) {
			delete_user_option( $user_id, OPENSTATION_WORKSPACE_PIN_OPTION );
			delete_user_option( $user_id, OPENSTATION_WORKSPACE_CLAIMS_OPTION );
			delete_user_meta( $user_id, OPENSTATION_SESSION_META_KEY );
			delete_user_meta( $user_id, 'desktop_mode_mode' );
			delete_user_meta( $user_id, OPENSTATION_OS_SETTINGS_META_KEY );
		}
		parent::tear_down();
	}

	/** A workspace profile narrowed to Posts, with one window. */
	private function profile( array $extra = array() ) {
		return array_merge(
			array(
				'icon'    => 'dashicons-cart',
				'color'   => '#2271b1',
				'apps'    => array(
					'mode' => 'only',
					'ids'  => array( 'edit-php' ),
				),
				'windows' => array(
					array(
						'match' => 'edit-php',
						'url'   => 'edit.php',
					),
				),
				'layout'  => 'free',
			),
			$extra
		);
	}

	private function share( array $extra = array() ) {
		$share = openstation_workspace_share_publish( self::$admin_id, 'desktop-2', 'Store', $this->profile( $extra ) );
		$this->assertIsArray( $share );
		return $share;
	}

	private function editor_session( array $session ) {
		update_user_meta( self::$editor_id, OPENSTATION_SESSION_META_KEY, $session );
	}

	/**
	 * @covers ::openstation_workspace_share_publish
	 * @covers ::openstation_workspace_share_find_by_token
	 */
	public function test_publishing_twice_republishes_the_same_link() {
		$first  = $this->share();
		$second = openstation_workspace_share_publish( self::$admin_id, 'desktop-2', 'Store v2', $this->profile() );

		$this->assertSame( $first['id'], $second['id'] );
		$this->assertSame( $first['token'], $second['token'] );
		$this->assertSame( 2, $second['version'] );
		$this->assertFalse( $second['profile']['provisioned'] );
		$this->assertSame( $first['id'], openstation_workspace_share_find_by_token( $first['token'] )['id'] );
		$this->assertNull( openstation_workspace_share_find_by_token( 'nope' ) );
	}

	/**
	 * @covers ::openstation_workspace_share_sanitize_snapshot
	 */
	public function test_the_workspaces_app_never_travels_with_a_share() {
		$share = openstation_workspace_share_publish(
			self::$admin_id,
			'desktop-2',
			'Store',
			$this->profile(
				array(
					'apps'    => array(
						'mode' => 'only',
						'ids'  => array( 'edit-php', 'openstation-workspaces' ),
					),
					'windows' => array(
						array( 'match' => 'openstation-workspaces' ),
						array(
							'match' => 'edit-php',
							'url'   => 'edit.php',
						),
					),
				)
			)
		);

		$this->assertSame( array( 'edit-php' ), $share['profile']['apps']['ids'] );
		$this->assertSame( array( 'edit-php' ), wp_list_pluck( $share['profile']['windows'], 'match' ) );
	}

	/**
	 * @covers ::openstation_workspace_share_publish
	 */
	public function test_only_users_who_can_share_may_publish() {
		$result = openstation_workspace_share_publish( self::$editor_id, 'desktop-2', 'Mine', $this->profile() );
		$this->assertWPError( $result );
	}

	/**
	 * @covers ::openstation_workspace_share_claim
	 * @covers ::openstation_workspace_pin_enforce_session
	 */
	public function test_claiming_pins_the_workspace_as_the_only_desk() {
		$share = $this->share();
		$this->editor_session(
			array(
				'desktops'      => array(
					array(
						'id'    => 'desktop-1',
						'label' => 'Mine',
					),
					array(
						'id'    => 'desktop-3',
						'label' => 'Other',
					),
				),
				'activeDesktop' => 'desktop-3',
				'windows'       => array(),
			)
		);

		$result = openstation_workspace_share_claim( $share['token'], self::$editor_id );

		$this->assertSame( 'pinned', $result['status'] );
		$this->assertSame( '1', get_user_meta( self::$editor_id, 'desktop_mode_mode', true ) );
		$session = openstation_get_session( self::$editor_id, false );
		$this->assertCount( 1, $session['desktops'] );
		$this->assertSame( 'Store', $session['desktops'][0]['label'] );
		$this->assertSame( 'desktop-1', $session['activeDesktop'] );
		// Not yet opened at this version: the first load provisions.
		$this->assertFalse( $session['desktops'][0]['profile']['provisioned'] );
	}

	/**
	 * @covers ::openstation_workspace_share_claim
	 */
	public function test_a_link_claims_once_and_lands_on_the_copy_after() {
		$share = $this->share();
		openstation_workspace_share_claim( $share['token'], self::$editor_id );
		$again = openstation_workspace_share_claim( $share['token'], self::$editor_id );

		$this->assertSame( 'already', $again['status'] );
		$this->assertSame( 'desktop-1', $again['desktop'] );
	}

	/**
	 * @covers ::openstation_workspace_share_claim
	 * @covers ::openstation_workspace_user_can_claim
	 */
	public function test_accounts_that_cannot_write_are_turned_away_untouched() {
		$share  = $this->share();
		$result = openstation_workspace_share_claim( $share['token'], self::$subscriber_id );

		$this->assertSame( 'not-allowed', $result['status'] );
		$this->assertFalse( openstation_workspace_is_pinned( self::$subscriber_id ) );
		$this->assertSame( '', get_user_meta( self::$subscriber_id, 'desktop_mode_mode', true ) );
		$this->assertEmpty( openstation_workspace_share_claimants( $share['id'] ) );
	}

	/**
	 * @covers ::openstation_workspace_share_rotate_token
	 */
	public function test_a_new_link_retires_the_old_one_and_keeps_its_people() {
		$share = $this->share();
		openstation_workspace_share_claim( $share['token'], self::$editor_id );

		$rotated = openstation_workspace_share_rotate_token( $share['id'] );

		$this->assertNotSame( $share['token'], $rotated['token'] );
		$this->assertSame( 'invalid', openstation_workspace_share_claim( $share['token'], self::$author_id )['status'] );
		$this->assertTrue( openstation_workspace_is_pinned( self::$editor_id ) );
		$this->assertSame( 'already', openstation_workspace_share_claim( $rotated['token'], self::$editor_id )['status'] );
	}

	/**
	 * @covers ::openstation_workspace_share_claim
	 */
	public function test_admins_get_an_ordinary_desk_not_a_pin() {
		$share  = $this->share();
		$result = openstation_workspace_share_claim( $share['token'], self::$admin_id );

		$this->assertSame( 'added', $result['status'] );
		$this->assertFalse( openstation_workspace_is_pinned( self::$admin_id ) );
		$ids = wp_list_pluck( openstation_get_session( self::$admin_id, false )['desktops'], 'id' );
		$this->assertContains( $result['desktop'], $ids );
	}

	/**
	 * @covers ::openstation_workspace_share_claim
	 */
	public function test_disabled_links_and_second_links_change_nothing() {
		$share = $this->share();
		openstation_workspace_share_set_disabled( $share['id'], true );
		$this->assertSame( 'disabled', openstation_workspace_share_claim( $share['token'], self::$editor_id )['status'] );
		$this->assertFalse( openstation_workspace_is_pinned( self::$editor_id ) );

		openstation_workspace_share_set_disabled( $share['id'], false );
		openstation_workspace_share_claim( $share['token'], self::$editor_id );
		$other = openstation_workspace_share_publish( self::$admin_id, 'desktop-5', 'Blog', $this->profile() );
		$this->assertSame( 'managed', openstation_workspace_share_claim( $other['token'], self::$editor_id )['status'] );
		$this->assertSame( $share['id'], openstation_workspace_pin_get( self::$editor_id )['share'] );
	}

	/**
	 * @covers ::openstation_workspace_pin_enforce_session
	 */
	public function test_a_pinned_session_cannot_grow_a_second_desk() {
		$share = $this->share();
		openstation_workspace_share_claim( $share['token'], self::$editor_id );

		openstation_save_session(
			self::$editor_id,
			array(
				'desktops'      => array(
					array(
						'id'    => 'desktop-1',
						'label' => 'Renamed',
					),
					array(
						'id'    => 'desktop-9',
						'label' => 'Escape',
					),
				),
				'activeDesktop' => 'desktop-9',
				'windows'       => array(),
				'updated'       => PHP_INT_MAX,
			),
			false
		);

		$session = openstation_get_session( self::$editor_id, false );
		$this->assertCount( 1, $session['desktops'] );
		$this->assertSame( 'Store', $session['desktops'][0]['label'] );
		$this->assertSame( 'desktop-1', $session['activeDesktop'] );
	}

	/**
	 * @covers ::openstation_workspace_pin_guard_mode_meta
	 * @covers ::openstation_workspace_pin_keep_enabled
	 */
	public function test_a_pinned_user_cannot_switch_openstation_off() {
		$share = $this->share();
		openstation_workspace_share_claim( $share['token'], self::$editor_id );

		update_user_meta( self::$editor_id, 'desktop_mode_mode', '' );
		delete_user_meta( self::$editor_id, 'desktop_mode_mode' );

		$this->assertSame( '1', get_user_meta( self::$editor_id, 'desktop_mode_mode', true ) );
		add_filter( 'openstation_mode_enabled', '__return_false' );
		$this->assertTrue( openstation_is_enabled( self::$editor_id ) );
		remove_filter( 'openstation_mode_enabled', '__return_false' );
	}

	/**
	 * @covers ::openstation_workspace_pin_release
	 */
	public function test_release_gives_the_desks_back_and_keeps_the_workspace() {
		$share = $this->share();
		$this->editor_session(
			array(
				'desktops'      => array(
					array(
						'id'    => 'desktop-1',
						'label' => 'Mine',
					),
				),
				'activeDesktop' => 'desktop-1',
				'windows'       => array(),
			)
		);
		openstation_workspace_share_claim( $share['token'], self::$editor_id );

		$this->assertTrue( openstation_workspace_pin_release( self::$editor_id ) );

		$this->assertFalse( openstation_workspace_is_pinned( self::$editor_id ) );
		$labels = wp_list_pluck( openstation_get_session( self::$editor_id, false )['desktops'], 'label' );
		$this->assertSame( array( 'Mine', 'Store' ), $labels );
		// Released, so OpenStation can be switched off again.
		update_user_meta( self::$editor_id, 'desktop_mode_mode', '' );
		$this->assertSame( '', get_user_meta( self::$editor_id, 'desktop_mode_mode', true ) );
	}

	/**
	 * @covers ::openstation_workspace_share_delete
	 * @covers ::openstation_workspace_share_claimants
	 */
	public function test_deleting_a_share_releases_everyone_it_pinned() {
		$share = $this->share();
		openstation_workspace_share_claim( $share['token'], self::$editor_id );
		openstation_workspace_share_claim( $share['token'], self::$author_id );
		$this->assertCount( 2, openstation_workspace_share_claimants( $share['id'] ) );

		$this->assertTrue( openstation_workspace_share_delete( $share['id'] ) );

		$this->assertFalse( openstation_workspace_is_pinned( self::$editor_id ) );
		$this->assertFalse( openstation_workspace_is_pinned( self::$author_id ) );
	}

	/**
	 * @covers ::openstation_workspace_seed_cosmetics
	 * @covers ::openstation_workspace_pin_hold_settings
	 * @covers ::openstation_workspace_pin_guard_settings_save
	 */
	public function test_cosmetic_settings_are_the_users_the_rest_are_held() {
		$share = $this->share(
			array(
				'appearance' => array(
					'wallpaper'     => 'mono',
					'confirmCloseAllWindows' => false,
					'dockPlacement' => 'left',
				),
			)
		);
		openstation_workspace_share_claim( $share['token'], self::$editor_id );

		$settings = openstation_get_os_settings( self::$editor_id );
		$this->assertSame( 'mono', $settings['wallpaper'] );
		$this->assertSame( false, $settings['confirmCloseAllWindows'] );
		$this->assertSame( 'left', $settings['dockPlacement'] );

		// The wallpaper is theirs to change; the close confirmation is not.
		openstation_save_os_settings(
			self::$editor_id,
			array_merge(
				$settings,
				array(
					'wallpaper'     => 'aurora',
					'confirmCloseAllWindows' => true,
				)
			)
		);
		$after = openstation_get_os_settings( self::$editor_id );
		$this->assertSame( 'aurora', $after['wallpaper'] );
		$this->assertSame( false, $after['confirmCloseAllWindows'] );

		// The desk paints only what the workspace holds.
		$desk = openstation_get_session( self::$editor_id, false )['desktops'][0];
		$this->assertArrayNotHasKey( 'wallpaper', $desk['profile']['appearance'] );
		$this->assertSame( false, $desk['profile']['appearance']['confirmCloseAllWindows'] );

		// Released: the held rule lets go, their own value comes back.
		openstation_workspace_pin_release( self::$editor_id );
		$this->assertSame( true, openstation_get_os_settings( self::$editor_id )['confirmCloseAllWindows'] );
	}

	/**
	 * A workspace keeps only the settings its author changed; a share
	 * fills the rest in at their defaults, so a pinned user still gets
	 * every one of them held — not whatever their own account had.
	 *
	 * @covers ::openstation_workspace_share_sanitize_snapshot
	 */
	public function test_a_share_carries_every_setting_even_from_a_sparse_workspace() {
		$own = openstation_get_os_settings( self::$editor_id );
		openstation_save_os_settings( self::$editor_id, array_merge( $own, array( 'confirmCloseAllWindows' => false ) ) );

		$share = $this->share( array( 'appearance' => array( 'wallpaper' => 'mono' ) ) );
		$this->assertSame( true, $share['profile']['appearance']['confirmCloseAllWindows'] );
		$this->assertSame( 'mono', $share['profile']['appearance']['wallpaper'] );
		$this->assertArrayNotHasKey( 'appliedThemeRecommendations', $share['profile']['appearance'] );

		openstation_workspace_share_claim( $share['token'], self::$editor_id );
		$this->assertSame( true, openstation_get_os_settings( self::$editor_id )['confirmCloseAllWindows'] );
	}

	/**
	 * @covers ::openstation_sanitize_workspace_notes
	 * @covers ::openstation_workspace_dismiss_note
	 */
	public function test_notes_are_plain_bounded_and_dismissed_per_user() {
		$notes = openstation_sanitize_workspace_notes(
			array(
				array(
					'id'    => 'abc123',
					'text'  => '<b>Hi</b> there',
					'size'  => 'xl',
					'color' => 'neon',
					'x'     => 2,
				),
				array(
					'id'   => 'empty',
					'text' => '   ',
				),
				array(
					'id'   => 'long',
					'text' => str_repeat( 'a', 1500 ),
				),
			)
		);
		$this->assertCount( 2, $notes );
		$this->assertSame( 'Hi there', $notes[0]['text'] );
		$this->assertSame( 'xl', $notes[0]['size'] );
		$this->assertSame( 'butter', $notes[0]['color'] );
		$this->assertSame( 1.0, $notes[0]['x'] );
		$this->assertSame( 1000, mb_strlen( $notes[1]['text'] ) );
		$this->assertCount( 8, openstation_sanitize_workspace_notes( array_fill( 0, 12, array( 'id' => 'n', 'text' => 'x' ) ) ) );

		openstation_workspace_dismiss_note( self::$editor_id, 'abc123' );
		openstation_workspace_dismiss_note( self::$editor_id, 'abc123' );
		$this->assertSame( array( 'abc123' ), openstation_workspace_dismissed_notes( self::$editor_id ) );
		$this->assertSame( array(), openstation_workspace_dismissed_notes( self::$author_id ) );
		delete_user_option( self::$editor_id, OPENSTATION_WORKSPACE_DISMISSED_NOTES_OPTION );
	}

	/**
	 * @covers ::openstation_workspace_fence_matches
	 * @covers ::openstation_workspace_fence_parse
	 */
	public function test_the_fence_matches_screens_and_what_they_imply() {
		$allow = array(
			'urls'       => array_map( 'openstation_workspace_fence_parse', array( 'index.php', 'edit.php?post_type=product', 'admin.php?page=wc-orders' ) ),
			'post_types' => array( 'product' ),
			'taxonomies' => array(),
		);
		$product = self::factory()->post->create( array( 'post_type' => 'product' ) );
		$post    = self::factory()->post->create();

		$this->assertTrue( openstation_workspace_fence_matches( $allow, 'edit.php', array( 'post_type' => 'product', 'paged' => '2' ) ) );
		$this->assertFalse( openstation_workspace_fence_matches( $allow, 'edit.php', array() ) );
		$this->assertTrue( openstation_workspace_fence_matches( $allow, 'admin.php', array( 'page' => 'wc-orders' ) ) );
		$this->assertFalse( openstation_workspace_fence_matches( $allow, 'admin.php', array( 'page' => 'wc-settings' ) ) );
		$this->assertTrue( openstation_workspace_fence_matches( $allow, 'post.php', array( 'post' => (string) $product ) ) );
		$this->assertFalse( openstation_workspace_fence_matches( $allow, 'post.php', array( 'post' => (string) $post ) ) );
		$this->assertFalse( openstation_workspace_fence_matches( $allow, 'plugins.php', array() ) );
	}

	/**
	 * @covers ::openstation_workspace_restrict_apps
	 * @covers ::openstation_workspace_is_restricted
	 */
	public function test_hide_settings_refuses_preferences_to_a_pinned_user_only() {
		$share = $this->share( array( 'restricted' => true ) );
		openstation_workspace_share_claim( $share['token'], self::$editor_id );

		wp_set_current_user( self::$editor_id );
		$this->assertTrue( openstation_workspace_is_restricted() );
		$this->assertFalse( openstation_workspace_restrict_apps( true, 'desktop-mode-os-settings' ) );
		$this->assertTrue( openstation_workspace_restrict_apps( true, 'desktop-mode-posts' ) );

		wp_set_current_user( self::$admin_id );
		$this->assertTrue( openstation_workspace_restrict_apps( true, 'desktop-mode-os-settings' ) );
	}

	/**
	 * @covers ::openstation_is_classic_request
	 */
	public function test_a_pinned_user_has_no_classic_escape() {
		$share = $this->share();
		openstation_workspace_share_claim( $share['token'], self::$editor_id );
		wp_set_current_user( self::$editor_id );
		$_GET[ OPENSTATION_CLASSIC_FLAG ] = '1';

		$this->assertFalse( openstation_is_classic_request() );

		$referer = $_SERVER['HTTP_REFERER'] ?? null;
		$_SERVER['HTTP_REFERER'] = add_query_arg( OPENSTATION_CLASSIC_FLAG, '1', admin_url( 'edit.php' ) );
		$this->assertFalse( openstation_is_classic_referer() );
		if ( null === $referer ) {
			unset( $_SERVER['HTTP_REFERER'] );
		} else {
			$_SERVER['HTTP_REFERER'] = $referer;
		}

		unset( $_GET[ OPENSTATION_CLASSIC_FLAG ] );
	}
}
