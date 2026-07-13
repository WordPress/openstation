<?php
/**
 * Tests for the window content-relations server surface —
 * `desktop_mode_build_content_identity()` and its filter.
 *
 * The builder runs in the chromeless iframe's admin_footer (real
 * admin context) and resolves which object the page shows, including
 * the parent post a comment / attachment belongs to. These tests
 * fake the relevant screen state the same way Core's own screen
 * tests do: `set_current_screen()` + the `pagenow` / `post` globals.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 */
class Tests_DesktopMode_WindowLinks extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
		desktop_mode_flush_script_handle_registries();
	}

	public function tear_down() {
		unset( $_GET['c'], $GLOBALS['pagenow'], $GLOBALS['post'] );
		remove_all_filters( 'desktop_mode_window_content_identity' );
		parent::tear_down();
	}

	/**
	 * Point the builder's screen detection at a post.php edit request
	 * for the given post.
	 *
	 * @param WP_Post $post Post being "edited".
	 */
	private function fake_post_edit_screen( $post ) {
		$GLOBALS['pagenow'] = 'post.php';
		$GLOBALS['post']    = $post;
		set_current_screen( 'post' );
	}

	/**
	 * @covers ::desktop_mode_build_content_identity
	 */
	public function test_post_edit_screen_yields_root_identity() {
		$post_id = self::factory()->post->create(
			array(
				'post_title' => 'Hello Desktop',
			)
		);
		$this->fake_post_edit_screen( get_post( $post_id ) );

		$identity = desktop_mode_build_content_identity();

		$this->assertSame( 'post', $identity['type'] );
		$this->assertSame( $post_id, $identity['id'] );
		$this->assertSame( 'Hello Desktop', $identity['label'] );
		$this->assertArrayNotHasKey( 'root', $identity, 'A post edit screen IS a root — no root key expected.' );
	}

	/**
	 * @covers ::desktop_mode_build_content_identity
	 */
	public function test_page_edit_screen_uses_the_post_type_as_type() {
		$page_id = self::factory()->post->create( array( 'post_type' => 'page' ) );
		$this->fake_post_edit_screen( get_post( $page_id ) );

		$identity = desktop_mode_build_content_identity();

		$this->assertSame( 'page', $identity['type'] );
		$this->assertSame( $page_id, $identity['id'] );
	}

	/**
	 * @covers ::desktop_mode_build_content_identity
	 */
	public function test_comment_edit_screen_roots_at_the_parent_post() {
		$post_id    = self::factory()->post->create();
		$comment_id = self::factory()->comment->create(
			array(
				'comment_post_ID' => $post_id,
				'comment_content' => 'Nice post! I especially liked the part about splines.',
			)
		);

		$GLOBALS['pagenow'] = 'comment.php';
		$_GET['c']          = (string) $comment_id;
		set_current_screen( 'comment' );

		$identity = desktop_mode_build_content_identity();

		$this->assertSame( 'comment', $identity['type'] );
		$this->assertSame( $comment_id, $identity['id'] );
		$this->assertSame(
			array(
				'type' => 'post',
				'id'   => $post_id,
			),
			$identity['root'],
			'The comment must resolve its parent post server-side — the URL alone cannot.'
		);
		$this->assertNotSame( '', $identity['label'] );
	}

	/**
	 * @covers ::desktop_mode_build_content_identity
	 */
	public function test_comment_screen_with_missing_comment_yields_null() {
		$GLOBALS['pagenow'] = 'comment.php';
		$_GET['c']          = '999999';
		set_current_screen( 'comment' );

		$this->assertNull( desktop_mode_build_content_identity() );
	}

	/**
	 * @covers ::desktop_mode_build_content_identity
	 */
	public function test_attached_media_roots_at_its_parent() {
		$post_id       = self::factory()->post->create();
		$attachment_id = self::factory()->attachment->create_object(
			'image.jpg',
			$post_id,
			array(
				'post_mime_type' => 'image/jpeg',
				'post_title'     => 'A Photo',
			)
		);
		$this->fake_post_edit_screen( get_post( $attachment_id ) );

		$identity = desktop_mode_build_content_identity();

		$this->assertSame( 'media', $identity['type'] );
		$this->assertSame( $attachment_id, $identity['id'] );
		$this->assertSame(
			array(
				'type' => 'post',
				'id'   => $post_id,
			),
			$identity['root']
		);
	}

	/**
	 * @covers ::desktop_mode_build_content_identity
	 */
	public function test_unattached_media_is_its_own_root() {
		$attachment_id = self::factory()->attachment->create_object(
			'lonely.jpg',
			0,
			array( 'post_mime_type' => 'image/jpeg' )
		);
		$this->fake_post_edit_screen( get_post( $attachment_id ) );

		$identity = desktop_mode_build_content_identity();

		$this->assertSame( 'media', $identity['type'] );
		$this->assertArrayNotHasKey( 'root', $identity );
	}

	/**
	 * @covers ::desktop_mode_build_content_identity
	 */
	public function test_add_new_screen_yields_null() {
		$post_id = self::factory()->post->create();
		$this->fake_post_edit_screen( get_post( $post_id ) );
		get_current_screen()->action = 'add';

		$this->assertNull(
			desktop_mode_build_content_identity(),
			'post-new.php has no committed identity yet — deferred until the first save.'
		);
	}

	/**
	 * @covers ::desktop_mode_build_content_identity
	 */
	public function test_unrelated_screen_yields_null() {
		set_current_screen( 'dashboard' );

		$this->assertNull( desktop_mode_build_content_identity() );
	}

	/**
	 * @covers ::desktop_mode_build_content_identity
	 */
	public function test_filter_can_add_an_identity_for_a_custom_screen() {
		set_current_screen( 'dashboard' );

		add_filter(
			'desktop_mode_window_content_identity',
			function ( $identity, $screen ) {
				$this->assertInstanceOf( 'WP_Screen', $screen );
				return array(
					'type' => 'acme/order',
					'id'   => 77,
					'root' => array(
						'type' => 'acme/customer',
						'id'   => 12,
					),
				);
			},
			10,
			2
		);

		$identity = desktop_mode_build_content_identity();

		$this->assertSame( 'acme/order', $identity['type'] );
		$this->assertSame( 77, $identity['id'] );
	}

	/**
	 * @covers ::desktop_mode_build_content_identity
	 */
	public function test_filter_can_suppress_the_builtin_identity() {
		$post_id = self::factory()->post->create();
		$this->fake_post_edit_screen( get_post( $post_id ) );

		add_filter( 'desktop_mode_window_content_identity', '__return_null' );

		$this->assertNull( desktop_mode_build_content_identity() );
	}

	/**
	 * The chromeless bridge must always substitute the identity
	 * placeholder — `null` included — so a navigation away from an
	 * identified screen clears stale state in the shell.
	 *
	 * @covers ::desktop_mode_chromeless_bridge_script
	 */
	public function test_bridge_script_substitutes_the_identity_placeholder() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless'] = '1';

		$post_id = self::factory()->post->create( array( 'post_title' => 'Bridged' ) );
		$this->fake_post_edit_screen( get_post( $post_id ) );

		ob_start();
		desktop_mode_chromeless_bridge_script();
		$output = ob_get_clean();

		unset( $_GET['desktop_mode_chromeless'] );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );

		$this->assertStringNotContainsString( '/*__DESKTOP_MODE_CONTENT_IDENTITY__*/', $output );
		$this->assertStringContainsString( 'desktop-mode-content-identity', $output );
		$this->assertStringContainsString( '"type":"post"', $output );
		$this->assertStringContainsString( '"id":' . $post_id, $output );
	}

	/**
	 * A post whose content hyperlinks another post carries that target
	 * in `links` — the source of the directed reference arrows between
	 * open post windows.
	 *
	 * @covers ::desktop_mode_build_content_identity
	 * @covers ::desktop_mode_window_links_extract_references
	 */
	public function test_post_identity_includes_internal_link_references() {
		$target_id = self::factory()->post->create( array( 'post_title' => 'Target' ) );
		$source_id = self::factory()->post->create(
			array(
				'post_content' => 'See <a href="' . get_permalink( $target_id ) . '">the other post</a> and <a href="https://external.example/">elsewhere</a>.',
			)
		);
		$this->fake_post_edit_screen( get_post( $source_id ) );

		$identity = desktop_mode_build_content_identity();

		$this->assertSame(
			array(
				array(
					'type' => 'post',
					'id'   => $target_id,
				),
			),
			$identity['links']
		);
	}

	/**
	 * @covers ::desktop_mode_window_links_extract_references
	 */
	public function test_reference_extraction_skips_self_links() {
		$post_id = self::factory()->post->create();
		$post    = get_post( $post_id );
		// Self-link only — nothing to reference.
		$post->post_content = '<a href="' . get_permalink( $post_id ) . '">me</a>';

		$this->assertSame( array(), desktop_mode_window_links_extract_references( $post ) );
	}

	// ────────────────────────────────────────────────────────────────
	// Renderer-script registration — the PHP opt-in that puts a
	// plugin's JS handle into the live-refresh payload. Mirrors
	// tests/phpunit/tests/unfocusEffects.php, different registry.
	// ────────────────────────────────────────────────────────────────

	/**
	 * @covers ::desktop_mode_register_window_link_renderer_script
	 */
	public function test_renderer_script_stores_handle() {
		$handle = 'wl-a-' . substr( md5( uniqid() ), 0, 8 );
		$ok     = desktop_mode_register_window_link_renderer_script( $handle );
		$this->assertTrue( $ok );
		$this->assertTrue( desktop_mode_window_link_renderer_script_registry( $handle ) );
	}

	/**
	 * @covers ::desktop_mode_register_window_link_renderer_script
	 */
	public function test_renderer_script_rejects_empty_handle() {
		$r = desktop_mode_register_window_link_renderer_script( '' );
		$this->assertInstanceOf( 'WP_Error', $r );
		$this->assertSame( 'desktop_mode_missing_handle', $r->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_build_window_link_renderer_scripts_payload
	 */
	public function test_renderer_script_payload_resolves_registered_handle() {
		$handle = 'wl-b-' . substr( md5( uniqid() ), 0, 8 );
		wp_register_script( $handle, 'https://example.test/links.js', array(), '1.0', true );
		desktop_mode_register_window_link_renderer_script( $handle );

		$payload = desktop_mode_build_window_link_renderer_scripts_payload();
		$entry   = null;
		foreach ( $payload as $p ) {
			if ( $p['handle'] === $handle ) {
				$entry = $p;
				break;
			}
		}
		$this->assertNotNull( $entry );
		$this->assertStringContainsString( 'links.js', $entry['scriptUrl'] );
	}

	/**
	 * @covers ::desktop_mode_build_window_link_renderer_scripts_payload
	 */
	public function test_renderer_script_payload_omits_unresolvable_handles() {
		$this->setExpectedIncorrectUsage( 'desktop_mode_register_window_link_renderer_script' );

		$handle = 'wl-c-' . substr( md5( uniqid() ), 0, 8 );
		desktop_mode_register_window_link_renderer_script( $handle );
		$payload = desktop_mode_build_window_link_renderer_scripts_payload();
		foreach ( $payload as $entry ) {
			$this->assertNotSame( $handle, $entry['handle'] );
		}
	}

	/**
	 * @covers ::desktop_mode_register_window_link_renderer_script
	 */
	public function test_renderer_script_registered_action_fires() {
		$captured = array();
		add_action( 'desktop_mode_window_link_renderer_script_registered', function ( $h ) use ( &$captured ) {
			$captured[] = $h;
		} );
		$h = 'wl-d-' . substr( md5( uniqid() ), 0, 8 );
		desktop_mode_register_window_link_renderer_script( $h );
		$this->assertContains( $h, $captured );
	}

	/**
	 * The menu payload advertises the script array so the shell's
	 * live-refresh applier can lazy-load plugin renderer scripts.
	 *
	 * @covers ::desktop_mode_build_menu_payload
	 */
	public function test_menu_payload_includes_window_link_renderer_scripts_key() {
		$payload = desktop_mode_build_menu_payload();
		$this->assertArrayHasKey( 'serverWindowLinkRendererScripts', $payload );
		$this->assertIsArray( $payload['serverWindowLinkRendererScripts'] );
	}
}
