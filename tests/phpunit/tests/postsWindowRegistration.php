<?php
/**
 * Tests for the native Posts window's PHP registration + permission
 * gate.
 *
 * The two-condition gate (`edit_posts` AND opt-in) is the only thing
 * keeping the iframe path safe as the default for users who haven't
 * opted in. A regression that flips either half wide-open ships a
 * confusing UX (admins who never visited OS Settings suddenly
 * landing in a different Posts experience) — these tests catch
 * exactly that.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-posts-window
 */
class Tests_DesktopMode_PostsWindowRegistration extends WP_UnitTestCase {

	private $admin_id;
	private $editor_id;
	private $subscriber_id;

	public function set_up() {
		parent::set_up();

		$this->admin_id      = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->editor_id     = self::factory()->user->create( array( 'role' => 'editor' ) );
		$this->subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
	}

	public function tear_down() {
		// Make sure no test leaks an opt-in state into the next.
		remove_all_filters( 'desktop_mode_posts_window_user_can_use' );
		remove_all_filters( 'desktop_mode_posts_window_user_can_register' );
		parent::tear_down();
	}

	// ----------------------------------------------------------------
	// `_user_can_register` — cap-only gate. Decoupled from the opt-in
	// so flipping the OS-settings toggle takes effect mid-session
	// without forcing an F5. The boot-time PHP registration runs once
	// per page load — gating it on the opt-in would mean a user who
	// turned the setting on AFTER load wouldn't get the native window
	// for the rest of the session.
	// ----------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_posts_window_user_can_register
	 */
	public function test_register_gate_open_for_admin_without_opt_in() {
		wp_set_current_user( $this->admin_id );
		// No opt-in — registration should still be allowed so the
		// native window is reachable the moment the user toggles
		// the setting on (no F5).
		$this->assertTrue( desktop_mode_posts_window_user_can_register() );
	}

	/**
	 * @covers ::desktop_mode_posts_window_user_can_register
	 */
	public function test_register_gate_open_for_editor_without_opt_in() {
		wp_set_current_user( $this->editor_id );
		$this->assertTrue( desktop_mode_posts_window_user_can_register() );
	}

	/**
	 * @covers ::desktop_mode_posts_window_user_can_register
	 */
	public function test_register_gate_closed_for_subscriber() {
		wp_set_current_user( $this->subscriber_id );
		$this->assertFalse( desktop_mode_posts_window_user_can_register() );
	}

	/**
	 * @covers ::desktop_mode_posts_window_user_can_register
	 */
	public function test_register_gate_closed_for_logged_out_user() {
		wp_set_current_user( 0 );
		$this->assertFalse( desktop_mode_posts_window_user_can_register() );
	}

	/**
	 * @covers ::desktop_mode_posts_window_user_can_register
	 */
	public function test_register_filter_can_block_a_capable_user() {
		wp_set_current_user( $this->admin_id );
		add_filter( 'desktop_mode_posts_window_user_can_register', '__return_false' );
		$this->assertFalse( desktop_mode_posts_window_user_can_register() );
	}

	// ----------------------------------------------------------------
	// `_user_can_use` — combined cap + opt-in. Kept for callers that
	// want the "is this user actually using the native experience?"
	// answer (analytics, arrange-menu entries, etc).
	// ----------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_posts_window_user_can_use
	 */
	public function test_gate_closed_by_default_for_admins() {
		wp_set_current_user( $this->admin_id );
		// Admin has the cap but has not opted in — gate should be closed.
		$this->assertFalse( desktop_mode_posts_window_user_can_use() );
	}

	/**
	 * @covers ::desktop_mode_posts_window_user_can_use
	 */
	public function test_gate_open_when_admin_opts_in() {
		wp_set_current_user( $this->admin_id );
		desktop_mode_save_os_settings(
			$this->admin_id,
			array( 'nativePostsEnabled' => true )
		);
		$this->assertTrue( desktop_mode_posts_window_user_can_use() );
	}

	/**
	 * Editors have `edit_posts` — opting in should let them through.
	 *
	 * @covers ::desktop_mode_posts_window_user_can_use
	 */
	public function test_gate_open_for_opted_in_editor() {
		wp_set_current_user( $this->editor_id );
		desktop_mode_save_os_settings(
			$this->editor_id,
			array( 'nativePostsEnabled' => true )
		);
		$this->assertTrue( desktop_mode_posts_window_user_can_use() );
	}

	/**
	 * @covers ::desktop_mode_posts_window_user_can_use
	 */
	public function test_gate_closed_for_subscriber_even_when_opted_in() {
		wp_set_current_user( $this->subscriber_id );
		desktop_mode_save_os_settings(
			$this->subscriber_id,
			array( 'nativePostsEnabled' => true )
		);
		$this->assertFalse(
			desktop_mode_posts_window_user_can_use(),
			'Subscriber lacks `edit_posts`; the opt-in toggle alone must not unlock the window.'
		);
	}

	/**
	 * @covers ::desktop_mode_posts_window_user_can_use
	 */
	public function test_gate_closed_for_logged_out_user() {
		wp_set_current_user( 0 );
		$this->assertFalse( desktop_mode_posts_window_user_can_use() );
	}

	/**
	 * Filter must be respected so a managed install (or an integration
	 * test) can force the window on without forcing every user to flip
	 * the OS Settings toggle.
	 *
	 * @covers ::desktop_mode_posts_window_user_can_use
	 */
	public function test_filter_can_force_gate_open() {
		wp_set_current_user( $this->editor_id );
		// No opt-in set — default would be closed.
		$this->assertFalse( desktop_mode_posts_window_user_can_use() );

		add_filter( 'desktop_mode_posts_window_user_can_use', '__return_true' );
		$this->assertTrue( desktop_mode_posts_window_user_can_use() );
	}

	/**
	 * @covers ::desktop_mode_posts_window_user_can_use
	 */
	public function test_filter_can_force_gate_closed() {
		wp_set_current_user( $this->admin_id );
		desktop_mode_save_os_settings(
			$this->admin_id,
			array( 'nativePostsEnabled' => true )
		);
		add_filter( 'desktop_mode_posts_window_user_can_use', '__return_false' );
		$this->assertFalse( desktop_mode_posts_window_user_can_use() );
	}

	/**
	 * The `$user_id` arg lets callers ask the gate question for a
	 * specific user (e.g. the REST permission callback running in a
	 * sub-request context where `get_current_user_id()` is unreliable).
	 *
	 * @covers ::desktop_mode_posts_window_user_can_use
	 */
	public function test_explicit_user_id_argument_is_honoured() {
		desktop_mode_save_os_settings(
			$this->editor_id,
			array( 'nativePostsEnabled' => true )
		);
		// Logged in as the subscriber; ask about the editor.
		wp_set_current_user( $this->subscriber_id );
		$this->assertTrue(
			desktop_mode_posts_window_user_can_use( $this->editor_id )
		);
	}

	/**
	 * The `desktop_mode_posts_window_query_args` filter is the upgrade
	 * path for v1.1 CPT support — a plugin overrides `post_type` here
	 * and the bundle picks it up without further changes.
	 *
	 * @covers ::desktop_mode_posts_window_default_query_args
	 */
	public function test_query_args_filter_is_applied() {
		add_filter(
			'desktop_mode_posts_window_query_args',
			static function ( $args ) {
				$args['post_type'] = 'product';
				return $args;
			}
		);

		$args = desktop_mode_posts_window_default_query_args();
		$this->assertSame( 'product', $args['post_type'] );
		// Default args must still flow through.
		$this->assertArrayHasKey( '_embed', $args );
		$this->assertArrayHasKey( '_fields', $args );
	}

	/**
	 * Default query args must include `_embed` (powers author / term /
	 * featured-media columns) and `_fields` (keeps payload tight).
	 *
	 * @covers ::desktop_mode_posts_window_default_query_args
	 */
	public function test_default_query_args_include_embed_and_fields() {
		$args = desktop_mode_posts_window_default_query_args();
		$this->assertStringContainsString( 'author', $args['_embed'] );
		$this->assertStringContainsString( 'wp:term', $args['_embed'] );
		$this->assertStringContainsString( 'wp:featuredmedia', $args['_embed'] );
		$this->assertStringContainsString( 'title', $args['_fields'] );
		$this->assertStringContainsString( 'status', $args['_fields'] );
		$this->assertStringContainsString( 'date', $args['_fields'] );
	}
}
