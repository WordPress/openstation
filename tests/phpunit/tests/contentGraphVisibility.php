<?php

class Tests_OpenStation_ContentGraphVisibility extends WP_UnitTestCase {

	protected static $editor_id;
	protected static $author_a_id;
	protected static $author_b_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$editor_id   = $factory->user->create(
			array(
				'role'         => 'editor',
				'display_name' => 'Edith Editor',
			)
		);
		self::$author_a_id = $factory->user->create(
			array(
				'role'         => 'author',
				'display_name' => 'Alice Example',
			)
		);
		self::$author_b_id = $factory->user->create(
			array(
				'role'         => 'author',
				'display_name' => 'Bob Example',
			)
		);
	}

	public function set_up() {
		parent::set_up();

		openstation_content_graph_flush_cache();
	}

	public function test_other_users_private_posts_excluded_without_read_private_posts() {
		$public_id  = self::factory()->post->create(
			array(
				'post_author' => self::$author_b_id,
				'post_status' => 'publish',
				'post_type'   => 'post',
			)
		);
		$private_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_b_id,
				'post_status' => 'private',
				'post_type'   => 'post',
			)
		);

		wp_set_current_user( self::$author_a_id );
		$payload = openstation_content_graph_build( array( 'post' ) );
		$ids     = $this->node_ids( $payload );

		$this->assertContains( $public_id, $ids );
		$this->assertNotContains(
			$private_id,
			$ids,
			'A user without read_private_posts must not see other users\' private posts in the graph.'
		);
	}

	public function test_own_private_posts_included() {
		$private_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_a_id,
				'post_status' => 'private',
				'post_type'   => 'post',
			)
		);

		wp_set_current_user( self::$author_a_id );
		$payload = openstation_content_graph_build( array( 'post' ) );

		$this->assertContains(
			$private_id,
			$this->node_ids( $payload ),
			'A user must still see their OWN private posts in the graph.'
		);
	}

	public function test_privileged_user_sees_private_posts() {
		$private_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_b_id,
				'post_status' => 'private',
				'post_type'   => 'post',
			)
		);

		wp_set_current_user( self::$editor_id );
		$payload = openstation_content_graph_build( array( 'post' ) );

		$this->assertContains( $private_id, $this->node_ids( $payload ) );
	}

	public function test_cache_is_not_shared_across_privilege_tiers() {
		$private_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_b_id,
				'post_status' => 'private',
				'post_type'   => 'post',
			)
		);

		wp_set_current_user( self::$editor_id );
		$editor_payload = openstation_content_graph_build( array( 'post' ) );
		$this->assertContains( $private_id, $this->node_ids( $editor_payload ) );

		wp_set_current_user( self::$author_a_id );
		$author_payload = openstation_content_graph_build( array( 'post' ) );
		$this->assertNotContains(
			$private_id,
			$this->node_ids( $author_payload ),
			'A payload cached for a privileged user must never be served to a lower-privilege user.'
		);

		wp_set_current_user( self::$editor_id );
		$editor_payload = openstation_content_graph_build( array( 'post' ) );
		$this->assertContains( $private_id, $this->node_ids( $editor_payload ) );
	}

	public function test_nodes_strips_contributor_ids_for_posts_user_cannot_edit() {
		$post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_b_id,
				'post_status' => 'publish',
				'post_type'   => 'post',
			)
		);

		wp_set_current_user( self::$editor_id );
		wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => 'Edited by the editor.',
			)
		);

		wp_set_current_user( self::$author_a_id );
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/content-graph/nodes' );
		$request->set_param( 'types', 'post' );
		$data = rest_ensure_response( openstation_content_graph_rest_nodes( $request ) )->get_data();
		$node = $this->find_node( $data, $post_id );

		$this->assertSame(
			array(),
			$node['contributor_ids'],
			'Revision-author ids must be stripped for posts the viewer cannot edit.'
		);
		$this->assertArrayNotHasKey(
			self::$editor_id,
			$data['groups']['authors'],
			'Authors-catalog entries referenced only via stripped contributor ids must be removed.'
		);

		wp_set_current_user( self::$author_b_id );
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/content-graph/nodes' );
		$request->set_param( 'types', 'post' );
		$data = rest_ensure_response( openstation_content_graph_rest_nodes( $request ) )->get_data();
		$node = $this->find_node( $data, $post_id );

		$this->assertContains( self::$editor_id, $node['contributor_ids'] );
		$this->assertArrayHasKey( self::$editor_id, $data['groups']['authors'] );
	}

	public function test_nodes_distinguishes_omitted_types_from_explicit_empty_filter() {
		$post_id = self::factory()->post->create(
			array(
				'post_author' => self::$editor_id,
				'post_status' => 'publish',
				'post_type'   => 'post',
			)
		);
		wp_set_current_user( self::$editor_id );

		$default_request = new WP_REST_Request(
			'GET',
			'/desktop-mode/v1/content-graph/nodes'
		);
		$default_response = rest_get_server()->dispatch( $default_request );
		$this->assertSame( 200, $default_response->get_status() );
		$default_data = $default_response->get_data();
		$this->assertContains(
			$post_id,
			$this->node_ids( $default_data ),
			'Omitting the types parameter must keep the route default of all registered post types.'
		);

		$empty_request = new WP_REST_Request(
			'GET',
			'/desktop-mode/v1/content-graph/nodes'
		);
		$empty_request->set_query_params( array( 'types' => '' ) );
		$empty_response = rest_get_server()->dispatch( $empty_request );
		$this->assertSame( 200, $empty_response->get_status() );
		$empty_data = $empty_response->get_data();
		$this->assertSame( array(), $empty_data['nodes'] );
		$this->assertSame( 0, $empty_data['stats']['nodes'] );
	}

	public function test_post_detail_gates_revisions_on_edit_post() {
		$post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_b_id,
				'post_status' => 'publish',
				'post_type'   => 'post',
			)
		);
		wp_set_current_user( self::$editor_id );
		wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => 'Edited by the editor.',
			)
		);

		self::factory()->comment->create(
			array(
				'comment_post_ID'  => $post_id,
				'user_id'          => self::$author_a_id,
				'comment_approved' => '1',
			)
		);

		wp_set_current_user( self::$author_a_id );
		$data = $this->detail_response( $post_id );

		$this->assertSame(
			array(),
			$data['revisions'],
			'Revision history must require edit_post, matching core wp/v2.'
		);
		$contributor_ids = wp_list_pluck( $data['contributors'], 'id' );
		$this->assertNotContains(
			self::$editor_id,
			$contributor_ids,
			'Revision-author identities must require edit_post.'
		);
		$this->assertContains(
			self::$author_a_id,
			$contributor_ids,
			'Comment-author contributors are public and must remain.'
		);

		wp_set_current_user( self::$author_b_id );
		$data = $this->detail_response( $post_id );

		$this->assertNotEmpty( $data['revisions'] );
		$this->assertContains( self::$editor_id, wp_list_pluck( $data['contributors'], 'id' ) );
	}

	public function test_post_types_counts_scope_private_to_readable() {
		self::factory()->post->create(
			array(
				'post_author' => self::$author_b_id,
				'post_status' => 'publish',
				'post_type'   => 'post',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$author_b_id,
				'post_status' => 'private',
				'post_type'   => 'post',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$author_a_id,
				'post_status' => 'private',
				'post_type'   => 'post',
			)
		);

		wp_set_current_user( self::$author_a_id );
		$this->assertSame(
			2,
			$this->post_type_count( 'post' ),
			'Counts must cover publish + the viewer\'s own private posts only.'
		);

		wp_set_current_user( self::$editor_id );
		$this->assertSame(
			3,
			$this->post_type_count( 'post' ),
			'A user with read_private_posts counts every private post.'
		);
	}

	protected function detail_response( $post_id ) {
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/content-graph/post/' . $post_id );
		$request->set_param( 'id', $post_id );
		$response = openstation_content_graph_rest_post_detail( $request );
		$this->assertNotWPError( $response );
		return rest_ensure_response( $response )->get_data();
	}

	protected function post_type_count( $slug ) {
		$data = rest_ensure_response( openstation_content_graph_rest_post_types() )->get_data();
		foreach ( $data as $entry ) {
			if ( $slug === $entry['slug'] ) {
				return (int) $entry['count'];
			}
		}
		$this->fail( "No /post-types entry for '{$slug}'." );
	}

	protected function node_ids( $payload ) {
		return array_map( 'intval', wp_list_pluck( $payload['nodes'], 'id' ) );
	}

	protected function find_node( $payload, $post_id ) {
		foreach ( $payload['nodes'] as $node ) {
			if ( (int) $node['id'] === (int) $post_id ) {
				return $node;
			}
		}
		$this->fail( "No node for post {$post_id} in payload." );
	}
}
