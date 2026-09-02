<?php
/**
 * Tests for My WordPress — the content explorer written as an App
 * Framework `.os.php` + `.os.ts`: the section registry (builtins +
 * discovered CPTs + groups), the queries with search/sort/paging,
 * the dossier payloads, the preview-action pipeline, and per-item
 * authorization, end to end through dispatch. The server half
 * returns DATA (the client view paints it — see
 * `apps/my-wordpress/my-wordpress.test.ts` for that side), so these
 * tests assert the `data` payload, the state, and the effects.
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

	/**
	 * One section's descriptor from a response's data.
	 *
	 * @param array  $response Runtime response.
	 * @param string $id       Section id.
	 * @return array<string,mixed>|null
	 */
	protected function data_section( array $response, $id ) {
		foreach ( $response['data']['sections'] as $section ) {
			if ( $section['id'] === $id ) {
				return $section;
			}
		}
		return null;
	}

	// ------------------------------------------------------ registration

	/**
	 * @covers ::openstation_app
	 */
	public function test_the_app_is_loaded_from_apps_with_both_halves() {
		$app = openstation_app( 'my-wordpress' );
		$this->assertNotNull( $app );

		$manifest = $app->manifest();
		// The app reclaimed the original's name, folder mark and
		// pinned launcher slot; the old window (launcher-less now, see
		// `myWordpress.php`) keeps hosting the detail surfaces.
		$this->assertSame( 'WP Explorer', $manifest['title'] );
		$this->assertSame( openstation_my_wordpress_app_title(), $manifest['title'], 'One helper names the explorer.' );
		if ( function_exists( 'openstation_my_wordpress_icon_svg' ) ) {
			$this->assertSame(
				'data:image/svg+xml;base64,' . base64_encode( openstation_my_wordpress_icon_svg() ),
				$manifest['icon'],
				'The launcher wears the original folder-with-mark art.'
			);
		}
		$this->assertSame( array( '*' ), $manifest['watch'], 'Sections are dynamic, so ANY content change repaints the explorer.' );
		$this->assertSame( 'refresh', $manifest['title_bar_buttons'][0]['action'] );
		$this->assertIsArray( $manifest['desktop_icon'] );
		$this->assertSame( -1, $manifest['desktop_icon']['position'], 'The original launcher slot.' );
		$this->assertTrue( ! empty( $manifest['desktop_icon']['pinned'] ) );
		$this->assertStringEndsWith(
			'apps/my-wordpress/my-wordpress.os.ts',
			wp_normalize_path( $manifest['client_source'] ),
			'The body is a client view — selection, marquee, drag-out and zoom are instant.'
		);
		$this->assertTrue( $manifest['has_data'] );
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

		// An editor cannot list users; the section simply is not there.
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

		$response = $this->dispatch( 'mount' );
		$book     = $this->data_section( $response, 'cpt-unit_book' );
		$this->assertNotNull( $book, 'The CPT is discovered by the same helper WP Explorer uses.' );
		$this->assertSame( 'Books', $book['label'] );
		$this->assertSame( 'dashicons-book', $book['icon'] );
		$this->assertSame( 'unit_book', $book['post_type'] );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\groups
	 */
	public function test_grouped_sections_ship_their_root_folder() {
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

		$response = $this->dispatch( 'mount' );
		$this->assertSame( 'my-shop', $this->data_section( $response, 'products' )['group'] );
		$labels = array_column( $response['data']['groups'], 'label', 'id' );
		$this->assertSame( 'My Shop', $labels['my-shop'] );

		$folder = $this->dispatch( 'go', array(), array( 'group' => 'my-shop' ) );
		$this->assertSame( 'my-shop', $folder['state']['group'] );
	}

	// -------------------------------------------------------------- data

	/**
	 * @covers \OpenStation\Apps\MyWordPress\count_of
	 */
	public function test_mount_ships_sections_with_counts_and_no_body_html() {
		$response = $this->dispatch( 'mount' );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( '', $response['html'], 'A client view paints the body.' );
		$this->assertGreaterThanOrEqual( 1, $this->data_section( $response, 'posts' )['count'] );
		$this->assertNull( $response['data']['list'] );
		$this->assertNull( $response['data']['detail'] );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\fetch
	 */
	public function test_opening_a_section_ships_the_list_page() {
		$response = $this->dispatch( 'go', array(), array( 'section' => 'posts' ) );
		$this->assertSame( 'posts', $response['state']['section'] );

		$list = $response['data']['list'];
		$this->assertSame( 1, $list['page'] );
		$titles = array_column( $list['items'], 'title' );
		$this->assertContains( 'Alpha strategy', $titles );

		$first = $list['items'][ array_search( 'Alpha strategy', $titles, true ) ];
		$this->assertTrue( $first['canEdit'] );
		$this->assertTrue( $first['canDelete'] );
		$this->assertNotSame( '', $first['link'], 'Rows carry their permalink for Copy links.' );

		$this->assertArrayHasKey( 'default', $response['data']['sortOptions'] );
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
		$titles = array_column( $newest['data']['list']['items'], 'title' );
		$this->assertLessThan(
			array_search( 'Alpha strategy', $titles, true ),
			array_search( 'Zulu memo', $titles, true ),
			'Default: newest first.'
		);

		$oldest = $this->dispatch(
			'sort',
			array(
				'section' => 'posts',
				'sort'    => 'oldest',
				'page'    => 3,
			)
		);
		$this->assertSame( 1, $oldest['state']['page'], 'A new order restarts from the first page.' );
		$titles = array_column( $oldest['data']['list']['items'], 'title' );
		$this->assertLessThan(
			array_search( 'Zulu memo', $titles, true ),
			array_search( 'Alpha strategy', $titles, true ),
			'Oldest first flips the order.'
		);
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\sort_options
	 * @covers \OpenStation\Apps\MyWordPress\tiebroken
	 */
	public function test_the_list_view_sorts_by_id_slug_modified_and_comments() {
		$zulu = self::factory()->post->create(
			array(
				'post_title' => 'Zulu memo',
				'post_name'  => 'aaa-first-slug',
				'post_date'  => '2026-02-01 10:00:00',
			)
		);

		$options = $this->dispatch( 'refresh', array( 'section' => 'posts' ) )['data']['sortOptions'];
		foreach ( array( 'id-asc', 'id-desc', 'modified', 'modified-asc', 'slug-asc', 'slug-desc', 'comments', 'comments-asc' ) as $key ) {
			$this->assertArrayHasKey( $key, $options, "The list view's `$key` order is offered." );
		}

		$by_id = array_column( $this->dispatch( 'sort', array( 'section' => 'posts', 'sort' => 'id-asc' ) )['data']['list']['items'], 'id' );
		$this->assertSame( $by_id, array_values( array_unique( $by_id ) ) );
		$sorted = $by_id;
		sort( $sorted );
		$this->assertSame( $sorted, $by_id, 'id-asc lists lowest ids first (the tiebreak must not flip it).' );

		$by_id_desc = array_column( $this->dispatch( 'sort', array( 'section' => 'posts', 'sort' => 'id-desc' ) )['data']['list']['items'], 'id' );
		$this->assertSame( array_reverse( $sorted ), $by_id_desc, 'id-desc lists highest ids first.' );

		$by_slug = array_column( $this->dispatch( 'sort', array( 'section' => 'posts', 'sort' => 'slug-asc' ) )['data']['list']['items'], 'id' );
		$this->assertSame( $zulu, $by_slug[0], 'Slug A–Z orders by post_name, not title.' );

		// Media never offers a comment order; users offer their own set.
		$media = $this->dispatch( 'refresh', array( 'section' => 'media' ) )['data']['sortOptions'];
		$this->assertArrayNotHasKey( 'comments', $media );
		$this->assertArrayHasKey( 'id-desc', $media );
		$users = $this->dispatch( 'refresh', array( 'section' => 'users' ) )['data']['sortOptions'];
		foreach ( array( 'id-asc', 'login-asc', 'email-desc', 'posts', 'oldest' ) as $key ) {
			$this->assertArrayHasKey( $key, $users );
		}
		$by_login = array_column( $this->dispatch( 'sort', array( 'section' => 'users', 'sort' => 'login-asc' ) )['data']['list']['items'], 'login' );
		$sorted   = $by_login;
		// MySQL collates case-insensitively; compare the same way.
		usort( $sorted, 'strcasecmp' );
		$this->assertSame( $sorted, $by_login, 'Username A–Z orders by user_login.' );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\post_facts
	 * @covers \OpenStation\Apps\MyWordPress\media_facts
	 * @covers \OpenStation\Apps\MyWordPress\user_row
	 */
	public function test_list_rows_carry_the_list_view_facts() {
		$child = self::factory()->post->create(
			array(
				'post_type'    => 'page',
				'post_title'   => 'Team',
				'post_parent'  => self::$page_id,
				'post_content' => 'one two three four five',
			)
		);
		$long  = self::factory()->post->create(
			array(
				'post_title'   => 'Long read',
				'post_content' => str_repeat( 'Tom &amp; Jerry go on. ', 40 ),
				// The factory invents one otherwise; the trim path is the point.
				'post_excerpt' => '',
			)
		);

		$rows = $this->dispatch( 'refresh', array( 'section' => 'posts' ) )['data']['list']['items'];
		foreach ( $rows as $candidate ) {
			if ( $long === $candidate['id'] ) {
				// The hover card sets this as TEXT: entities must already
				// be characters, the trimmed-excerpt marker included.
				$this->assertStringNotContainsString( '&hellip;', $candidate['excerpt'] );
				$this->assertStringNotContainsString( '&amp;', $candidate['excerpt'] );
				$this->assertStringContainsString( 'Tom & Jerry', $candidate['excerpt'] );
				$this->assertStringContainsString( '[…]', $candidate['excerpt'] );
			}
		}

		$rows = $this->dispatch( 'refresh', array( 'section' => 'posts' ) )['data']['list']['items'];
		$row  = null;
		foreach ( $rows as $candidate ) {
			if ( self::$post_id === $candidate['id'] ) {
				$row = $candidate;
			}
		}
		$this->assertNotNull( $row );
		$this->assertSame( 'alpha-strategy', $row['slug'] );
		$this->assertSame( self::$admin_id, $row['authorId'] );
		$this->assertNotSame( '', $row['author'] );
		$this->assertMatchesRegularExpression( '/^2026-01-10T10:00:00[+-]\d\d:\d\d$/', $row['date'], 'Dates ship as ISO-8601 with the site offset.' );
		$this->assertMatchesRegularExpression( '/^\d{4}-\d\d-\d\dT/', $row['modified'] );
		$this->assertSame( 0, $row['comments'] );
		$this->assertSame( home_url( '?p=' . self::$post_id ), $row['shortlink'], 'The `?p=` link that survives a permalink change.' );
		$this->assertSame( 0, $row['parent'] );
		$this->assertIsInt( $row['words'] );

		$response = $this->dispatch( 'refresh', array( 'section' => 'pages' ) );
		$pages    = $response['data'];
		$this->assertTrue( $this->data_section( $response, 'pages' )['hierarchical'], 'Pages declare themselves tree-shaped for the Parent column.' );
		$this->assertArrayNotHasKey( 'hierarchical', $this->data_section( $response, 'posts' ) );
		$team = null;
		foreach ( $pages['list']['items'] as $candidate ) {
			if ( $child === $candidate['id'] ) {
				$team = $candidate;
			}
		}
		$this->assertSame( self::$page_id, $team['parent'] );
		$this->assertSame( 'About', $team['parentTitle'] );
		$this->assertSame( 5, $team['words'] );

		$users = $this->dispatch( 'refresh', array( 'section' => 'users' ) )['data']['list']['items'];
		$admin = null;
		foreach ( $users as $candidate ) {
			if ( self::$admin_id === $candidate['id'] ) {
				$admin = $candidate;
			}
		}
		$this->assertNotNull( $admin );
		$user = get_userdata( self::$admin_id );
		$this->assertSame( $user->user_login, $admin['login'] );
		$this->assertSame( $user->user_email, $admin['email'] );
		$this->assertSame( array( 'administrator' ), $admin['roles'] );
		$this->assertMatchesRegularExpression( '/^\d{4}-\d\d-\d\dT/', $admin['registered'] );
		$this->assertGreaterThanOrEqual( 1, $admin['posts'], 'The published-post count rides the row, counted once per page.' );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\mount
	 * @covers \OpenStation\Apps\MyWordPress\view_action
	 */
	public function test_the_view_mode_is_remembered_per_user() {
		$first = $this->dispatch( 'mount' );
		$this->assertSame( 'icons', $first['state']['view'], 'The tile canvas is the default.' );

		$switched = $this->dispatch( 'view', array( 'section' => 'posts', 'view' => 'list' ) );
		$this->assertSame( 'list', $switched['state']['view'] );

		$again = $this->dispatch( 'mount' );
		$this->assertSame( 'list', $again['state']['view'], 'The next window opens the way this one was left.' );

		// Another person is not affected by this one's choice.
		wp_set_current_user( self::$editor_id );
		$this->assertSame( 'icons', $this->dispatch( 'mount' )['state']['view'] );

		// Garbage never lands: an unknown mode falls back and is stored as such.
		wp_set_current_user( self::$admin_id );
		$bad = $this->dispatch( 'view', array( 'section' => 'posts', 'view' => 'kanban' ) );
		$this->assertSame( 'icons', $bad['state']['view'] );
		$this->assertSame( 'icons', $this->dispatch( 'mount' )['state']['view'] );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\set_columns_action
	 * @covers \OpenStation\Apps\MyWordPress\hidden_columns
	 */
	public function test_hidden_columns_are_remembered_per_section() {
		$initial = $this->dispatch( 'refresh', array( 'section' => 'posts' ) );
		$this->assertSame( array(), (array) $initial['data']['hiddenColumns'], 'Nothing remembered: the client applies its defaults.' );

		// The payload ships an object (the client indexes it by section
		// id, and an empty PHP array would encode as `[]`); read it as one.
		$set = (array) $this->dispatch(
			'set-columns',
			array( 'section' => 'posts' ),
			array( 'hidden' => array( 'author', 'Comments', 'bad key!', '', 'author' ) )
		)['data']['hiddenColumns'];
		$this->assertSame( array( 'author', 'comments', 'badkey' ), $set['posts'], 'Sanitised, deduplicated, order kept.' );

		// An EMPTY list is a choice ("show everything"), kept as such.
		$all = (array) $this->dispatch( 'set-columns', array( 'section' => 'posts' ), array( 'hidden' => array() ) )['data']['hiddenColumns'];
		$this->assertSame( array(), $all['posts'] );

		// Other sections are untouched; a reset forgets just this one.
		$pages = (array) $this->dispatch( 'set-columns', array( 'section' => 'pages' ), array( 'hidden' => array( 'words' ) ) )['data']['hiddenColumns'];
		$this->assertSame( array( 'words' ), $pages['pages'] );
		$this->assertSame( array(), $pages['posts'] );
		$reset = (array) $this->dispatch( 'set-columns', array( 'section' => 'posts' ), array( 'reset' => true ) )['data']['hiddenColumns'];
		$this->assertArrayNotHasKey( 'posts', $reset );
		$this->assertSame( array( 'words' ), $reset['pages'] );

		// No section, no write.
		$none = $this->dispatch( 'set-columns', array(), array( 'hidden' => array( 'x' ) ) );
		$this->assertArrayNotHasKey( '', (array) $none['data']['hiddenColumns'] );

		// Per user.
		wp_set_current_user( self::$editor_id );
		$this->assertSame( array(), (array) $this->dispatch( 'refresh', array( 'section' => 'pages' ) )['data']['hiddenColumns'] );
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
		$titles = array_column( $response['data']['list']['items'], 'title' );
		$this->assertContains( 'Alpha strategy', $titles );
		$this->assertNotContains( 'Beta notes', $titles );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\fetch
	 */
	public function test_more_advances_the_page_for_infinite_scroll() {
		$response = $this->dispatch( 'more', array( 'section' => 'posts' ) );
		$this->assertSame( 2, $response['state']['page'] );
		$this->assertSame( 2, $response['data']['list']['page'] );
	}

	/**
	 * Add user opens Core's own user-new.php as a window — on
	 * multisite that screen IS the invite flow (Add Existing User,
	 * confirmation emails, the network's Add Users setting), so the
	 * section flags the affordance with Core's menu gate and the
	 * action re-checks it server-side.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\add_user_action
	 */
	public function test_add_user_opens_the_core_screen_for_the_allowed() {
		$response = $this->dispatch( 'go', array( 'section' => 'users' ) );
		$section  = $this->data_section( $response, 'users' );
		$this->assertTrue( $section['canAdd'], 'An administrator passes on both shapes: create_users on a single site, promote_users on a network.' );

		$response = $this->dispatch( 'add-user', array( 'section' => 'users' ) );
		$opens    = $this->effects_of( $response, 'open_url' );
		$this->assertCount( 1, $opens );
		$this->assertStringContainsString( 'user-new.php', $opens[0]['url'] );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\add_user_action
	 */
	public function test_add_user_refused_without_the_capability() {
		$editor = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $editor );

		$response = $this->dispatch( 'add-user', array( 'section' => 'users' ) );
		$this->assertSame( array(), $this->effects_of( $response, 'open_url' ) );
	}

	// ----------------------------------------------------------- dossier

	/**
	 * @covers \OpenStation\Apps\MyWordPress\detail
	 */
	public function test_post_dossier_carries_facts_and_the_rendered_preview() {
		$response = $this->dispatch(
			'open',
			array( 'section' => 'posts' ),
			array( 'item' => self::$post_id )
		);
		$detail = $response['data']['detail'];
		$this->assertSame( 'post', $detail['kind'] );
		$this->assertSame( 'Alpha strategy', $detail['title'] );
		$this->assertContains( 'Status', array_column( $detail['facts'], 0 ) );
		$this->assertArrayHasKey( 'content', $detail, 'The rendered body feeds the preview pane.' );
		$this->assertTrue( $detail['canDelete'] );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\detail
	 */
	public function test_user_dossier_carries_role_email_and_footprint() {
		$response = $this->dispatch(
			'open',
			array( 'section' => 'users' ),
			array( 'item' => self::$editor_id )
		);
		$detail = $response['data']['detail'];
		$this->assertSame( 'user', $detail['kind'] );
		$this->assertNotSame( '', $detail['avatar'] );
		$labels = array_column( $detail['facts'], 0 );
		$this->assertContains( 'Role', $labels );
		$this->assertFalse( $detail['canDelete'], 'Users are never trashable here.' );

		// The deep dossier rides `stats`: the SAME aggregated blob WP
		// Explorer's `/user-stats/<id>` route serves — stat tiles,
		// 12-month activity, milestones, recent posts, top terms.
		$this->assertIsArray( $detail['stats'] );
		$this->assertArrayHasKey( 'posts', $detail['stats']['counts'] );
		$this->assertArrayHasKey( 'pages', $detail['stats']['counts'] );
		$this->assertArrayHasKey( 'commentsReceived', $detail['stats']['counts'] );
		$this->assertArrayHasKey( 'commentsLeft', $detail['stats']['counts'] );
		$this->assertArrayHasKey( 'activity', $detail['stats'] );
		$this->assertArrayHasKey( 'milestones', $detail['stats'] );
		$this->assertArrayHasKey( 'registered', $detail['stats']['profile'], 'An admin viewer sees the private profile half.' );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\detail
	 */
	public function test_media_dossier_carries_the_usage_scan_and_zoom_source() {
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
		$detail = $response['data']['detail'];
		$this->assertSame( 'media', $detail['kind'] );
		$this->assertSame( 'Sunset photo', $detail['title'] );
		$this->assertArrayHasKey( 'usedIn', $detail, 'WP Explorer\'s usage scan, reused.' );
		$this->assertArrayHasKey( 'full', $detail, 'The zoom overlay reads the full-size source.' );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\section_of
	 */
	public function test_a_vanished_section_falls_back_to_the_root() {
		$response = $this->dispatch( 'refresh', array( 'section' => 'no-such-thing' ) );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( '', $response['state']['section'] );
		$this->assertNull( $response['data']['list'] );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\detail
	 */
	public function test_back_walks_pane_then_section_then_group() {
		$response = $this->dispatch(
			'back',
			array(
				'section' => 'posts',
				'item'    => self::$post_id,
			)
		);
		$this->assertSame( 0, $response['state']['item'], 'First back closes the pane.' );

		$response = $this->dispatch( 'back', array( 'section' => 'posts' ) );
		$this->assertSame( '', $response['state']['section'], 'Second back leaves the section.' );
	}

	// ----------------------------------------------------- navigate into

	/**
	 * @covers \OpenStation\Apps\MyWordPress\folder
	 */
	public function test_navigate_into_ships_the_relation_folders_and_the_article() {
		wp_set_post_terms( self::$post_id, array( 'alpha-tag' ), 'post_tag' );
		wp_update_post(
			array(
				'ID'           => self::$post_id,
				'post_content' => 'Hello revised world',
			)
		);

		$response = $this->dispatch( 'into', array( 'section' => 'posts' ), array( 'item' => self::$post_id ) );
		$this->assertSame( self::$post_id, $response['state']['into'] );
		$this->assertNull( $response['data']['list'], 'The folder view replaces the list.' );

		$folder = $response['data']['folder'];
		$this->assertSame( 'Alpha strategy', $folder['title'] );
		$this->assertStringContainsString( 'Hello revised world', $folder['content'] );

		$relations = array_column( $folder['folders'], 'count', 'relation' );
		$this->assertSame( 1, $relations['author'] );
		$this->assertArrayHasKey( 'comments', $relations );
		$this->assertArrayHasKey( 'tags', $relations );
		$this->assertArrayHasKey( 'media', $relations );
		$this->assertGreaterThanOrEqual( 1, $relations['revisions'], 'The update above left a revision.' );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\sub
	 */
	public function test_relation_sub_lists_carry_their_rows() {
		// Leave a revision — the class-level one from other tests rolls
		// back with their transactions.
		wp_update_post(
			array(
				'ID'           => self::$post_id,
				'post_content' => 'Revised for the sub-list test',
			)
		);
		self::factory()->comment->create(
			array(
				'comment_post_ID' => self::$post_id,
				'comment_author'  => 'Ada',
				'comment_content' => 'Great strategy, would read again.',
			)
		);
		$state = array(
			'section' => 'posts',
			'into'    => self::$post_id,
		);

		$author = $this->dispatch( 'relation', $state, array( 'relation' => 'author' ) );
		$this->assertSame( 'author', $author['state']['relation'] );
		$this->assertCount( 1, $author['data']['sub']['rows'] );

		$comments = $this->dispatch( 'relation', $state, array( 'relation' => 'comments' ) );
		$titles   = array_column( $comments['data']['sub']['rows'], 'title' );
		$this->assertContains( 'Ada', $titles );

		$revisions = $this->dispatch( 'relation', $state, array( 'relation' => 'revisions' ) );
		$this->assertNotEmpty( $revisions['data']['sub']['rows'] );

		$bogus = $this->dispatch( 'relation', $state, array( 'relation' => 'evil' ) );
		$this->assertSame( '', $bogus['state']['relation'], 'Unknown relations fall back to the folder view.' );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\sub_detail
	 */
	public function test_selecting_a_term_row_ships_the_wp_explorer_stats_pane() {
		$cat = self::factory()->category->create( array( 'name' => 'Notes' ) );
		wp_set_post_categories( self::$post_id, array( $cat ) );

		$response = $this->dispatch(
			'open',
			array(
				'section'  => 'posts',
				'into'     => self::$post_id,
				'relation' => 'categories',
			),
			array( 'item' => $cat )
		);

		$picked = $response['data']['subDetail'];
		$this->assertSame( 'term', $picked['kind'] );
		$this->assertSame( 'Notes', $picked['stats']['profile']['name'] );
		$this->assertGreaterThanOrEqual( 1, $picked['stats']['counts']['posts']['total'] );
		$this->assertContains( 'Alpha strategy', array_column( $picked['stats']['recent'], 'title' ) );
		$this->assertArrayHasKey( 'activity', $picked['stats'], 'The 12-month activity feeds the bars.' );
		$this->assertArrayHasKey( 'topAuthors', $picked['stats'], 'Top contributors ride along.' );
		$this->assertArrayHasKey( 'coTerms', $picked['stats'], 'Often-paired terms ride along.' );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\fetch
	 */
	public function test_pagination_is_deterministic_across_equal_dates() {
		// Thirty posts sharing one post_date to the second — without the
		// ID tiebreak their order is undefined PER QUERY, and an
		// infinite-scrolled list visibly reshuffles as pages land.
		$ids = array();
		for ( $i = 0; $i < 30; $i++ ) {
			$ids[] = self::factory()->post->create(
				array(
					'post_title' => 'Same second ' . $i,
					'post_date'  => '2026-03-03 03:03:03',
				)
			);
		}

		$page1 = array_column( $this->dispatch( 'refresh', array( 'section' => 'posts' ) )['data']['list']['items'], 'id' );
		$page2 = array_column(
			$this->dispatch(
				'refresh',
				array(
					'section' => 'posts',
					'page'    => 2,
				)
			)['data']['list']['items'],
			'id'
		);

		$this->assertSame( array(), array_values( array_intersect( $page1, $page2 ) ), 'Pages never overlap.' );

		$batch = array_values( array_intersect( array_merge( $page1, $page2 ), $ids ) );
		$this->assertGreaterThan( 1, count( $batch ) );
		$sorted = $batch;
		rsort( $sorted );
		$this->assertSame( $sorted, $batch, 'Equal-date rows come back newest-ID-first, every page, every query.' );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\sub_detail
	 */
	public function test_selecting_an_author_row_ships_the_user_dossier_with_stats() {
		$response = $this->dispatch(
			'open',
			array(
				'section'  => 'posts',
				'into'     => self::$post_id,
				'relation' => 'author',
			),
			array( 'item' => self::$admin_id )
		);
		$picked = $response['data']['subDetail'];
		$this->assertSame( 'user', $picked['kind'] );
		$this->assertContains( 'Email', array_column( $picked['detail']['facts'], 0 ) );
		$this->assertIsArray( $picked['stats'], 'WP Explorer\'s user-stats payload rides along.' );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\sub_detail
	 */
	public function test_a_revision_pane_refuses_a_row_from_another_post() {
		$other = self::factory()->post->create();
		wp_update_post(
			array(
				'ID'           => $other,
				'post_content' => 'other rev',
			)
		);
		$foreign = array_keys( wp_get_post_revisions( $other ) );
		$this->assertNotEmpty( $foreign );

		$response = $this->dispatch(
			'open',
			array(
				'section'  => 'posts',
				'into'     => self::$post_id,
				'relation' => 'revisions',
			),
			array( 'item' => reset( $foreign ) )
		);
		$this->assertNull( $response['data']['subDetail'], 'A revision of a different post never leaks into this pane.' );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\sub
	 */
	public function test_sub_open_recomputes_the_edit_url_server_side() {
		$response = $this->dispatch(
			'sub-open',
			array(
				'section'  => 'posts',
				'into'     => self::$post_id,
				'relation' => 'author',
			),
			array( 'row' => self::$admin_id )
		);
		$opens = $this->effects_of( $response, 'open_url' );
		$this->assertCount( 1, $opens );
		$this->assertStringContainsString( 'user-edit.php?user_id=' . self::$admin_id, $opens[0]['url'] );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\edit_choices
	 */
	public function test_quick_edit_applies_author_sticky_categories_and_tags() {
		$victim = self::factory()->post->create( array( 'post_title' => 'Full edit' ) );
		$cat    = self::factory()->category->create( array( 'name' => 'Field notes' ) );

		$response = $this->dispatch(
			'quick-edit',
			array( 'section' => 'posts' ),
			array(
				'items'      => array( $victim ),
				'author'     => self::$editor_id,
				'sticky'     => 'sticky',
				'categories' => array( $cat ),
				'tags'       => 'mixing, tape hiss',
			)
		);

		$post = get_post( $victim );
		$this->assertSame( (string) self::$editor_id, $post->post_author );
		$this->assertTrue( is_sticky( $victim ) );
		$this->assertContains( $cat, wp_get_post_categories( $victim ) );
		$tags = wp_list_pluck( (array) get_the_terms( $victim, 'post_tag' ), 'name' );
		$this->assertContains( 'mixing', $tags );
		$this->assertContains( 'tape hiss', $tags );
		$this->assertCount( 1, $this->effects_of( $response, 'announce' ) );

		// The modal's choices ship with the data.
		$this->assertNotEmpty( $response['data']['authors'] );
		$this->assertContains( 'Field notes', array_column( $response['data']['categories'], 'name' ) );
	}

	// --------------------------------------------------- preview actions

	/**
	 * @covers \OpenStation\Apps\MyWordPress\preview_actions
	 */
	public function test_preview_actions_flow_from_the_wp_explorer_filter_capability_gated() {
		add_filter(
			'openstation_my_wordpress_preview_actions',
			static function ( $actions ) {
				$actions[] = array(
					'id'       => 'export-form',
					'label'    => 'Export',
					'sections' => array( 'cpt-atf-forms' ),
				);
				$actions[] = array(
					'id'         => 'admin-only',
					'label'      => 'Danger zone',
					'capability' => 'manage_options',
				);
				return $actions;
			}
		);

		$ids = array_column( $this->dispatch( 'refresh' )['data']['previewActions'], 'id' );
		$this->assertContains( 'export-form', $ids );
		$this->assertContains( 'admin-only', $ids );

		wp_set_current_user( self::$editor_id );
		$ids = array_column( $this->dispatch( 'refresh' )['data']['previewActions'], 'id' );
		$this->assertContains( 'export-form', $ids );
		$this->assertNotContains( 'admin-only', $ids, 'Capability-gated actions never reach a user without the capability.' );
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
	public function test_quick_edit_updates_status_and_comments_over_the_selection() {
		$draft    = self::factory()->post->create(
			array(
				'post_title'  => 'To publish',
				'post_status' => 'draft',
			)
		);
		$chatty   = self::factory()->post->create( array( 'comment_status' => 'open' ) );
		$response = $this->dispatch(
			'quick-edit',
			array( 'section' => 'posts' ),
			array(
				'items'    => array( $draft, $chatty ),
				'status'   => 'publish',
				'comments' => 'closed',
			)
		);

		$this->assertSame( 'publish', get_post_status( $draft ) );
		$this->assertSame( 'closed', get_post( $chatty )->comment_status );

		$announces = $this->effects_of( $response, 'announce' );
		$this->assertCount( 1, $announces );
		$this->assertSame( 'updated', $announces[0]['action'] );
		$this->assertSame( array( $draft, $chatty ), $announces[0]['ids'] );
	}

	/**
	 * @covers \OpenStation\Apps\MyWordPress\allowed
	 */
	public function test_quick_edit_refuses_items_outside_the_meta_capability() {
		wp_set_current_user( self::$author_id );
		$this->dispatch(
			'quick-edit',
			array( 'section' => 'posts' ),
			array(
				'items'  => array( self::$post_id ),
				'status' => 'draft',
			)
		);
		$this->assertSame( 'publish', get_post_status( self::$post_id ), 'The admin\'s post is untouched.' );
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

	// -------------------------------------------------------------- size

	/**
	 * The point of the exercise: the whole explorer surface — root,
	 * groups, lists, selection, drag-out, dossiers, preview actions —
	 * in one PHP file, one client view and one stylesheet.
	 *
	 * @coversNothing
	 */
	public function test_the_app_stays_small_and_ships_exactly_one_script() {
		$dir     = OPENSTATION_DIR . 'apps/my-wordpress/';
		$sources = array_merge(
			glob( $dir . '*.php' ),
			glob( $dir . 'parts/*.php' ),
			glob( $dir . '*.os.ts' ),
			// Tests are not the shipped surface — the budget compares
			// against the ORIGINAL's source, which was counted without
			// its tests too.
			array_values(
				array_filter(
					(array) glob( $dir . 'parts/*.ts' ),
					static function ( $file ) {
						return ! str_ends_with( (string) $file, '.test.ts' );
					}
				)
			)
		);
		$lines   = 0;
		foreach ( array_merge( $sources, glob( $dir . '*.css' ) ) as $file ) {
			$lines += count( file( $file ) );
		}
		// The budget's history: it moved when the Agents section
		// landed, again as the parity gaps closed (bulk-edit controls,
		// hover card, plugin seams), again for the WooCommerce
		// surface, and finally when the app REPLACED the original
		// outright — reclaiming the name and absorbing the last
		// missing surface, the activity footprint (~600 lines here
		// against the ~800 it retired with the legacy bundle), and
		// once more for the list view (the per-kind column model, the
		// sortable table, the row action cluster, the column chooser —
		// a surface the original never had). The like-for-like
		// original it displaced measured ~32,000 lines; the whole
		// replacement stays well under half of that.
		$this->assertLessThan( 12500, $lines, sprintf( 'My WordPress is %d lines; the budget is under 12,500 — still well under half of the original it replaced.', $lines ) );

		// The house file-length rule, pinned hard for this app: every
		// PHP and TS source stays under 1,000 lines. The lint twins
		// (`local-rules/os-file-length`, `OpenStation.Files.FileLength`)
		// only warn — here, where the split already happened, growth
		// past the ceiling is a regression, not a judgement call.
		foreach ( $sources as $file ) {
			$this->assertLessThan(
				1000,
				count( file( $file ) ),
				sprintf( '%s outgrew the 1,000-line ceiling — split it along its seams (aim for 300–600 lines; see docs/app-framework.md, "Splitting a large app").', basename( $file ) )
			);
		}

		$scripts = array_map( 'basename', array_merge( glob( $dir . '*.js' ), glob( $dir . '*.ts' ) ) );
		$this->assertSame(
			array( 'my-wordpress.os.ts', 'my-wordpress.test.ts' ),
			$scripts,
			'The only top-level script an app ships is its .os.ts client view (plus its test); split modules live under parts/.'
		);

		// A part must never wear the entry suffixes: `parts/*.os.php`
		// would be loaded as a second app by the registry's depth-2
		// glob, and `parts/*.os.ts` would become a second Vite entry.
		$this->assertSame( array(), (array) glob( $dir . 'parts/*.os.php' ), 'parts/ holds plain .php files, never .os.php entries.' );
		$this->assertSame( array(), (array) glob( $dir . 'parts/*.os.ts' ), 'parts/ holds plain .ts files, never .os.ts entries.' );
	}
}
