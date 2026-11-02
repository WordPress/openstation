<?php
/**
 * Security regressions for the agents, AI, Content Graph and WP
 * Explorer read paths.
 *
 * Each test gives a low-capability caller a restricted object and
 * asserts on what does NOT come back, in the shape the read-path
 * checklist in `docs/agents-security.md` asks for.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-security
 */
class Tests_OpenStation_SecurityAgentsAi extends WP_UnitTestCase {

	protected static $editor_id;
	protected static $author_id;
	protected static $contributor_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$editor_id      = $factory->user->create( array( 'role' => 'editor' ) );
		self::$author_id      = $factory->user->create( array( 'role' => 'author' ) );
		self::$contributor_id = $factory->user->create( array( 'role' => 'contributor' ) );
		self::$subscriber_id  = $factory->user->create(
			array(
				'role'         => 'subscriber',
				'display_name' => 'Sam Commenter',
			)
		);
	}

	public function set_up() {
		parent::set_up();
		if ( function_exists( 'openstation_content_graph_flush_cache' ) ) {
			openstation_content_graph_flush_cache();
		}
	}

	public function tear_down() {
		unregister_post_type( 'os_sec_ledger' );
		unregister_post_type( 'os_sec_review' );
		parent::tear_down();
	}

	/*
	 * ------------------------------------------------------------------
	 * Content Graph — /content-graph/post/<id>
	 * ------------------------------------------------------------------
	 */

	/**
	 * A published post with a password and one approved comment by a
	 * registered user.
	 *
	 * @param string $password Post password ('' for none).
	 * @return int Post id.
	 */
	protected function make_commented_post( $password ) {
		$post_id = self::factory()->post->create(
			array(
				'post_author'   => self::$editor_id,
				'post_status'   => 'publish',
				'post_password' => $password,
				'post_title'    => 'Members briefing',
			)
		);
		self::factory()->comment->create(
			array(
				'comment_post_ID'  => $post_id,
				'comment_approved' => '1',
				'comment_content'  => 'The sealed launch date is the 14th.',
				'user_id'          => self::$subscriber_id,
			)
		);
		return $post_id;
	}

	/**
	 * Detail payload for one post as the current user.
	 *
	 * @param int $post_id Post id.
	 * @return array|WP_Error
	 */
	protected function graph_detail( $post_id ) {
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/content-graph/post/' . $post_id );
		$request->set_url_params( array( 'id' => $post_id ) );
		$response = openstation_content_graph_rest_post_detail( $request );
		return is_wp_error( $response ) ? $response : $response->get_data();
	}

	/**
	 * The comments of a password-protected post stay sealed for a
	 * Contributor, as Core's comments controller keeps them, and the
	 * comment authors listed as contributors go with them.
	 *
	 * @covers ::openstation_content_graph_rest_post_detail
	 * @covers ::openstation_content_graph_collect_contributors
	 */
	public function test_content_graph_detail_withholds_comments_of_sealed_post() {
		$post_id = $this->make_commented_post( 'hunter2' );

		wp_set_current_user( self::$contributor_id );
		$data = $this->graph_detail( $post_id );

		$this->assertIsArray( $data, 'The node itself stays readable: its title is public.' );
		$this->assertSame( array(), $data['comments'], 'Comments on a sealed post must not reach a Contributor.' );
		$this->assertNotContains(
			self::$subscriber_id,
			wp_list_pluck( $data['contributors'], 'id' ),
			'A sealed post must not name its commenters.'
		);
	}

	/**
	 * Baseline: an unsealed post's comments still come back, and an
	 * editor of the sealed post still sees its discussion.
	 *
	 * @covers ::openstation_content_graph_rest_post_detail
	 */
	public function test_content_graph_detail_keeps_comments_where_readable() {
		$open_id   = $this->make_commented_post( '' );
		$sealed_id = $this->make_commented_post( 'hunter2' );

		wp_set_current_user( self::$contributor_id );
		$this->assertCount( 1, $this->graph_detail( $open_id )['comments'] );

		wp_set_current_user( self::$editor_id );
		$this->assertCount( 1, $this->graph_detail( $sealed_id )['comments'] );
	}

	/**
	 * A published row of a type with no readable front end is refused
	 * to a caller who cannot edit it, though `read_post` maps to `read`.
	 *
	 * @covers ::openstation_content_graph_rest_post_detail
	 */
	public function test_content_graph_detail_refuses_non_viewable_type() {
		register_post_type(
			'os_sec_ledger',
			array(
				'public'          => false,
				'show_ui'         => true,
				'capability_type' => 'post',
				'map_meta_cap'    => true,
			)
		);
		$ledger_id = self::factory()->post->create(
			array(
				'post_type'   => 'os_sec_ledger',
				'post_status' => 'publish',
				'post_author' => self::$editor_id,
				'post_title'  => 'Refund for J. Doe',
			)
		);

		wp_set_current_user( self::$contributor_id );
		$this->assertTrue( current_user_can( 'read_post', $ledger_id ), 'Fixture: read_post resolves to read.' );
		$result = $this->graph_detail( $ledger_id );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_content_graph_forbidden', $result->get_error_code() );

		wp_set_current_user( self::$editor_id );
		$this->assertIsArray( $this->graph_detail( $ledger_id ) );
	}

	/**
	 * Edges leaving a sealed post are links read out of its body, so
	 * they are dropped for a caller who cannot read that body — and
	 * the edge count drops with them.
	 *
	 * @covers ::openstation_content_graph_filter_payload_for_user
	 * @covers ::openstation_content_graph_filter_sealed_edges
	 */
	public function test_content_graph_nodes_drop_edges_out_of_sealed_body() {
		$sealed_id = self::factory()->post->create(
			array(
				'post_author'   => self::$editor_id,
				'post_status'   => 'publish',
				'post_password' => 'hunter2',
			)
		);
		$open_id   = self::factory()->post->create(
			array(
				'post_author' => self::$editor_id,
				'post_status' => 'publish',
			)
		);
		$target_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );

		$payload = array(
			'nodes'  => array(
				array(
					'id'              => $sealed_id,
					'author_id'       => self::$editor_id,
					'contributor_ids' => array(),
				),
				array(
					'id'              => $open_id,
					'author_id'       => self::$editor_id,
					'contributor_ids' => array(),
				),
				array(
					'id'              => $target_id,
					'author_id'       => 0,
					'contributor_ids' => array(),
				),
			),
			'edges'  => array(
				array(
					'from' => $sealed_id,
					'to'   => $target_id,
				),
				array(
					'from' => $open_id,
					'to'   => $target_id,
				),
			),
			'groups' => array( 'authors' => array() ),
			'stats'  => array( 'edges' => 2 ),
		);

		wp_set_current_user( self::$contributor_id );
		$filtered = openstation_content_graph_filter_payload_for_user( $payload );
		$this->assertSame( array( $open_id ), wp_list_pluck( $filtered['edges'], 'from' ) );
		$this->assertSame( 1, $filtered['stats']['edges'], 'The counter must cover the same set as the edges.' );

		wp_set_current_user( self::$editor_id );
		$this->assertCount( 2, openstation_content_graph_filter_payload_for_user( $payload )['edges'] );
	}

	/*
	 * ------------------------------------------------------------------
	 * WP Explorer — `openstation_attached_media` REST field
	 * ------------------------------------------------------------------
	 */

	/**
	 * A sealed post whose body embeds one image and whose featured image
	 * is another.
	 *
	 * @return array{0:int,1:int,2:int} Post id, body image id, featured id.
	 */
	protected function make_sealed_post_with_media() {
		$post_id  = self::factory()->post->create(
			array(
				'post_author'   => self::$editor_id,
				'post_status'   => 'publish',
				'post_password' => 'hunter2',
			)
		);
		$body_id  = self::factory()->attachment->create_object(
			'sealed-floorplan.jpg',
			0,
			array( 'post_mime_type' => 'image/jpeg' )
		);
		$thumb_id = self::factory()->attachment->create_object(
			'cover.jpg',
			0,
			array( 'post_mime_type' => 'image/jpeg' )
		);
		wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => '<!-- wp:image {"id":' . $body_id . '} --><figure class="wp-block-image"><img class="wp-image-' . $body_id . '" alt=""/></figure><!-- /wp:image -->',
			)
		);
		update_post_meta( $post_id, '_thumbnail_id', $thumb_id );
		return array( $post_id, $body_id, $thumb_id );
	}

	/**
	 * Logged out, `wp/v2/posts/<id>` must not carry ids read out of a
	 * sealed body — only the featured image Core already exposes.
	 *
	 * @covers ::openstation_my_wordpress_rest_attached_media
	 * @covers ::openstation_my_wordpress_register_attached_media_field
	 */
	public function test_attached_media_field_hides_sealed_body_from_anonymous() {
		list( $post_id, $body_id, $thumb_id ) = $this->make_sealed_post_with_media();

		wp_set_current_user( 0 );
		$request  = new WP_REST_Request( 'GET', '/wp/v2/posts/' . $post_id );
		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();

		$this->assertArrayHasKey( 'openstation_attached_media', $data );
		$this->assertNotContains( $body_id, $data['openstation_attached_media'], 'A sealed body must not leak its attachment ids.' );
		$this->assertSame( array( $thumb_id ), $data['openstation_attached_media'] );
	}

	/**
	 * The three ways in Core offers still open the list: the right
	 * password, and the edit capability. A wrong password does not.
	 *
	 * @covers ::openstation_my_wordpress_rest_attached_media
	 */
	public function test_attached_media_field_opens_with_password_or_edit() {
		list( $post_id, $body_id ) = $this->make_sealed_post_with_media();

		wp_set_current_user( self::$subscriber_id );
		$wrong = new WP_REST_Request( 'GET', '/wp/v2/posts/' . $post_id );
		$wrong->set_query_params( array( 'password' => 'nope' ) );
		$this->assertNotContains( $body_id, openstation_my_wordpress_rest_attached_media( $post_id, $wrong ) );

		$right = new WP_REST_Request( 'GET', '/wp/v2/posts/' . $post_id );
		$right->set_query_params( array( 'password' => 'hunter2' ) );
		$this->assertContains( $body_id, openstation_my_wordpress_rest_attached_media( $post_id, $right ) );

		wp_set_current_user( self::$editor_id );
		$this->assertContains( $body_id, openstation_my_wordpress_rest_attached_media( $post_id ) );
	}

	/*
	 * ------------------------------------------------------------------
	 * Agents — `desktop-mode/update-post`
	 * ------------------------------------------------------------------
	 */

	/**
	 * Making a post private is publishing it (Core's REST posts
	 * controller asks `publish_posts` for both), so a Contributor cannot
	 * file their own draft as private and skip review.
	 *
	 * @covers ::openstation_agents_ability_update_post_can
	 */
	public function test_update_post_private_requires_publish_capability() {
		if ( ! function_exists( 'openstation_agents_ability_update_post_can' ) ) {
			$this->markTestSkipped( 'Agents module not loaded.' );
		}
		$draft_id = self::factory()->post->create(
			array(
				'post_author' => self::$contributor_id,
				'post_status' => 'draft',
			)
		);

		wp_set_current_user( self::$contributor_id );
		$this->assertFalse(
			openstation_agents_ability_update_post_can(
				array(
					'post_id' => $draft_id,
					'status'  => 'private',
				)
			)
		);
		$this->assertTrue(
			openstation_agents_ability_update_post_can(
				array(
					'post_id' => $draft_id,
					'status'  => 'pending',
				)
			),
			'Submitting for review stays allowed.'
		);

		$own_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'draft',
			)
		);
		wp_set_current_user( self::$author_id );
		$this->assertTrue(
			openstation_agents_ability_update_post_can(
				array(
					'post_id' => $own_id,
					'status'  => 'private',
				)
			),
			'An Author holds publish_posts and may still make a post private.'
		);
	}

	/**
	 * The publish gate asks the post TYPE's publish capability, not the
	 * generic `publish_posts`: an Author who holds `publish_posts` but
	 * not a custom type's publish cap cannot publish that type.
	 *
	 * @covers ::openstation_agents_ability_update_post_can
	 */
	public function test_update_post_publish_uses_post_type_capability() {
		if ( ! function_exists( 'openstation_agents_ability_update_post_can' ) ) {
			$this->markTestSkipped( 'Agents module not loaded.' );
		}
		register_post_type(
			'os_sec_review',
			array(
				'public'          => true,
				'capability_type' => 'post',
				'map_meta_cap'    => true,
				'capabilities'    => array( 'publish_posts' => 'publish_os_sec_reviews' ),
			)
		);
		$review_id = self::factory()->post->create(
			array(
				'post_type'   => 'os_sec_review',
				'post_author' => self::$author_id,
				'post_status' => 'draft',
			)
		);

		wp_set_current_user( self::$author_id );
		$this->assertTrue( current_user_can( 'edit_post', $review_id ), 'Fixture: the author can edit the draft.' );
		$this->assertTrue( current_user_can( 'publish_posts' ), 'Fixture: the author holds the generic cap.' );
		foreach ( array( 'publish', 'private' ) as $status ) {
			$this->assertFalse(
				openstation_agents_ability_update_post_can(
					array(
						'post_id' => $review_id,
						'status'  => $status,
					)
				),
				"Status {$status} needs the type's own publish capability."
			);
		}
	}

	/*
	 * ------------------------------------------------------------------
	 * WooCommerce — `openstation_woo` on `wp/v2/product`
	 * ------------------------------------------------------------------
	 */

	/**
	 * Exact stock levels are not handed to anyone who can list products
	 * — logged out callers and Subscribers get `null`.
	 *
	 * @covers ::openstation_my_wordpress_woo_register_rest_field
	 */
	public function test_woo_product_field_withholds_stock_from_outside_the_window() {
		if ( ! function_exists( 'openstation_my_wordpress_woo_active' ) || ! openstation_my_wordpress_woo_active() || ! class_exists( 'WC_Product_Simple' ) ) {
			$this->markTestSkipped( 'WooCommerce not active.' );
		}
		$product = new WC_Product_Simple();
		$product->set_name( 'Limited print' );
		$product->set_status( 'publish' );
		$product->set_manage_stock( true );
		$product->set_stock_quantity( 7 );
		$product_id = $product->save();

		foreach ( array( 0, self::$subscriber_id ) as $user_id ) {
			wp_set_current_user( $user_id );
			$response = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/wp/v2/product/' . $product_id ) );
			$this->assertSame( 200, $response->get_status() );
			$data = $response->get_data();
			$this->assertArrayHasKey( 'openstation_woo', $data );
			$this->assertNull( $data['openstation_woo'], "User {$user_id} must not receive stock facts." );
		}

		wp_set_current_user( self::$editor_id );
		$data = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/wp/v2/product/' . $product_id ) )->get_data();
		$this->assertSame( 7, $data['openstation_woo']['stockLevel'] );
	}

	/**
	 * The field follows the product type's own capabilities, not only
	 * the window gate: a Contributor can open WP Explorer but may not
	 * read inventory counts. Runs without WooCommerce by registering a
	 * `product` type with Woo's capability shape.
	 *
	 * @covers ::openstation_my_wordpress_woo_field_viewer_can_read
	 */
	public function test_woo_product_field_gate_asks_the_product_capabilities() {
		if ( ! function_exists( 'openstation_my_wordpress_woo_field_viewer_can_read' ) ) {
			$this->markTestSkipped( 'WooCommerce integration not loaded.' );
		}
		$registered = false;
		if ( ! post_type_exists( 'product' ) ) {
			register_post_type(
				'product',
				array(
					'capability_type' => 'product',
					'map_meta_cap'    => true,
				)
			);
			$registered = true;
		}

		wp_set_current_user( self::$contributor_id );
		$this->assertFalse( openstation_my_wordpress_woo_field_viewer_can_read(), 'The window gate alone is not enough.' );

		$manager = self::factory()->user->create( array( 'role' => 'editor' ) );
		get_userdata( $manager )->add_cap( 'edit_products' );
		wp_set_current_user( $manager );
		$this->assertTrue( openstation_my_wordpress_woo_field_viewer_can_read() );

		if ( $registered ) {
			unregister_post_type( 'product' );
		}
	}

	/*
	 * ------------------------------------------------------------------
	 * Agent conversations vs the generic post abilities
	 * ------------------------------------------------------------------
	 */

	/**
	 * A conversation belongs to the human who had it: the module's own
	 * routes gate on `post_author`. Registered on the default `post`
	 * capabilities, every row (always `publish`) answered `edit_post`
	 * for an Editor, so `desktop-mode/get-post` returned any other
	 * user's transcript and `update-post` rewrote it. The type now maps
	 * every capability to `do_not_allow`.
	 *
	 * @covers ::openstation_agent_conversations_register_post_type
	 * @covers ::openstation_agents_ability_get_post_can
	 * @covers ::openstation_agents_ability_update_post_can
	 */
	public function test_agent_conversations_are_closed_to_the_generic_post_abilities() {
		if ( ! function_exists( 'openstation_agents_ability_get_post_can' ) || ! post_type_exists( OPENSTATION_AGENT_CHAT_POST_TYPE ) ) {
			$this->markTestSkipped( 'Agents module not loaded.' );
		}
		$admin_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$chat_id  = self::factory()->post->create(
			array(
				'post_type'    => OPENSTATION_AGENT_CHAT_POST_TYPE,
				'post_status'  => 'publish',
				'post_author'  => $admin_id,
				'post_content' => '[{"role":"user","text":"TRANSCRIPT-MARKER"}]',
			)
		);
		$post_id  = self::factory()->post->create(
			array(
				'post_author' => $admin_id,
				'post_status' => 'publish',
			)
		);

		wp_set_current_user( self::$editor_id );
		$this->assertFalse( current_user_can( 'edit_post', $chat_id ) );
		$this->assertFalse( current_user_can( 'read_post', $chat_id ) );
		$this->assertFalse( openstation_agents_ability_get_post_can( array( 'post_id' => $chat_id ) ) );
		$this->assertFalse(
			openstation_agents_ability_update_post_can(
				array(
					'post_id' => $chat_id,
					'content' => 'rewritten',
				)
			)
		);
		// Control: an ordinary published post stays open to an Editor.
		$this->assertTrue( openstation_agents_ability_get_post_can( array( 'post_id' => $post_id ) ) );
		$this->assertTrue(
			openstation_agents_ability_update_post_can(
				array(
					'post_id' => $post_id,
					'content' => 'rewritten',
				)
			)
		);

		// The owner reads it through the module's route, never the abilities.
		wp_set_current_user( $admin_id );
		$this->assertFalse( openstation_agents_ability_get_post_can( array( 'post_id' => $chat_id ) ) );
		$this->assertNotNull( openstation_agent_conversation_get_own( $chat_id ) );
	}
}
