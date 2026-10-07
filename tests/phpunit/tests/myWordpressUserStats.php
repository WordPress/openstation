<?php

class Tests_OpenStation_MyWordpressUserStats extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $contributor_id;
	protected static $subscriber_id;
	protected static $author_id;

	private $published_post_id;
	private $draft_post_id;
	private $private_post_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id       = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$contributor_id = $factory->user->create( array( 'role' => 'contributor' ) );
		self::$subscriber_id  = $factory->user->create( array( 'role' => 'subscriber' ) );
		self::$author_id      = $factory->user->create( array( 'role' => 'author' ) );
	}

	public function set_up() {
		parent::set_up();

		wp_set_current_user( self::$admin_id );
		do_action( 'rest_api_init' );

		register_post_type( 'dm_test_book', array( 'public' => true ) );

		register_post_type( 'dm_test_internal', array( 'public' => false ) );

		$this->published_post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'publish',
				'post_date'   => '2026-01-06 10:00:00',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'publish',
				'post_date'   => '2026-01-05 10:00:00',
			)
		);
		$this->draft_post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'draft',
				'post_date'   => '2026-01-04 10:00:00',
			)
		);
		$this->private_post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'private',
				'post_date'   => '2026-01-03 10:00:00',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_type'   => 'page',
				'post_status' => 'publish',
				'post_date'   => '2026-01-02 10:00:00',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_type'   => 'page',
				'post_status' => 'draft',
				'post_date'   => '2026-01-01 10:00:00',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_type'   => 'dm_test_book',
				'post_status' => 'publish',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_type'   => 'dm_test_book',
				'post_status' => 'draft',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_type'   => 'dm_test_internal',
				'post_status' => 'publish',
			)
		);

		self::factory()->comment->create(
			array(
				'comment_post_ID'  => $this->published_post_id,
				'comment_approved' => '1',
			)
		);
		self::factory()->comment->create(
			array(
				'comment_post_ID'  => $this->draft_post_id,
				'comment_approved' => '1',
			)
		);
	}

	public function tear_down() {
		unregister_post_type( 'dm_test_book' );
		unregister_post_type( 'dm_test_internal' );
		remove_all_filters( 'openstation_my_wordpress_user_stats' );
		parent::tear_down();
	}

	private function dispatch( $user_id ) {
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/user-stats/' . (int) $user_id );
		return rest_get_server()->dispatch( $request );
	}

	public function test_logged_out_request_is_rejected() {
		wp_set_current_user( 0 );
		$response = $this->dispatch( self::$author_id );
		$this->assertSame( 401, $response->get_status() );
	}

	public function test_unprivileged_viewer_sees_published_recent_only() {
		wp_set_current_user( self::$contributor_id );
		$data = $this->dispatch( self::$author_id )->get_data();

		$this->assertNotEmpty( $data['recent'] );
		$ids = array();
		foreach ( $data['recent'] as $row ) {
			$this->assertSame( 'publish', $row['status'] );
			$ids[] = $row['id'];
		}
		$this->assertContains( $this->published_post_id, $ids );
		$this->assertNotContains( $this->draft_post_id, $ids );
		$this->assertNotContains( $this->private_post_id, $ids );
	}

	public function test_unprivileged_viewer_gets_publish_only_counts() {
		wp_set_current_user( self::$contributor_id );
		$counts = $this->dispatch( self::$author_id )->get_data()['counts'];

		$this->assertSame(
			array(
				'publish' => 2,
				'total'   => 2,
			),
			$counts['posts']
		);
		$this->assertSame(
			array(
				'publish' => 1,
				'total'   => 1,
			),
			$counts['pages']
		);
	}

	public function test_unprivileged_viewer_cpt_and_comment_counts_exclude_non_public() {
		wp_set_current_user( self::$contributor_id );
		$counts = $this->dispatch( self::$author_id )->get_data()['counts'];

		$this->assertSame( 1, $counts['cpt'] );
		$this->assertSame( 1, $counts['commentsReceived'] );
	}

	public function test_unprivileged_viewer_cpt_count_excludes_non_viewable_types() {
		wp_set_current_user( self::$contributor_id );
		$counts = $this->dispatch( self::$author_id )->get_data()['counts'];

		$this->assertSame(
			1,
			$counts['cpt'],
			'A published row of a non-viewable post type must not be counted.'
		);
	}

	public function test_unprivileged_comment_counts_cover_readable_parents_only() {
		$parents = array(
			$this->published_post_id,
			$this->draft_post_id,
			self::factory()->post->create(
				array(
					'post_author'   => self::$author_id,
					'post_status'   => 'publish',
					'post_password' => 'secret',
				)
			),
			self::factory()->post->create(
				array(
					'post_author' => self::$author_id,
					'post_type'   => 'dm_test_internal',
					'post_status' => 'publish',
				)
			),

			999999,
		);
		foreach ( $parents as $parent ) {
			self::factory()->comment->create(
				array(
					'comment_post_ID'  => $parent,
					'user_id'          => self::$author_id,
					'comment_approved' => '1',
				)
			);
		}

		wp_set_current_user( self::$contributor_id );
		$counts = $this->dispatch( self::$author_id )->get_data()['counts'];

		$this->assertSame( 1, $counts['commentsLeft'] );

		$this->assertSame( 2, $counts['commentsReceived'] );

		wp_set_current_user( self::$admin_id );
		$counts = $this->dispatch( self::$author_id )->get_data()['counts'];
		$this->assertSame( 5, $counts['commentsLeft'] );

		$this->assertSame( 6, $counts['commentsReceived'] );
	}

	public function test_comment_counts_follow_a_per_post_read_filter() {
		$members_only = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'publish',
				'post_title'  => 'Members only',
			)
		);

		foreach ( array( $this->published_post_id, $members_only ) as $parent ) {
			self::factory()->comment->create(
				array(
					'comment_post_ID'  => $parent,
					'user_id'          => self::$author_id,
					'comment_approved' => '1',
				)
			);
		}
		self::factory()->comment->create(
			array(
				'comment_post_ID'  => $members_only,
				'comment_approved' => '1',
			)
		);

		wp_set_current_user( self::$contributor_id );
		$counts = $this->dispatch( self::$author_id )->get_data()['counts'];

		$this->assertSame( 4, $counts['commentsReceived'] );
		$this->assertSame( 2, $counts['commentsLeft'] );

		$contributor = self::$contributor_id;
		add_filter(
			'map_meta_cap',
			static function ( $caps, $cap, $user_id, $args ) use ( $members_only, $contributor ) {
				if ( 'read_post' === $cap && isset( $args[0] ) && (int) $args[0] === $members_only && (int) $user_id === $contributor ) {
					return array( 'do_not_allow' );
				}
				return $caps;
			},
			10,
			4
		);
		$this->assertFalse(
			openstation_my_wordpress_can_read_comment_post( get_post( $members_only ) ),
			'The comment dossier refuses the members-only post.'
		);

		$counts = $this->dispatch( self::$author_id )->get_data()['counts'];

		$this->assertSame( 2, $counts['commentsReceived'] );
		$this->assertSame( 1, $counts['commentsLeft'] );
	}

	public function test_cpt_count_leaves_out_core_built_in_types() {
		foreach ( array( 'wp_block', 'wp_navigation' ) as $type ) {
			self::factory()->post->create(
				array(
					'post_author' => self::$author_id,
					'post_type'   => $type,
					'post_status' => 'publish',
				)
			);
		}

		wp_set_current_user( self::$admin_id );
		$this->assertSame( 3, $this->dispatch( self::$author_id )->get_data()['counts']['cpt'] );

		wp_set_current_user( self::$contributor_id );
		$this->assertSame( 1, $this->dispatch( self::$author_id )->get_data()['counts']['cpt'] );
	}

	public function test_unprivileged_viewer_profile_omits_sensitive_fields() {
		wp_set_current_user( self::$contributor_id );
		$profile = $this->dispatch( self::$author_id )->get_data()['profile'];

		$this->assertArrayNotHasKey( 'email', $profile );
		$this->assertArrayNotHasKey( 'username', $profile );
		$this->assertArrayNotHasKey( 'registered', $profile );
		$this->assertArrayNotHasKey( 'roles', $profile );
	}

	public function test_privileged_viewer_sees_full_data() {
		wp_set_current_user( self::$admin_id );
		$data   = $this->dispatch( self::$author_id )->get_data();
		$counts = $data['counts'];

		$this->assertSame( 2, $counts['posts']['publish'] );
		$this->assertSame( 1, $counts['posts']['draft'] );
		$this->assertSame( 1, $counts['posts']['private'] );
		$this->assertSame( 4, $counts['posts']['total'] );
		$this->assertSame( 1, $counts['pages']['draft'] );

		$this->assertSame( 3, $counts['cpt'] );
		$this->assertSame( 2, $counts['commentsReceived'] );

		$ids = wp_list_pluck( $data['recent'], 'id' );
		$this->assertContains( $this->draft_post_id, $ids );

		$this->assertArrayHasKey( 'email', $data['profile'] );
	}

	public function test_self_sees_full_data_without_list_users() {
		wp_set_current_user( self::$author_id );
		$data = $this->dispatch( self::$author_id )->get_data();

		$this->assertArrayHasKey( 'draft', $data['counts']['posts'] );
		$this->assertSame( 1, $data['counts']['posts']['draft'] );

		$ids = wp_list_pluck( $data['recent'], 'id' );
		$this->assertContains( $this->draft_post_id, $ids );
	}

	public function test_subscriber_is_rejected_by_route() {
		wp_set_current_user( self::$subscriber_id );
		$this->assertSame( 403, $this->dispatch( self::$author_id )->get_status() );
	}

	public function test_filter_narrowed_route_refuses_admins() {
		add_filter( 'openstation_my_wordpress_user_can_use', '__return_false' );

		wp_set_current_user( self::$admin_id );
		$this->assertSame( 403, $this->dispatch( self::$author_id )->get_status() );
	}
}
