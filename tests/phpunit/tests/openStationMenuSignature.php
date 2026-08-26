<?php
/**
 * Tests for the admin-menu signature the chromeless bridge ships on
 * every page so the shell can live-refresh the dock when the menu
 * changes off the plugins/themes/update allowlist (GH#325) — e.g. a
 * custom post type registered through a settings tool.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 *
 * @covers ::openstation_menu_signature
 */
class Tests_OpenStation_MenuSignature extends WP_UnitTestCase {

	protected static $admin_id;

	protected $original_menu;
	protected $original_submenu;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		global $menu, $submenu;
		$this->original_menu    = $menu;
		$this->original_submenu = $submenu;
		$menu                   = array();
		$submenu                = array();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		global $menu, $submenu;
		$menu    = $this->original_menu;
		$submenu = $this->original_submenu;
		parent::tear_down();
	}

	/**
	 * Helper: build a $menu row in the canonical 7-element layout used
	 * throughout wp-admin/menu.php.
	 */
	private function make_menu_row( $title, $cap, $slug, $icon = 'dashicons-admin-post' ) {
		return array(
			$title,
			$cap,
			$slug,
			'',
			'',
			'menu-' . sanitize_key( str_replace( array( '.', '?', '=' ), '-', $slug ) ),
			$icon,
		);
	}

	public function test_returns_empty_string_when_menu_is_empty() {
		global $menu;
		$menu = array();
		$this->assertSame( '', openstation_menu_signature() );
	}

	public function test_is_a_stable_md5_for_a_given_menu() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'Dashboard', 'read', 'index.php' ),
			$this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ),
		);

		$first  = openstation_menu_signature();
		$second = openstation_menu_signature();

		$this->assertMatchesRegularExpression( '/^[0-9a-f]{32}$/', $first );
		$this->assertSame( $first, $second, 'Signature must be deterministic for an unchanged menu.' );
	}

	/**
	 * The core GH#325 scenario: a new top-level menu (e.g. a custom post
	 * type registered by a settings tool) must move the signature so the
	 * shell knows to refresh.
	 */
	public function test_changes_when_a_top_level_menu_is_added() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'Dashboard', 'read', 'index.php' ),
		);
		$before = openstation_menu_signature();

		$menu[] = $this->make_menu_row( 'Books', 'edit_posts', 'edit.php?post_type=book', 'dashicons-book-alt' );
		$after  = openstation_menu_signature();

		$this->assertNotSame( $before, $after );
	}

	public function test_changes_when_a_menu_is_removed() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'Dashboard', 'read', 'index.php' ),
			$this->make_menu_row( 'Books', 'edit_posts', 'edit.php?post_type=book' ),
		);
		$before = openstation_menu_signature();

		array_pop( $menu );
		$after = openstation_menu_signature();

		$this->assertNotSame( $before, $after );
	}

	public function test_changes_when_a_title_is_renamed() {
		global $menu;
		$menu   = array( $this->make_menu_row( 'Books', 'edit_posts', 'edit.php?post_type=book' ) );
		$before = openstation_menu_signature();

		$menu[0][0] = 'Publications';
		$after      = openstation_menu_signature();

		$this->assertNotSame( $before, $after );
	}

	/**
	 * Transient update badges (`<span class="update-plugins count-N">`)
	 * ride inside the menu title HTML and fluctuate constantly. They
	 * must NOT move the signature — otherwise the dock would refresh on
	 * every moderation/update-count tick. Mirrors the badge-strip in
	 * openstation_build_dock_items().
	 */
	public function test_ignores_update_badge_count_changes() {
		global $menu;
		$menu = array(
			array(
				'Plugins <span class="update-plugins count-2"><span class="plugin-count">2</span></span>',
				'activate_plugins',
				'plugins.php',
				'',
				'',
				'menu-plugins',
				'dashicons-admin-plugins',
			),
		);
		$two = openstation_menu_signature();

		// Same menu, only the badge count moved 2 -> 5.
		$menu[0][0] = 'Plugins <span class="update-plugins count-5"><span class="plugin-count">5</span></span>';
		$five       = openstation_menu_signature();

		$this->assertSame( $two, $five, 'A changing update badge count must not churn the signature.' );
	}

	public function test_reflects_submenu_additions() {
		global $menu, $submenu;
		$menu                = array( $this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ) );
		$submenu['edit.php'] = array(
			array( 'All Posts', 'edit_posts', 'edit.php' ),
		);
		$before = openstation_menu_signature();

		$submenu['edit.php'][] = array( 'Add New', 'edit_posts', 'post-new.php' );
		$after                 = openstation_menu_signature();

		$this->assertNotSame( $before, $after, 'A new submenu entry must move the signature.' );
	}

	/**
	 * The signature is computed against the *current user's*
	 * capability-passing view — the same gate the dock uses. A menu the
	 * viewer can't see must neither appear in nor churn the signature,
	 * so activation of an admin-only tool never triggers a wasted
	 * refresh for a lower-privileged user.
	 */
	public function test_respects_capability_gating() {
		global $menu;
		$subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber_id );

		$menu   = array( $this->make_menu_row( 'Dashboard', 'read', 'index.php' ) );
		$before = openstation_menu_signature();

		// Add a menu the subscriber cannot access.
		$menu[] = $this->make_menu_row( 'Settings', 'manage_options', 'options-general.php' );
		$after  = openstation_menu_signature();

		$this->assertSame( $before, $after, 'An item the viewer lacks the cap for must not move their signature.' );
	}

	/**
	 * Separator rows carry no slug/title the dock renders; they must be
	 * skipped so a Core reshuffle of separators doesn't churn the hash.
	 */
	public function test_ignores_separators() {
		global $menu;
		$menu = array(
			$this->make_menu_row( 'Dashboard', 'read', 'index.php' ),
			array( '', 'read', 'separator1', '', 'wp-menu-separator' ),
			$this->make_menu_row( 'Posts', 'edit_posts', 'edit.php' ),
		);
		$with_separator = openstation_menu_signature();

		unset( $menu[1] );
		$menu           = array_values( $menu );
		$without        = openstation_menu_signature();

		$this->assertSame( $with_separator, $without );
	}
}
