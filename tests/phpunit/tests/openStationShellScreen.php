<?php
/**
 * Tests for the shell screen — the admin page the desktop boots from.
 *
 * Covers the screen's registration and identity, the one "this request
 * paints the shell" predicate, how the screen resolves the page it opens
 * first, the operator dequeue filter, and the reason the screen exists:
 * a script another admin screen enqueues never reaches the shell.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-shell-screen
 */
class Tests_OpenStation_ShellScreen extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
	}

	public function tear_down() {
		unset(
			$_GET[ OPENSTATION_SHELL_TARGET_ARG ],
			$_GET[ OPENSTATION_SHELL_INTENT_ARG ],
			$_GET['openstation_chromeless'],
			$_GET[ OPENSTATION_CLASSIC_FLAG ],
			$_GET[ OPENSTATION_SOLO_FLAG ],
			$_GET['page'],
			$GLOBALS['plugin_page'],
			$GLOBALS['current_screen']
		);
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		delete_user_meta( self::$admin_id, OPENSTATION_SESSION_META_KEY );
		delete_user_meta( self::$admin_id, OPENSTATION_DEFAULT_WINDOW_META );
		delete_user_meta( self::$subscriber_id, 'desktop_mode_mode' );
		remove_all_filters( 'openstation_shell_dequeue_handles' );
		foreach ( array( 'acme-dashboard-loader', 'acme-editor', 'acme-nag', 'acme-nag-core', 'acme-keep', 'acme-nag-style' ) as $handle ) {
			wp_dequeue_script( $handle );
			wp_deregister_script( $handle );
			wp_dequeue_style( $handle );
			wp_deregister_style( $handle );
		}
		wp_dequeue_script( 'openstation' );
		parent::tear_down();
	}

	/* ---------------------------------------------------------------
	 * URL helpers.
	 * ------------------------------------------------------------ */

	/**
	 * @covers ::openstation_shell_url
	 */
	public function test_shell_url_is_the_hidden_admin_page() {
		$this->assertSame( admin_url( 'admin.php?page=openstation' ), openstation_shell_url() );
	}

	/**
	 * @covers ::openstation_shell_url
	 */
	public function test_shell_url_carries_target_as_path_and_query_only() {
		$url = openstation_shell_url( admin_url( 'edit.php?post_type=page' ), true );

		$this->assertStringStartsWith( admin_url( 'admin.php?page=openstation' ), $url );
		$this->assertStringContainsString( 'target=' . rawurlencode( '/wp-admin/edit.php?post_type=page' ), $url );
		$this->assertStringContainsString( 'intent=1', $url );
		$this->assertStringNotContainsString( rawurlencode( home_url() ), $url );
	}

	/**
	 * @covers ::openstation_shell_url
	 */
	public function test_shell_url_omits_intent_without_a_target() {
		$this->assertStringNotContainsString( 'intent=', openstation_shell_url( '', true ) );
	}

	/**
	 * @covers ::openstation_url_is_shell_screen
	 */
	public function test_url_is_shell_screen_recognises_the_page() {
		$this->assertTrue( openstation_url_is_shell_screen( openstation_shell_url() ) );
		$this->assertTrue( openstation_url_is_shell_screen( '/wp-admin/admin.php?page=openstation&target=x' ) );
		$this->assertFalse( openstation_url_is_shell_screen( admin_url( 'admin.php?page=openstation-settings' ) ) );
		$this->assertFalse( openstation_url_is_shell_screen( admin_url( 'edit.php?page=openstation' ) ) );
		$this->assertFalse( openstation_url_is_shell_screen( admin_url( 'admin.php' ) ) );
		$this->assertFalse( openstation_url_is_shell_screen( '' ) );
	}

	/* ---------------------------------------------------------------
	 * Registration and identity.
	 * ------------------------------------------------------------ */

	/**
	 * The page is registered under an empty parent, so it is routable
	 * and appears in no menu.
	 *
	 * @covers ::openstation_register_shell_screen
	 */
	public function test_screen_is_registered_and_hidden() {
		global $submenu, $menu, $_registered_pages;
		$menu_backup    = $menu;
		$submenu_backup = $submenu;
		$menu           = array();
		$submenu        = array();

		try {
			openstation_register_shell_screen();

			$this->assertArrayHasKey( '', $submenu );
			$this->assertSame( OPENSTATION_SHELL_PAGE_SLUG, $submenu[''][0][2] );
			$this->assertSame( 'read', $submenu[''][0][1] );
			$this->assertArrayHasKey( OPENSTATION_SHELL_SCREEN_ID, $_registered_pages );
			$this->assertTrue( has_action( OPENSTATION_SHELL_SCREEN_ID, 'openstation_render_shell_screen' ) !== false );
			// Nothing a menu walker would paint.
			$this->assertSame( array(), $menu );
		} finally {
			$menu    = $menu_backup;
			$submenu = $submenu_backup;
			remove_action( OPENSTATION_SHELL_SCREEN_ID, 'openstation_render_shell_screen' );
		}
	}

	/**
	 * A Subscriber can enter the desktop, so a Subscriber can reach its
	 * screen: `read` is the same floor the portal applies.
	 *
	 * @covers ::openstation_register_shell_screen
	 */
	public function test_screen_registers_for_a_subscriber() {
		global $submenu, $_wp_submenu_nopriv;
		wp_set_current_user( self::$subscriber_id );
		$submenu_backup = $submenu;
		$submenu        = array();

		try {
			openstation_register_shell_screen();

			$this->assertArrayHasKey( '', $submenu );
			$this->assertTrue( empty( $_wp_submenu_nopriv[''][ OPENSTATION_SHELL_PAGE_SLUG ] ) );
		} finally {
			$submenu = $submenu_backup;
			remove_action( OPENSTATION_SHELL_SCREEN_ID, 'openstation_render_shell_screen' );
		}
	}

	/**
	 * @covers ::openstation_is_shell_screen_request
	 */
	public function test_screen_request_is_detected_from_the_current_screen() {
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		$this->assertTrue( openstation_is_shell_screen_request() );
		$this->assertSame( OPENSTATION_SHELL_SCREEN_ID, get_current_screen()->id );

		set_current_screen( 'dashboard' );
		$this->assertFalse( openstation_is_shell_screen_request() );
	}

	/* ---------------------------------------------------------------
	 * The shell predicate.
	 *
	 * The pre-screen branch of the screen predicate (`$plugin_page` on
	 * `admin_init`) is not reachable here: `is_admin()` is false in
	 * this bootstrap until a screen exists. Every real boot exercises
	 * it — the admin_init redirect must recognise the screen it lands
	 * on, or loop.
	 * ------------------------------------------------------------ */

	/**
	 * @covers ::openstation_is_shell_request
	 */
	public function test_shell_request_is_true_on_the_screen_for_an_enabled_user() {
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		$this->assertTrue( openstation_is_shell_request() );
	}

	/**
	 * The shell no longer rides on other screens.
	 *
	 * @covers ::openstation_is_shell_request
	 */
	public function test_shell_request_is_false_on_the_dashboard() {
		set_current_screen( 'dashboard' );
		$this->assertFalse( openstation_is_shell_request() );
	}

	/**
	 * @covers ::openstation_is_shell_request
	 */
	public function test_shell_request_is_false_for_a_disabled_user() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		$this->assertFalse( openstation_is_shell_request() );
	}

	/**
	 * @covers ::openstation_is_shell_request
	 */
	public function test_shell_request_is_false_inside_a_window_and_on_a_classic_request() {
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );

		$_GET['openstation_chromeless'] = '1';
		$this->assertFalse( openstation_is_shell_request() );
		unset( $_GET['openstation_chromeless'] );

		$_GET[ OPENSTATION_CLASSIC_FLAG ] = '1';
		$this->assertFalse( openstation_is_shell_request() );
	}

	/**
	 * A solo boot renders one window in place, wherever it landed.
	 *
	 * @covers ::openstation_is_shell_request
	 */
	public function test_shell_request_is_true_for_a_solo_boot_off_the_screen() {
		set_current_screen( 'dashboard' );
		$_GET[ OPENSTATION_SOLO_FLAG ] = 'os-files';
		$this->assertTrue( openstation_is_shell_request() );
	}

	/**
	 * The markup, the body class and the assets all read the predicate.
	 *
	 * @covers ::openstation_render_shell
	 * @covers ::openstation_admin_body_classes
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_shell_paints_only_on_the_screen() {
		set_current_screen( 'dashboard' );
		ob_start();
		openstation_render_shell();
		$this->assertSame( '', ob_get_clean() );
		$this->assertStringNotContainsString( 'os-active', openstation_admin_body_classes( '' ) );
		openstation_enqueue_assets();
		$this->assertFalse( wp_script_is( 'openstation', 'enqueued' ) );

		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		ob_start();
		openstation_render_shell();
		$this->assertStringContainsString( 'id="os-shell"', ob_get_clean() );
		$this->assertStringContainsString( 'os-active', openstation_admin_body_classes( '' ) );
		openstation_enqueue_assets();
		$this->assertTrue( wp_script_is( 'openstation', 'enqueued' ) );
	}

	/**
	 * The page callback stays silent under the shell and speaks only
	 * when the screen is reached without it.
	 *
	 * @covers ::openstation_render_shell_screen
	 */
	public function test_page_callback_prints_nothing_under_the_shell_and_a_way_in_without_it() {
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		ob_start();
		openstation_render_shell_screen();
		$this->assertSame( '', ob_get_clean() );

		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		ob_start();
		openstation_render_shell_screen();
		$out = ob_get_clean();
		$this->assertStringContainsString( esc_url( openstation_portal_url() ), $out );
	}

	/**
	 * The screen names itself before `admin-header.php` reads the name.
	 *
	 * A null `$title` there is `strip_tags( null )`, which prints a
	 * deprecation ahead of `<!DOCTYPE html>` and drops the whole shell
	 * into quirks mode — where `<table>` stops inheriting `color` and
	 * every `<os-table>` in a native window falls back to core's
	 * `body { color: #3c434a }`. The name is also what puts "OpenStation"
	 * before the chevron in the document title.
	 *
	 * @covers ::openstation_shell_screen_set_title
	 */
	public function test_screen_sets_a_title_for_admin_header() {
		$GLOBALS['title'] = null;
		openstation_shell_screen_set_title();

		$this->assertIsString( $GLOBALS['title'] );
		$this->assertSame( 'OpenStation', $GLOBALS['title'] );

		// `get_admin_page_title()` returns early on a non-empty title,
		// so core never walks the menus it cannot find this page in.
		$this->assertSame( 'OpenStation', get_admin_page_title() );

		unset( $GLOBALS['title'] );
	}

	/**
	 * …and it is wired to the hook that fires before the header runs.
	 *
	 * `load-{$hook}` is the only point between `add_submenu_page()` and
	 * `require admin-header.php`; setting the title anywhere later is
	 * too late to stop the notice.
	 *
	 * @covers ::openstation_register_shell_screen
	 */
	public function test_screen_registration_wires_the_title_to_its_load_hook() {
		remove_action(
			'load-' . OPENSTATION_SHELL_SCREEN_ID,
			'openstation_shell_screen_set_title'
		);

		openstation_register_shell_screen();

		$this->assertNotFalse(
			has_action(
				'load-' . OPENSTATION_SHELL_SCREEN_ID,
				'openstation_shell_screen_set_title'
			)
		);
	}

	/* ---------------------------------------------------------------
	 * What the shell boots with.
	 * ------------------------------------------------------------ */

	/**
	 * @covers ::openstation_shell_boot_target
	 */
	public function test_boot_target_reads_an_explicit_target_with_intent() {
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		$_GET[ OPENSTATION_SHELL_TARGET_ARG ] = '/wp-admin/edit.php?post_type=page';
		$_GET[ OPENSTATION_SHELL_INTENT_ARG ] = '1';

		$boot = openstation_shell_boot_target();

		$this->assertSame( admin_url( 'edit.php?post_type=page' ), $boot['url'] );
		$this->assertTrue( $boot['fromPortal'] );
		$this->assertTrue( $boot['fromPortalIntent'] );
	}

	/**
	 * An invalid target falls back to the entry resolver, and the
	 * intent arg does not survive the fallback: the page is then the
	 * screen's pick, not the user's.
	 *
	 * @covers ::openstation_shell_boot_target
	 */
	public function test_boot_target_falls_back_on_an_invalid_target_and_drops_intent() {
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		$_GET[ OPENSTATION_SHELL_TARGET_ARG ] = 'https://evil.example/wp-admin/edit.php';
		$_GET[ OPENSTATION_SHELL_INTENT_ARG ] = '1';

		$boot = openstation_shell_boot_target();

		$this->assertSame( admin_url( 'index.php' ), $boot['url'] );
		$this->assertTrue( $boot['fromPortal'] );
		$this->assertFalse( $boot['fromPortalIntent'] );
	}

	/**
	 * The shell must never open itself.
	 *
	 * @covers ::openstation_shell_boot_target
	 * @covers ::openstation_sanitize_portal_target
	 */
	public function test_boot_target_refuses_the_shell_screen_as_a_target() {
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		$_GET[ OPENSTATION_SHELL_TARGET_ARG ] = '/wp-admin/admin.php?page=openstation&target=x';
		$_GET[ OPENSTATION_SHELL_INTENT_ARG ] = '1';

		$this->assertSame( '', openstation_sanitize_portal_target( '/wp-admin/admin.php?page=openstation' ) );

		$boot = openstation_shell_boot_target();
		$this->assertSame( admin_url( 'index.php' ), $boot['url'] );
		$this->assertFalse( $boot['fromPortalIntent'] );
	}

	/**
	 * Without a target the screen resolves the entry as the portal did:
	 * the session's focused window first.
	 *
	 * @covers ::openstation_shell_boot_target
	 */
	public function test_boot_target_without_a_target_is_the_focused_session_window() {
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		openstation_save_session(
			self::$admin_id,
			array(
				'windows' => array(
					array(
						'id'     => 'wp-window-edit-php-page',
						'url'    => admin_url( 'edit.php?post_type=page&openstation_chromeless=1' ),
						'title'  => 'Pages',
						'icon'   => 'dashicons-admin-page',
						'state'  => 'normal',
						'x'      => 0,
						'y'      => 0,
						'width'  => 800,
						'height' => 600,
					),
				),
				'focused' => 'wp-window-edit-php-page',
			)
		);

		$boot = openstation_shell_boot_target();

		$this->assertSame( admin_url( 'edit.php?post_type=page' ), $boot['url'] );
		$this->assertTrue( $boot['fromPortal'] );
		$this->assertFalse( $boot['fromPortalIntent'] );
	}

	/**
	 * A focused window that somehow points at the screen is treated as
	 * nothing focused.
	 *
	 * @covers ::openstation_portal_entry_url
	 */
	public function test_entry_url_refuses_a_focused_window_on_the_shell_screen() {
		openstation_save_session(
			self::$admin_id,
			array(
				'windows' => array(
					array(
						'id'     => 'wp-window-admin-php-openstation',
						'url'    => openstation_shell_url(),
						'title'  => 'Loop',
						'icon'   => 'dashicons-admin-generic',
						'state'  => 'normal',
						'x'      => 0,
						'y'      => 0,
						'width'  => 800,
						'height' => 600,
					),
				),
				'focused' => 'wp-window-admin-php-openstation',
			)
		);

		$this->assertSame( admin_url( 'index.php' ), openstation_portal_entry_url( self::$admin_id ) );
	}

	/**
	 * A `native:` default window is not a URL; the page is the Dashboard
	 * file (never the bare directory, so the window id matches the
	 * dock's) and the shell opens the native window itself.
	 *
	 * @covers ::openstation_shell_boot_target
	 */
	public function test_boot_target_for_a_native_default_window_is_the_dashboard_file() {
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		$this->assertTrue( openstation_set_default_window( self::$admin_id, 'native:os-settings' ) );

		$boot = openstation_shell_boot_target();

		$this->assertSame( admin_url( 'index.php' ), $boot['url'] );
		$this->assertFalse( $boot['fromPortalIntent'] );
	}

	/**
	 * The entry window is named after the dock entry for its page,
	 * not after the screen.
	 *
	 * @covers ::openstation_shell_boot_target_meta
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_boot_meta_and_config_take_title_and_icon_from_the_dock() {
		$dock = array(
			array(
				'id'      => 'edit-php',
				'title'   => 'Posts',
				'icon'    => 'dashicons-admin-post',
				'url'     => admin_url( 'edit.php' ),
				'submenu' => array(
					array(
						'title' => 'Categories',
						'url'   => admin_url( 'edit-tags.php?taxonomy=category' ),
					),
				),
			),
		);

		$this->assertSame(
			array(
				'title' => 'Posts',
				'icon'  => 'dashicons-admin-post',
			),
			openstation_shell_boot_target_meta( admin_url( 'edit.php?openstation_chromeless=1' ), $dock )
		);
		$this->assertSame(
			array(
				'title' => 'Categories',
				'icon'  => 'dashicons-admin-post',
			),
			openstation_shell_boot_target_meta( admin_url( 'edit-tags.php?taxonomy=category' ), $dock )
		);
		$this->assertSame(
			array(
				'title' => '',
				'icon'  => '',
			),
			openstation_shell_boot_target_meta( admin_url( 'options-general.php' ), $dock )
		);

		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		global $menu, $title;
		$menu_backup                          = $menu;
		$title_backup                         = $title;
		$menu                                 = array(
			array( 'Posts', 'edit_posts', 'edit.php', '', '', 'menu-posts', 'dashicons-admin-post' ),
		);
		$title                                = 'OpenStation';
		$_GET[ OPENSTATION_SHELL_TARGET_ARG ] = '/wp-admin/edit.php';

		$received = null;
		add_filter(
			'openstation_shell_config',
			function ( $config ) use ( &$received ) {
				$received = $config;
				return $config;
			}
		);
		try {
			openstation_enqueue_assets();
		} finally {
			$menu  = $menu_backup;
			$title = $title_backup;
			remove_all_filters( 'openstation_shell_config' );
		}

		$this->assertIsArray( $received );
		$this->assertSame( 'Posts', $received['currentTitle'] );
		$this->assertSame( 'dashicons-admin-post', $received['currentIcon'] );
	}

	/* ---------------------------------------------------------------
	 * Why the screen exists.
	 * ------------------------------------------------------------ */

	/**
	 * A script another screen enqueues on `index.php` — the Gutenberg
	 * plugin's Dashboard loader and its `wp-editor` closure is the
	 * loudest instance — never prints on the shell, because the shell
	 * no longer boots on that screen. Trunk before the screen existed
	 * failed this: the shell document *was* `index.php`.
	 *
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_a_dashboard_only_enqueue_never_reaches_the_shell() {
		wp_register_script( 'acme-editor', 'https://example.com/editor.js', array(), '1', true );
		wp_register_script( 'acme-dashboard-loader', 'https://example.com/loader.js', array( 'acme-editor' ), '1', true );
		$enqueue_on_dashboard = static function ( $hook_suffix ) {
			if ( 'index.php' === $hook_suffix ) {
				wp_enqueue_script( 'acme-dashboard-loader' );
			}
		};
		add_action( 'admin_enqueue_scripts', $enqueue_on_dashboard );

		try {
			// Control: the Dashboard screen does get it.
			set_current_screen( 'dashboard' );
			do_action( 'admin_enqueue_scripts', 'index.php' );
			$this->assertTrue( wp_script_is( 'acme-dashboard-loader', 'enqueued' ) );
			$this->assertFalse( wp_script_is( 'openstation', 'enqueued' ), 'The shell no longer rides on the Dashboard.' );
			wp_dequeue_script( 'acme-dashboard-loader' );

			// The shell screen: OpenStation's own assets, not the Dashboard's.
			set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
			do_action( 'admin_enqueue_scripts', OPENSTATION_SHELL_SCREEN_ID );
			$this->assertTrue( wp_script_is( 'openstation', 'enqueued' ) );
			$this->assertFalse( wp_script_is( 'acme-dashboard-loader', 'enqueued' ) );
			$this->assertNotContains( 'acme-editor', openstation_script_dependency_closure( wp_scripts(), wp_scripts()->queue ) );
		} finally {
			remove_action( 'admin_enqueue_scripts', $enqueue_on_dashboard );
		}
	}

	/* ---------------------------------------------------------------
	 * The operator dequeue filter.
	 * ------------------------------------------------------------ */

	/**
	 * @covers ::openstation_shell_dequeue_assets
	 */
	public function test_dequeue_filter_drops_a_named_handle_and_leaves_its_now_orphaned_dependency_unprinted() {
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		wp_register_script( 'acme-nag-core', 'https://example.com/nag-core.js', array(), '1', true );
		wp_register_script( 'acme-nag', 'https://example.com/nag.js', array( 'acme-nag-core' ), '1', true );
		wp_register_style( 'acme-nag-style', 'https://example.com/nag.css', array(), '1' );
		wp_enqueue_script( 'acme-nag' );
		wp_enqueue_style( 'acme-nag-style' );
		add_filter(
			'openstation_shell_dequeue_handles',
			static function ( $handles, $kind ) {
				return 'script' === $kind ? array( 'acme-nag' ) : array( 'acme-nag-style' );
			},
			10,
			2
		);

		openstation_shell_dequeue_assets();

		$this->assertFalse( wp_script_is( 'acme-nag', 'enqueued' ) );
		$this->assertFalse( wp_style_is( 'acme-nag-style', 'enqueued' ) );
		// Dequeued, never deregistered.
		$this->assertTrue( wp_script_is( 'acme-nag', 'registered' ) );
		// The dependency was only ever pulled in by the dropped handle,
		// so nothing in the queue's closure names it any more.
		$this->assertNotContains( 'acme-nag-core', openstation_script_dependency_closure( wp_scripts(), wp_scripts()->queue ) );
	}

	/**
	 * A handle a survivor depends on is refused, loudly.
	 *
	 * @covers ::openstation_shell_dequeue_assets
	 * @expectedIncorrectUsage openstation_shell_dequeue_assets
	 */
	public function test_dequeue_filter_refuses_a_handle_a_survivor_depends_on() {
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		wp_register_script( 'acme-nag-core', 'https://example.com/nag-core.js', array(), '1', true );
		wp_register_script( 'acme-keep', 'https://example.com/keep.js', array( 'acme-nag-core' ), '1', true );
		wp_enqueue_script( 'acme-nag-core' );
		wp_enqueue_script( 'acme-keep' );
		add_filter(
			'openstation_shell_dequeue_handles',
			static function ( $handles, $kind ) {
				return 'script' === $kind ? array( 'acme-nag-core' ) : $handles;
			},
			10,
			2
		);

		openstation_shell_dequeue_assets();

		$this->assertTrue( wp_script_is( 'acme-nag-core', 'enqueued' ) );
		$this->assertTrue( wp_script_is( 'acme-keep', 'enqueued' ) );
	}

	/**
	 * Windows and classic pages are not the shell's to trim.
	 *
	 * @covers ::openstation_shell_dequeue_assets
	 */
	public function test_dequeue_filter_is_inert_off_the_screen() {
		set_current_screen( 'dashboard' );
		wp_register_script( 'acme-nag', 'https://example.com/nag.js', array(), '1', true );
		wp_enqueue_script( 'acme-nag' );
		add_filter( 'openstation_shell_dequeue_handles', static fn() => array( 'acme-nag' ) );

		openstation_shell_dequeue_assets();

		$this->assertTrue( wp_script_is( 'acme-nag', 'enqueued' ) );
	}
}
