<?php
/**
 * Tests for the comments-window inline-reply REST handler — specifically
 * the per-target `edit_post` authorization gate that mirrors core's
 * `wp_ajax_replyto_comment` flow.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 */
class Tests_OpenStation_CommentsWindow_RestReply extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $contributor_id;
	protected static $post_id;
	protected static $comment_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id       = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$contributor_id = $factory->user->create( array( 'role' => 'contributor' ) );
		self::$post_id        = $factory->post->create(
			array(
				'post_status' => 'publish',
				'post_author' => self::$admin_id,
			)
		);
		self::$comment_id     = $factory->comment->create(
			array(
				'comment_post_ID'  => self::$post_id,
				'comment_approved' => 1,
			)
		);
	}

	private function build_request( array $params ) {
		$req = new WP_REST_Request( 'POST', '/desktop-mode/v1/comments/reply' );
		foreach ( $params as $k => $v ) {
			$req->set_param( $k, $v );
		}
		return $req;
	}

	/**
	 * A user with `edit_posts` but without `edit_post` on the target post
	 * (a contributor replying on another author's post) must be rejected
	 * with a 403 and no comment may be created.
	 *
	 * @covers ::open_station_comments_window_rest_reply
	 */
	public function test_reply_forbidden_without_edit_post_on_target_post() {
		wp_set_current_user( self::$contributor_id );

		$before = (int) get_comments(
			array(
				'post_id' => self::$post_id,
				'status'  => 'all',
				'count'   => true,
			)
		);

		$resp = open_station_comments_window_rest_reply(
			$this->build_request(
				array(
					'parent'  => self::$comment_id,
					'content' => 'Sneaky reply.',
				)
			)
		);

		$this->assertWPError( $resp );
		$this->assertSame( 'open_station_comments_forbidden', $resp->get_error_code() );
		$this->assertSame( 403, $resp->get_error_data()['status'] );

		$after = (int) get_comments(
			array(
				'post_id' => self::$post_id,
				'status'  => 'all',
				'count'   => true,
			)
		);
		$this->assertSame( $before, $after );
	}

	/**
	 * A user who can edit the target post replies successfully.
	 *
	 * @covers ::open_station_comments_window_rest_reply
	 */
	public function test_reply_allowed_for_user_who_can_edit_post() {
		wp_set_current_user( self::$admin_id );

		$resp = open_station_comments_window_rest_reply(
			$this->build_request(
				array(
					'parent'  => self::$comment_id,
					'content' => 'Thanks for the comment!',
				)
			)
		);

		$this->assertInstanceOf( 'WP_REST_Response', $resp );
		$this->assertSame( 201, $resp->get_status() );

		$data = $resp->get_data();
		$this->assertSame( self::$comment_id, $data['parent'] );

		$new = get_comment( $data['id'] );
		$this->assertInstanceOf( 'WP_Comment', $new );
		$this->assertSame( (string) self::$post_id, (string) $new->comment_post_ID );
		$this->assertSame( (string) self::$comment_id, (string) $new->comment_parent );
	}

	/**
	 * A missing parent comment still 404s before the capability gate.
	 *
	 * @covers ::open_station_comments_window_rest_reply
	 */
	public function test_reply_missing_parent_returns_404() {
		wp_set_current_user( self::$admin_id );

		$resp = open_station_comments_window_rest_reply(
			$this->build_request(
				array(
					'parent'  => PHP_INT_MAX,
					'content' => 'Hello?',
				)
			)
		);

		$this->assertWPError( $resp );
		$this->assertSame( 'open_station_comments_no_parent', $resp->get_error_code() );
		$this->assertSame( 404, $resp->get_error_data()['status'] );
	}
}
