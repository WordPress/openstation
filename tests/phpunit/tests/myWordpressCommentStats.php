<?php

class Tests_OpenStation_MyWordpressCommentStats extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;
	protected static $author_id;

	const INTERNAL_TYPE = 'os_test_internal';

	private $published_post_id;
	private $private_post_id;
	private $published_comment_id;
	private $private_comment_id;
	private $protected_comment_id;
	private $internal_comment_id;
	private $orphan_comment_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
		self::$author_id     = $factory->user->create( array( 'role' => 'author' ) );
	}

	public function set_up() {
		parent::set_up();

		wp_set_current_user( self::$admin_id );
		do_action( 'rest_api_init' );

		register_post_type(
			self::INTERNAL_TYPE,
			array(
				'public'             => false,
				'publicly_queryable' => false,
				'map_meta_cap'       => true,
				'supports'           => array( 'title', 'editor', 'comments' ),
			)
		);

		$this->published_post_id = self::factory()->post->create(
			array(
				'post_author' => self::$admin_id,
				'post_status' => 'publish',
			)
		);
		$this->private_post_id = self::factory()->post->create(
			array(
				'post_author' => self::$admin_id,
				'post_status' => 'private',
			)
		);
		$protected_post_id = self::factory()->post->create(
			array(
				'post_author'   => self::$admin_id,
				'post_status'   => 'publish',
				'post_password' => 'secret',
			)
		);
		$internal_post_id = self::factory()->post->create(
			array(
				'post_author' => self::$admin_id,
				'post_status' => 'publish',
				'post_type'   => self::INTERNAL_TYPE,
			)
		);

		$this->published_comment_id = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $this->published_post_id,
				'comment_approved' => '1',
			)
		);
		$this->private_comment_id = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $this->private_post_id,
				'comment_approved' => '1',
			)
		);
		$this->protected_comment_id = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $protected_post_id,
				'comment_approved' => '1',
			)
		);
		$this->internal_comment_id = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $internal_post_id,
				'comment_approved' => '1',
			)
		);
		$this->orphan_comment_id = self::factory()->comment->create(
			array(
				'comment_post_ID'  => 0,
				'comment_approved' => '1',
			)
		);
	}

	public function tear_down() {
		unregister_post_type( self::INTERNAL_TYPE );
		parent::tear_down();
	}

	private function dispatch( $comment_id ) {
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/comment-stats/' . (int) $comment_id );
		return rest_get_server()->dispatch( $request );
	}

	public function test_logged_out_request_is_rejected() {
		wp_set_current_user( 0 );
		$this->assertSame( 401, $this->dispatch( $this->published_comment_id )->get_status() );
	}

	public function test_subscriber_is_rejected_by_route() {
		wp_set_current_user( self::$subscriber_id );
		$this->assertSame( 403, $this->dispatch( $this->published_comment_id )->get_status() );
	}

	public function test_author_cannot_read_comment_on_private_post() {
		wp_set_current_user( self::$author_id );
		$this->assertSame( 403, $this->dispatch( $this->private_comment_id )->get_status() );
	}

	public function test_author_cannot_read_comment_on_protected_post() {
		wp_set_current_user( self::$author_id );
		$this->assertSame( 403, $this->dispatch( $this->protected_comment_id )->get_status() );
	}

	public function test_author_reads_comment_on_unlocked_protected_post() {
		wp_set_current_user( self::$author_id );

		require_once ABSPATH . WPINC . '/class-phpass.php';
		$hasher                                 = new PasswordHash( 8, true );
		$_COOKIE[ 'wp-postpass_' . COOKIEHASH ] = $hasher->HashPassword( 'secret' );

		$status = $this->dispatch( $this->protected_comment_id )->get_status();
		unset( $_COOKIE[ 'wp-postpass_' . COOKIEHASH ] );

		$this->assertSame( 200, $status );
	}

	public function test_author_cannot_read_comment_on_internal_post_type() {
		wp_set_current_user( self::$author_id );

		$this->assertTrue(
			current_user_can( 'read_post', get_comment( $this->internal_comment_id )->comment_post_ID ),
			'read_post alone would have authorized this read.'
		);
		$this->assertSame( 403, $this->dispatch( $this->internal_comment_id )->get_status() );
	}

	public function test_admin_reads_comment_on_internal_post_type() {
		wp_set_current_user( self::$admin_id );
		$this->assertSame( 200, $this->dispatch( $this->internal_comment_id )->get_status() );
	}

	public function test_author_reads_comment_on_public_post() {
		wp_set_current_user( self::$author_id );
		$response = $this->dispatch( $this->published_comment_id );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( $this->published_comment_id, $response->get_data()['comment']['id'] );
	}

	public function test_admin_reads_comment_on_restricted_posts() {
		wp_set_current_user( self::$admin_id );
		$this->assertSame( 200, $this->dispatch( $this->private_comment_id )->get_status() );
		$this->assertSame( 200, $this->dispatch( $this->protected_comment_id )->get_status() );
	}

	public function test_orphaned_comment_is_moderators_only() {
		wp_set_current_user( self::$author_id );
		$this->assertSame( 403, $this->dispatch( $this->orphan_comment_id )->get_status() );

		$GLOBALS['post'] = get_post( $this->published_post_id );
		$this->assertSame( 403, $this->dispatch( $this->orphan_comment_id )->get_status() );
		unset( $GLOBALS['post'] );

		wp_set_current_user( self::$admin_id );
		$response = $this->dispatch( $this->orphan_comment_id );
		$this->assertSame( 200, $response->get_status() );
		$this->assertNull( $response->get_data()['post'] );
	}

	public function test_thread_does_not_cross_into_an_unreadable_post() {
		$on_private = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $this->private_post_id,
				'comment_approved' => '1',
				'comment_content'  => 'Secret thread content.',
			)
		);

		$child = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $this->published_post_id,
				'comment_parent'   => $on_private,
				'comment_approved' => '1',
			)
		);

		$cross_reply = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $this->private_post_id,
				'comment_parent'   => $this->published_comment_id,
				'comment_approved' => '1',
				'comment_content'  => 'Secret reply content.',
			)
		);

		wp_set_current_user( self::$author_id );

		$data = $this->dispatch( $child )->get_data();
		$this->assertNull( $data['parent'], 'A parent on another post is not this thread.' );

		$data = $this->dispatch( $this->published_comment_id )->get_data();
		$this->assertNotContains(
			$cross_reply,
			wp_list_pluck( $data['replies'], 'id' ),
			'A reply stored against another post is not this thread.'
		);
	}

	public function test_pending_thread_parent_is_hidden_from_non_moderators() {
		$pending = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $this->published_post_id,
				'comment_approved' => '0',
			)
		);
		$child = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $this->published_post_id,
				'comment_parent'   => $pending,
				'comment_approved' => '1',
			)
		);

		wp_set_current_user( self::$author_id );
		$this->assertNull( $this->dispatch( $child )->get_data()['parent'] );

		wp_set_current_user( self::$admin_id );
		$this->assertSame( $pending, $this->dispatch( $child )->get_data()['parent']['id'] );
	}

	public function test_zero_id_is_not_found_even_with_a_global_comment() {
		wp_set_current_user( self::$admin_id );

		$GLOBALS['comment'] = get_comment( $this->published_comment_id );
		$status             = $this->dispatch( 0 )->get_status();
		unset( $GLOBALS['comment'] );

		$this->assertSame( 404, $status );
	}

	public function test_filter_widened_route_still_enforces_parent_post_gate() {
		add_filter( 'openstation_my_wordpress_user_can_use', '__return_true' );

		wp_set_current_user( self::$subscriber_id );
		$this->assertSame( 200, $this->dispatch( $this->published_comment_id )->get_status() );
		$this->assertSame( 403, $this->dispatch( $this->private_comment_id )->get_status() );
		$this->assertSame( 403, $this->dispatch( $this->protected_comment_id )->get_status() );
	}

	public function test_filter_narrowed_route_refuses_admins() {
		add_filter( 'openstation_my_wordpress_user_can_use', '__return_false' );

		wp_set_current_user( self::$admin_id );
		$this->assertSame( 403, $this->dispatch( $this->published_comment_id )->get_status() );
	}

	public function test_missing_comment_is_not_found() {
		wp_set_current_user( self::$admin_id );
		$this->assertSame( 404, $this->dispatch( 999999 )->get_status() );
	}
}
