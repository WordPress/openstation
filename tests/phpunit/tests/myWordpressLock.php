<?php

class Tests_OpenStation_MyWordpressLock extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;
	protected static $author_id;
	protected static $subscriber_id;

	private $post_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id     = $factory->user->create( array( 'role' => 'editor' ) );
		self::$author_id     = $factory->user->create( array( 'role' => 'author' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();

		wp_set_current_user( self::$admin_id );
		do_action( 'rest_api_init' );

		$this->post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'publish',
				'post_title'  => 'Collaborative post',
			)
		);
		update_post_meta( $this->post_id, '_edit_last', self::$editor_id );
	}

	public function tear_down() {
		remove_all_filters( 'openstation_my_wordpress_post_contributors' );
		parent::tear_down();
	}

	private function contributor_ids() {
		return wp_list_pluck(
			openstation_my_wordpress_post_contributors_payload( $this->post_id ),
			'userId'
		);
	}

	public function test_contributors_visible_to_users_who_can_edit_the_post() {
		wp_set_current_user( self::$admin_id );
		$this->assertContains( self::$editor_id, $this->contributor_ids() );

		wp_set_current_user( self::$author_id );
		$this->assertContains( self::$editor_id, $this->contributor_ids() );
	}

	public function test_contributors_empty_for_users_who_cannot_edit_the_post() {
		wp_set_current_user( self::$subscriber_id );
		$this->assertSame( array(), openstation_my_wordpress_post_contributors_payload( $this->post_id ) );

		wp_set_current_user( 0 );
		$this->assertSame( array(), openstation_my_wordpress_post_contributors_payload( $this->post_id ) );
	}

	public function test_gate_applies_before_the_contributors_filter() {
		$filter_ran = false;
		add_filter(
			'openstation_my_wordpress_post_contributors',
			function ( $ids ) use ( &$filter_ran ) {
				$filter_ran = true;
				$ids[]      = self::$editor_id;
				return $ids;
			}
		);

		wp_set_current_user( self::$subscriber_id );
		$this->assertSame( array(), openstation_my_wordpress_post_contributors_payload( $this->post_id ) );
		$this->assertFalse( $filter_ran );
	}

	public function test_rest_field_respects_the_gate() {
		$request = new WP_REST_Request( 'GET', '/wp/v2/posts/' . $this->post_id );

		wp_set_current_user( self::$subscriber_id );
		$data = rest_get_server()->dispatch( $request )->get_data();
		$this->assertSame( array(), $data['openstation_contributors'] );

		wp_set_current_user( self::$admin_id );
		$data = rest_get_server()->dispatch( $request )->get_data();
		$this->assertContains(
			self::$editor_id,
			wp_list_pluck( $data['openstation_contributors'], 'userId' )
		);
	}
}
