<?php

class Tests_OpenStation_MyWordpressUserFootprint extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;
	protected static $author_id;
	protected static $contributor_id;
	protected static $subscriber_id;

	private $published_id;
	private $draft_id;
	private $private_id;

	private $a_day_ago;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id       = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id      = $factory->user->create( array( 'role' => 'editor' ) );
		self::$author_id      = $factory->user->create( array( 'role' => 'author' ) );
		self::$contributor_id = $factory->user->create( array( 'role' => 'contributor' ) );
		self::$subscriber_id  = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();

		$this->a_day_ago = gmdate( 'Y-m-d H:i:s', time() - DAY_IN_SECONDS );

		wp_set_current_user( self::$admin_id );
		do_action( 'rest_api_init' );

		$this->published_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'publish',
				'post_title'  => 'Public article',
			)
		);
		$this->draft_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'draft',
				'post_title'  => 'Secret draft',
			)
		);
		$this->private_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'private',
				'post_title'  => 'Private notes',
			)
		);
	}

	public function tear_down() {
		unregister_post_type( 'dm_fp_internal' );
		parent::tear_down();
	}

	private function dispatch_footprint( $user_id ) {
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/user-footprint/' . (int) $user_id );
		return rest_get_server()->dispatch( $request );
	}

	private function timeline_post_ids( $response ) {
		return wp_list_pluck( $response->get_data()['timeline'], 'postId' );
	}

	public function test_contributor_does_not_see_unpublished_titles_in_timeline() {
		wp_set_current_user( self::$contributor_id );

		$response = $this->dispatch_footprint( self::$author_id );
		$this->assertSame( 200, $response->get_status() );

		$ids = $this->timeline_post_ids( $response );
		$this->assertContains( $this->published_id, $ids );
		$this->assertNotContains( $this->draft_id, $ids );
		$this->assertNotContains( $this->private_id, $ids );
	}

	public function test_privileged_viewers_keep_unpublished_rows() {
		wp_set_current_user( self::$admin_id );
		$ids = $this->timeline_post_ids( $this->dispatch_footprint( self::$author_id ) );
		$this->assertContains( $this->draft_id, $ids );
		$this->assertContains( $this->private_id, $ids );

		wp_set_current_user( self::$author_id );
		$ids = $this->timeline_post_ids( $this->dispatch_footprint( self::$author_id ) );
		$this->assertContains( $this->draft_id, $ids );
		$this->assertContains( $this->private_id, $ids );
	}

	public function test_comment_on_unreadable_draft_is_dropped_from_timeline() {
		$admins_draft = self::factory()->post->create(
			array(
				'post_author' => self::$admin_id,
				'post_status' => 'draft',
				'post_title'  => 'Hidden parent',
			)
		);
		self::factory()->comment->create(
			array(
				'comment_post_ID'  => $admins_draft,
				'user_id'          => self::$author_id,
				'comment_approved' => '1',
			)
		);

		wp_set_current_user( self::$contributor_id );
		$ids = $this->timeline_post_ids( $this->dispatch_footprint( self::$author_id ) );
		$this->assertNotContains( $admins_draft, $ids );

		wp_set_current_user( self::$admin_id );
		$ids = $this->timeline_post_ids( $this->dispatch_footprint( self::$author_id ) );
		$this->assertContains( $admins_draft, $ids );
	}

	public function test_update_rows_on_unreadable_drafts_are_dropped() {

		$draft = self::factory()->post->create(
			array(
				'post_author'   => self::$author_id,
				'post_status'   => 'draft',
				'post_title'    => 'Draft in progress',
				'post_date'     => $this->a_day_ago,
				'post_date_gmt' => $this->a_day_ago,
			)
		);
		wp_set_current_user( self::$author_id );
		wp_update_post(
			array(
				'ID'           => $draft,
				'post_content' => 'A later save creates a revision.',
			)
		);

		wp_set_current_user( self::$contributor_id );
		$response = $this->dispatch_footprint( self::$author_id );
		$this->assertNotContains( $draft, $this->timeline_post_ids( $response ) );

		wp_set_current_user( self::$admin_id );
		$response = $this->dispatch_footprint( self::$author_id );
		$timeline = $response->get_data()['timeline'];
		$updates  = wp_list_filter( $timeline, array( 'kind' => 'post-update' ) );
		$this->assertContains( $draft, wp_list_pluck( $updates, 'postId' ) );
	}

	public function test_contributor_totals_count_published_only() {
		self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'pending',
				'post_title'  => 'Awaiting review',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'publish',
				'post_type'   => 'page',
				'post_title'  => 'Public page',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'draft',
				'post_type'   => 'page',
				'post_title'  => 'Secret page',
			)
		);

		wp_set_current_user( self::$contributor_id );
		$totals = $this->dispatch_footprint( self::$author_id )->get_data()['totals'];

		$this->assertSame( 1, $totals['posts'], 'Draft, private and pending posts must not be counted.' );
		$this->assertSame( 1, $totals['pages'], 'A draft page must not be counted.' );
	}

	public function test_privileged_viewer_totals_include_unpublished() {
		wp_set_current_user( self::$admin_id );
		$totals = $this->dispatch_footprint( self::$author_id )->get_data()['totals'];

		$this->assertSame( 3, $totals['posts'] );
	}

	public function test_subject_sees_own_unpublished_totals() {
		wp_set_current_user( self::$author_id );
		$totals = $this->dispatch_footprint( self::$author_id )->get_data()['totals'];

		$this->assertSame( 3, $totals['posts'] );
	}

	public function test_update_counts_exclude_unreadable_parents() {
		$draft = self::factory()->post->create(
			array(
				'post_author'   => self::$author_id,
				'post_status'   => 'draft',
				'post_title'    => 'Draft in progress',
				'post_date'     => $this->a_day_ago,
				'post_date_gmt' => $this->a_day_ago,
			)
		);
		wp_set_current_user( self::$author_id );
		wp_update_post(
			array(
				'ID'           => $draft,
				'post_content' => 'A later save creates a revision.',
			)
		);

		wp_set_current_user( self::$contributor_id );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertSame(
			0,
			$data['totals']['updates'],
			'A revision on an unreadable draft must not reach the lifetime count.'
		);
		$this->assertSame(
			0,
			array_sum( wp_list_pluck( $data['daily'], 'updates' ) ),
			'…nor any heatmap cell.'
		);

		wp_set_current_user( self::$admin_id );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertGreaterThan( 0, $data['totals']['updates'] );
	}

	private function timeline_ids_of_kind( $data, $kind ) {
		return array_values( wp_list_pluck( wp_list_filter( $data['timeline'], array( 'kind' => $kind ) ), 'postId' ) );
	}

	public function test_editor_counts_agree_with_the_rows_they_can_read() {
		$draft = self::factory()->post->create(
			array(
				'post_author'   => self::$author_id,
				'post_status'   => 'draft',
				'post_title'    => 'Draft being edited',
				'post_date'     => $this->a_day_ago,
				'post_date_gmt' => $this->a_day_ago,
			)
		);
		wp_set_current_user( self::$author_id );
		wp_update_post(
			array(
				'ID'           => $draft,
				'post_content' => 'A later save creates a revision.',
			)
		);

		wp_set_current_user( self::$editor_id );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();

		$post_rows = $this->timeline_ids_of_kind( $data, 'post' );
		$this->assertContains( $this->draft_id, $post_rows );
		$this->assertContains( $this->private_id, $post_rows );

		$this->assertSame( 4, $data['totals']['posts'] );

		$this->assertContains( $draft, $this->timeline_ids_of_kind( $data, 'post-update' ) );
		$this->assertSame( 1, $data['totals']['updates'] );
		$this->assertSame( 1, array_sum( wp_list_pluck( $data['daily'], 'updates' ) ) );

		wp_set_current_user( self::$contributor_id );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertSame( 1, $data['totals']['posts'] );
		$this->assertSame( 0, $data['totals']['updates'] );
	}

	public function test_updates_to_a_non_viewable_type_stay_with_viewers_who_can_edit_it() {
		register_post_type(
			'dm_fp_internal',
			array(
				'public'       => false,
				'map_meta_cap' => true,
				'supports'     => array( 'title', 'editor', 'revisions' ),
			)
		);
		$record = self::factory()->post->create(
			array(
				'post_author'   => self::$admin_id,
				'post_type'     => 'dm_fp_internal',
				'post_status'   => 'publish',
				'post_title'    => 'Internal record',
				'post_date'     => $this->a_day_ago,
				'post_date_gmt' => $this->a_day_ago,
			)
		);
		wp_set_current_user( self::$author_id );
		wp_update_post(
			array(
				'ID'           => $record,
				'post_content' => 'The subject edits the record.',
			)
		);

		wp_set_current_user( self::$contributor_id );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertSame( 0, $data['totals']['updates'] );
		$this->assertSame( 0, array_sum( wp_list_pluck( $data['daily'], 'updates' ) ) );
		$this->assertNotContains( $record, $this->timeline_ids_of_kind( $data, 'post-update' ) );

		wp_set_current_user( self::$admin_id );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertSame( 1, $data['totals']['updates'] );
		$this->assertContains( $record, $this->timeline_ids_of_kind( $data, 'post-update' ) );
	}

	public function test_comment_counts_follow_the_comment_row_gate() {
		register_post_type(
			'dm_fp_internal',
			array(
				'public'       => false,
				'map_meta_cap' => true,
			)
		);
		$parents = array(
			$this->published_id,
			self::factory()->post->create(
				array(
					'post_author' => self::$admin_id,
					'post_status' => 'private',
				)
			),
			self::factory()->post->create(
				array(
					'post_author'   => self::$admin_id,
					'post_status'   => 'publish',
					'post_password' => 'secret',
				)
			),
			self::factory()->post->create(
				array(
					'post_author' => self::$admin_id,
					'post_type'   => 'dm_fp_internal',
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
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertSame( 1, $data['totals']['comments'] );
		$this->assertSame( 1, array_sum( wp_list_pluck( $data['daily'], 'comments' ) ) );
		$this->assertSame( array( $this->published_id ), $this->timeline_ids_of_kind( $data, 'comment' ) );

		wp_set_current_user( self::$admin_id );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertSame( 5, $data['totals']['comments'] );
		$this->assertSame( 5, array_sum( wp_list_pluck( $data['daily'], 'comments' ) ) );
		$this->assertCount( 5, $this->timeline_ids_of_kind( $data, 'comment' ) );
	}

	public function test_first_save_of_an_undated_draft_is_not_an_update() {
		wp_set_current_user( self::$author_id );
		$draft = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'draft',
				'post_title'  => 'Fresh draft',
			)
		);
		$this->assertSame( '0000-00-00 00:00:00', get_post( $draft )->post_date_gmt );

		wp_update_post(
			array(
				'ID'           => $draft,
				'post_content' => 'First save.',
			)
		);
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertSame( 0, $data['totals']['updates'] );
		$this->assertSame( 0, array_sum( wp_list_pluck( $data['daily'], 'updates' ) ) );
		$this->assertNotContains( $draft, $this->timeline_ids_of_kind( $data, 'post-update' ) );

		wp_update_post(
			array(
				'ID'           => $draft,
				'post_content' => 'Second save.',
			)
		);
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertSame( 1, $data['totals']['updates'] );
		$this->assertSame( 1, array_sum( wp_list_pluck( $data['daily'], 'updates' ) ) );
		$this->assertContains( $draft, $this->timeline_ids_of_kind( $data, 'post-update' ) );

		wp_update_post(
			array(
				'ID'          => $draft,
				'post_status' => 'publish',
			)
		);
		$this->assertNotSame( '0000-00-00 00:00:00', get_post( $draft )->post_date_gmt );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertSame( 1, $data['totals']['updates'] );
		$this->assertSame( 1, array_sum( wp_list_pluck( $data['daily'], 'updates' ) ) );
		$this->assertContains( $draft, $this->timeline_ids_of_kind( $data, 'post-update' ) );
	}

	public function test_logged_out_request_is_rejected() {
		wp_set_current_user( 0 );
		$response = $this->dispatch_footprint( self::$author_id );
		$this->assertSame( 401, $response->get_status() );
	}

	public function test_saves_before_a_scheduled_date_count_as_updates() {
		wp_set_current_user( self::$author_id );
		$in_a_week = gmdate( 'Y-m-d H:i:s', time() + WEEK_IN_SECONDS );
		$scheduled = self::factory()->post->create(
			array(
				'post_author'   => self::$author_id,
				'post_status'   => 'future',
				'post_title'    => 'Scheduled scoop',
				'post_date'     => $in_a_week,
				'post_date_gmt' => $in_a_week,
			)
		);
		foreach ( array( 'First save.', 'Second save.', 'Third save.' ) as $content ) {
			wp_update_post(
				array(
					'ID'           => $scheduled,
					'post_content' => $content,
				)
			);
		}
		$this->assertSame( 'future', get_post_status( $scheduled ) );

		$data = $this->dispatch_footprint( self::$author_id )->get_data();

		$this->assertSame( 2, $data['totals']['updates'] );
		$this->assertSame( 2, array_sum( wp_list_pluck( $data['daily'], 'updates' ) ) );
		$this->assertContains( $scheduled, $this->timeline_ids_of_kind( $data, 'post-update' ) );
	}

	public function test_a_per_post_capability_filter_reaches_the_counts() {
		$hidden = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'draft',
				'post_title'  => 'Embargoed draft',
			)
		);
		foreach ( array( $this->draft_id, $hidden ) as $parent ) {
			self::factory()->comment->create(
				array(
					'comment_post_ID'  => $parent,
					'user_id'          => self::$author_id,
					'comment_approved' => '1',
				)
			);
		}
		add_filter(
			'map_meta_cap',
			static function ( $caps, $cap, $user_id, $args ) use ( $hidden ) {
				if ( 'read_post' === $cap && isset( $args[0] ) && (int) $args[0] === $hidden ) {
					return array( 'do_not_allow' );
				}
				return $caps;
			},
			10,
			4
		);

		wp_set_current_user( self::$editor_id );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();

		$post_rows = $this->timeline_ids_of_kind( $data, 'post' );
		$this->assertNotContains( $hidden, $post_rows );
		$this->assertContains( $this->draft_id, $post_rows );

		$this->assertSame( 3, $data['totals']['posts'] );

		$this->assertSame( array( $this->draft_id ), $this->timeline_ids_of_kind( $data, 'comment' ) );
		$this->assertSame( 1, $data['totals']['comments'] );
		$this->assertSame( 1, array_sum( wp_list_pluck( $data['daily'], 'comments' ) ) );
	}

	public function test_subscriber_is_rejected_by_route() {
		wp_set_current_user( self::$subscriber_id );
		$this->assertSame( 403, $this->dispatch_footprint( self::$author_id )->get_status() );
	}

	public function test_filter_narrowed_route_refuses_admins() {
		add_filter( 'openstation_my_wordpress_user_can_use', '__return_false' );

		wp_set_current_user( self::$admin_id );
		$this->assertSame( 403, $this->dispatch_footprint( self::$author_id )->get_status() );
	}
}
