<?php
/**
 * Tests for My WordPress — the content explorer written as an App
 * Framework `.os.php`: the section registry (builtins + discovered
 * CPTs + groups), the queries with search/sort/paging, the two-pane
 * views, selection and bulk trash, and per-item authorization, end to
 * end through dispatch.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group my-wordpress-app
 */

use function OpenStation\Apps\MyWordPress\sections;

class Tests_OpenStation_MyWordPressApp extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;
	protected static $author_id;
	protected static $subscriber_id;
	protected static $post_id;
	protected static $page_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id     = $factory->user->create( array( 'role' => 'editor' ) );
		self::$author_id     = $factory->user->create( array( 'role' => 'author' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
		self::$post_id       = $factory->post->create(
			array(
				'post_title'  => 'Alpha strategy',
				'post_status' => 'publish',
				'post_author' => self::$admin_id,
				'post_date'   => '2026-01-10 10:00:00',
			)
		);
		self::$page_id       = $factory->post->create(
			array(
				'post_type'   => 'page',
				'post_title'  => 'About',
				'post_status' => 'publish',
			)
		);
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		// See the codeBlue.php tear_down — app icons are process-scoped.
		foreach ( array_keys( openstation_apps_registry()->all() ) as $id ) {
			openstation_unregister_icon( $id );
		}
		unregister_post_type( 'unit_book' );
		parent::tear_down();
	}

	/**
	 * Run one dispatch against the registered app.
	 *
	 * @param string $action Action.
	 * @param array  $state  Client state.
	 * @param array  $args   Trigger args.
	 * @return array Runtime response.
	 */
	protected function dispatch( $action, array $state = array(), array $args = array() ) {
		return openstation_apps_runtime()->dispatch(
			'my-wordpress',
			array(
				'action' => $action,
				'state'  => $state,
				'args'   => $args,
			),
			openstation_apps_os()
		);
	}

	/**
	 * The effects of one type from a response.
	 *
	 * @param array  $response Runtime response.
	 * @param string $type     Effect type.
	 * @return array[]
	 */
	protected function effects_of( array $response, $type ) {
		return array_values(
			array_filter(
				$response['effects'],
				static function ( $effect ) use ( $type ) {
					return $type === $effect['type'];
				}
			)
		);
	}

	// ------------------------------------------------------ registration

	/**
	 * @covers ::openstation_app
	 */
	public function test_the_app_is_loaded_from_apps_with_its_chrome() {
		$app = openstation_app( 'my-wordpress' );
		$this->assertNotNull( $app );

		$manifest = $app->manifest();
		$this->assertSame( 'My WordPress', $manifest['title'] );
		$this->assertSame( array( '*' ), $manifest['watch'], 'Sections are dynamic, so ANY content change repaints the explorer.' );
		$this->assertSame( 'refresh', $manifest['title_bar_buttons'][0]['action'] );
		$this->assertIsArray( $manifest['desktop_icon'] );
		$this->assertSame( '', $manifest['client_source'], 'A server view: the app ships no JavaScript.' );
		$this->assertStringEndsWith( 'apps/my-wordpress/my-wordpress.css', wp_normalize_path( $manifest['style'] ) );
	}

	/**
	 * @covers \OpenStation\App::allows
	 */
	public function test_gate_requires_edit_posts() {
		$app = openstation_app( 'my-wordpress' );
		$os  = openstation_apps_os();

		wp_set_current_user( self::$subscriber_id );
		$this->assertFalse( $app->allows( $os ) );

		wp_set_current_user( self::$editor_id );
		$this->assertTrue( $app->allows( $os ) );
	}

	// ---------------------------------------------------------- sections

	/**
	 * @covers \OpenStation\Apps\MyWordPress\sections
	 */
	public function test_sections_are_capability_gated_per_user() {
		$ids = static function () {
			return array_column( sections( openstation_apps_os() ), 'id' );
		};

		// Exactly these four builtins, in this order, whatever CPTs the
		// plugin itself happens to register in the test environment.
		$builtins = array( 'posts', 'pages', 'media', 'users' );
		$this->assertSame( $builtins, array_values( array_intersect( $ids(), $builtins ) ) );

		// An editor cannot list users; the tile simply is not there.
		wp_set_current_user( self::$editor_id );
		$this->assertNotContains( 'users', $ids() );
		$this->assertContains( 'posts', $ids() );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\sections
	 */
	public function test_a_registered_cpt_becomes_a_section_through_the_shared_discovery() {
		register_post_type(
			'unit_book',
			array(
				'label'        => 'Books',
				'show_ui'      => true,
				'show_in_rest' => true,
				'menu_icon'    => 'dashicons-book',
			)
		);

		$list = sections( openstation_apps_os() );
		$book = null;
		foreach ( $list as $section ) {
			if ( 'cpt-unit_book' === $section['id'] ) {
				$book = $section;
			}
		}
		$this->assertNotNull( $book, 'The CPT is discovered by the same helper WP Explorer uses.' );
		$this->assertSame( 'Books', $book['label'] );
		$this->assertSame( 'dashicons-book', $book['icon'] );

		$response = $this->dispatch( 'mount' );
		$this->assertStringContainsString( 'os-arg-section="cpt-unit_book"', $response['html'] );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\groups
	 */
	public function test_grouped_sections_fold_into_a_root_folder() {
		add_filter(
			'openstation_my_wordpress_app_sections',
			static function ( $sections ) {
				$sections[] = array(
					'id'         => 'products',
					'label'      => 'Products',
					'icon'       => 'dashicons-cart',
					'kind'       => 'post',
					'post_type'  => 'post',
					'capability' => 'edit_posts',
					'thumbnails' => false,
					'group'      => 'my-shop',
					'groupLabel' => 'My Shop',
					'groupIcon'  => 'dashicons-store',
					'groupOrder' => 5,
				);
				return $sections;
			}
		);

		$root = $this->dispatch( 'mount' );
		$this->assertStringContainsString( 'os-arg-group="my-shop"', $root['html'] );
		$this->assertStringContainsString( 'My Shop', $root['html'] );
		$this->assertStringNotContainsString( 'os-arg-section="products"', $root['html'], 'A grouped section lives inside its folder, not loose at the root.' );

		$folder = $this->dispatch( 'go', array(), array( 'group' => 'my-shop' ) );
		$this->assertSame( 'my-shop', $folder['state']['group'] );
		$this->assertStringContainsString( 'os-arg-section="products"', $folder['html'] );
	}

	// ------------------------------------------------------------- views

	/**
	 * @covers \OpenStation\Apps\MyWordPress\render_root
	 */
	public function test_mount_paints_the_root_grid_with_counts_and_status() {
		$response = $this->dispatch( 'mount' );
		$this->assertTrue( $response['ok'] );
		$this->assertStringContainsString( 'os-arg-section="posts"', $response['html'] );
		$this->assertStringContainsString( 'os-arg-section="users"', $response['html'] );
		$this->assertStringContainsString( 'Posts ·', $response['html'], 'Each tile carries its count, WP Explorer style.' );
		$this->assertStringContainsString( 'folders', $response['html'], 'The status bar counts the root.' );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\render_list
	 */
	public function test_opening_a_section_paints_the_list_pane_with_toolbar_and_pager() {
		$response = $this->dispatch( 'go', array(), array( 'section' => 'posts' ) );
		$this->assertSame( 'posts', $response['state']['section'] );
		$this->assertStringContainsString( 'Alpha strategy', $response['html'] );
		$this->assertStringContainsString( 'os-action="open"', $response['html'] );
		$this->assertStringContainsString( 'os-on="dblclick"', $response['html'], 'Double-click opens the editor.' );
		$this->assertStringContainsString( 'os-on="contextmenu"', $response['html'], 'Right-click opens the actions menu.' );
		$this->assertStringContainsString( 'os-bind="sort"', $response['html'], 'The toolbar sorts.' );
		$this->assertStringContainsString( 'Page 1 of', $response['html'] );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\sort_of
	 */
	public function test_sort_reorders_the_list() {
		self::factory()->post->create(
			array(
				'post_title' => 'Zulu memo',
				'post_date'  => '2026-02-01 10:00:00',
			)
		);

		$newest = $this->dispatch( 'refresh', array( 'section' => 'posts' ) );
		$this->assertLessThan(
			strpos( $newest['html'], 'Alpha strategy' ),
			strpos( $newest['html'], 'Zulu memo' ),
			'Default: newest first.'
		);

		$oldest = $this->dispatch(
			'refresh',
			array(
				'section' => 'posts',
				'sort'    => 'oldest',
			)
		);
		$this->assertLessThan(
			strpos( $oldest['html'], 'Zulu memo' ),
			strpos( $oldest['html'], 'Alpha strategy' ),
			'Oldest first flips the order.'
		);
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\fetch
	 */
	public function test_search_narrows_the_list_and_resets_the_page() {
		self::factory()->post->create( array( 'post_title' => 'Beta notes' ) );

		$response = $this->dispatch(
			'search',
			array(
				'section' => 'posts',
				'query'   => 'Alpha',
				'page'    => 7,
			)
		);
		$this->assertSame( 1, $response['state']['page'] );
		$this->assertStringContainsString( 'Alpha strategy', $response['html'] );
		$this->assertStringNotContainsString( 'Beta notes', $response['html'] );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\render_detail
	 */
	public function test_opening_an_item_adds_the_detail_pane_beside_the_list() {
		$response = $this->dispatch(
			'open',
			array( 'section' => 'posts' ),
			array( 'item' => self::$post_id )
		);
		$this->assertStringContainsString( 'os-mywp__detail-pane', $response['html'], 'Two panes: the list stays.' );
		$this->assertStringContainsString( 'os-mywp__list', $response['html'] );
		$this->assertStringContainsString( 'Status', $response['html'] );
		$this->assertStringContainsString( 'os-action="trash"', $response['html'] );
		$this->assertStringContainsString( 'os-confirm', $response['html'], 'Trash asks first.' );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\render_detail
	 */
	public function test_user_dossier_shows_role_email_and_footprint() {
		$response = $this->dispatch(
			'open',
			array( 'section' => 'users' ),
			array( 'item' => self::$editor_id )
		);
		$this->assertStringContainsString( 'Editor', $response['html'] );
		$this->assertStringContainsString( 'os-avatar', $response['html'] );
		$this->assertStringContainsString( 'Comments', $response['html'], 'The footprint facts are part of the dossier.' );
		$this->assertStringNotContainsString( 'os-action="trash"', $response['html'], 'Users are never trashable here.' );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\render_detail
	 */
	public function test_media_dossier_carries_the_usage_scan() {
		$attachment = self::factory()->post->create(
			array(
				'post_type'      => 'attachment',
				'post_title'     => 'Sunset photo',
				'post_status'    => 'inherit',
				'post_mime_type' => 'image/jpeg',
			)
		);
		$response   = $this->dispatch(
			'open',
			array( 'section' => 'media' ),
			array( 'item' => $attachment )
		);
		$this->assertStringContainsString( 'Sunset photo', $response['html'] );
		$this->assertStringContainsString( 'Used in', $response['html'], 'WP Explorer\'s usage scan, reused.' );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\render_list
	 */
	public function test_media_section_lists_as_a_thumbnail_grid() {
		self::factory()->post->create(
			array(
				'post_type'      => 'attachment',
				'post_title'     => 'Grid photo',
				'post_status'    => 'inherit',
				'post_mime_type' => 'image/jpeg',
			)
		);
		$response = $this->dispatch( 'go', array(), array( 'section' => 'media' ) );
		$this->assertStringContainsString( 'Grid photo', $response['html'] );
		$this->assertStringContainsString( 'os-mywp__list--grid', $response['html'] );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\section_of
	 */
	public function test_a_vanished_section_falls_back_to_the_root() {
		$response = $this->dispatch( 'refresh', array( 'section' => 'no-such-thing' ) );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( '', $response['state']['section'] );
		$this->assertStringContainsString( 'os-mywp__root', $response['html'] );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\render_root
	 */
	public function test_back_walks_pane_then_section_then_group() {
		$state = array(
			'group'   => '',
			'section' => 'posts',
			'item'    => self::$post_id,
		);

		$response = $this->dispatch( 'back', $state );
		$this->assertSame( 0, $response['state']['item'], 'First back closes the pane.' );

		$response = $this->dispatch( 'back', array( 'section' => 'posts' ) );
		$this->assertSame( '', $response['state']['section'], 'Second back leaves the section.' );
	}

	// --------------------------------------------------------- selection

	/**
	 * @covers \OpenStation\Apps\MyWordPress\render_list
	 */
	public function test_picking_rows_builds_a_selection_and_shows_the_bulk_bar() {
		$picked = $this->dispatch(
			'pick',
			array( 'section' => 'posts' ),
			array( 'item' => self::$post_id )
		);
		$this->assertSame( array( self::$post_id ), $picked['state']['selected'] );
		$this->assertStringContainsString( '1 selected', $picked['html'] );
		$this->assertStringContainsString( 'os-action="bulk-trash"', $picked['html'] );

		$cleared = $this->dispatch( 'clear-select', $picked['state'] );
		$this->assertSame( array(), $cleared['state']['selected'] );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\allowed
	 */
	public function test_bulk_trash_trashes_only_what_the_user_may_trash() {
		wp_set_current_user( self::$author_id );
		$own = self::factory()->post->create(
			array(
				'post_title'  => 'Mine',
				'post_author' => self::$author_id,
			)
		);

		$response = $this->dispatch(
			'bulk-trash',
			array(
				'section'  => 'posts',
				'selected' => array( $own, self::$post_id ),
			)
		);

		$this->assertSame( 'trash', get_post_status( $own ) );
		$this->assertSame( 'publish', get_post_status( self::$post_id ), 'The admin\'s post survives an author\'s bulk trash.' );
		$this->assertSame( array(), $response['state']['selected'] );

		$announces = $this->effects_of( $response, 'announce' );
		$this->assertCount( 1, $announces );
		$this->assertSame( array( $own ), $announces[0]['ids'], 'Only what was actually trashed is announced.' );
	}

	// ----------------------------------------------------------- actions

	/**
	 * @covers \OpenStation\Apps\MyWordPress\edit_url
	 */
	public function test_edit_queues_an_open_url_effect() {
		$response = $this->dispatch(
			'edit',
			array( 'section' => 'posts' ),
			array( 'item' => self::$post_id )
		);
		$opens = $this->effects_of( $response, 'open_url' );
		$this->assertCount( 1, $opens );
		$this->assertStringContainsString( 'post=' . self::$post_id, $opens[0]['url'] );
		$this->assertStringContainsString( 'action=edit', $opens[0]['url'] );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\allowed
	 */
	public function test_trash_moves_the_post_announces_and_closes_the_pane() {
		$victim   = self::factory()->post->create( array( 'post_title' => 'Doomed' ) );
		$response = $this->dispatch(
			'trash',
			array(
				'section' => 'posts',
				'item'    => $victim,
			),
			array( 'item' => $victim )
		);

		$this->assertSame( 'trash', get_post_status( $victim ) );
		$this->assertSame( 0, $response['state']['item'], 'The dossier of a trashed item closes.' );

		$announces = $this->effects_of( $response, 'announce' );
		$this->assertCount( 1, $announces );
		$this->assertSame( 'post', $announces[0]['contentType'] );
		$this->assertSame( 'trashed', $announces[0]['action'] );
		$this->assertSame( array( $victim ), $announces[0]['ids'] );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\allowed
	 */
	public function test_trash_refuses_a_user_without_the_meta_capability() {
		wp_set_current_user( self::$author_id );
		$response = $this->dispatch(
			'trash',
			array( 'section' => 'posts' ),
			array( 'item' => self::$post_id )
		);

		$this->assertSame( 'publish', get_post_status( self::$post_id ), 'The admin\'s post is untouched.' );
		$toasts = $this->effects_of( $response, 'toast' );
		$this->assertCount( 1, $toasts );
		$this->assertStringContainsString( 'cannot', $toasts[0]['message'] );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\allowed
	 */
	public function test_row_menu_reflects_per_item_authorization() {
		wp_set_current_user( self::$author_id );
		$response = $this->dispatch(
			'row-menu',
			array( 'section' => 'posts' ),
			array( 'item' => self::$post_id )
		);

		$menus = $this->effects_of( $response, 'menu' );
		$this->assertCount( 1, $menus );
		$labels = wp_list_pluck( $menus[0]['items'], 'label' );
		$this->assertContains( 'Open', $labels );
		$this->assertNotContains( 'Open in editor', $labels, 'An author cannot edit the admin\'s post.' );
		$trash = null;
		foreach ( $menus[0]['items'] as $item ) {
			if ( 'trash' === $item['action'] ) {
				$trash = $item;
			}
		}
		$this->assertNotNull( $trash );
		$this->assertTrue( $trash['danger'] );
		$this->assertTrue( $trash['disabled'] );
	}

	// -------------------------------------------------------------- size

	/**
	 * The point of the exercise: the whole explorer surface in one PHP
	 * file plus a stylesheet, no JavaScript.
	 *
	 * @coversNothing
	 */
	public function test_the_app_stays_small_and_ships_no_script() {
		$dir   = OPENSTATION_DIR . 'apps/my-wordpress/';
		$lines = 0;
		foreach ( array_merge( glob( $dir . '*.php' ), glob( $dir . '*.css' ) ) as $file ) {
			$lines += count( file( $file ) );
		}
		$this->assertLessThan( 1800, $lines, sprintf( 'My WordPress is %d lines; the budget is under 1,800.', $lines ) );

		$scripts = array_merge( glob( $dir . '*.js' ), glob( $dir . '*.ts' ) );
		$this->assertSame( array(), $scripts, 'The explorer is a server view: no JavaScript at all.' );
	}
}
