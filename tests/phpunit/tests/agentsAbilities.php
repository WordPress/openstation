<?php
/**
 * Tests for the agent-oriented abilities — registration annotations,
 * the `desktop-mode/get-post` read gates and the `desktop-mode/get-media`
 * execute/permission lifecycle.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-agents
 */
class Tests_OpenStation_AgentsAbilities extends WP_UnitTestCase {

	protected static $author_id;
	protected static $subscriber_id;
	protected static $post_id;
	protected static $attachment_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$author_id     = $factory->user->create( array( 'role' => 'author' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
		self::$post_id       = $factory->post->create( array( 'post_status' => 'publish' ) );
		self::$attachment_id = $factory->attachment->create_object(
			'profile-photo.jpg',
			self::$post_id,
			array(
				'post_mime_type' => 'image/jpeg',
				'post_title'     => 'Profile photo',
				'post_excerpt'   => 'A caption.',
			)
		);
		update_post_meta( self::$attachment_id, '_wp_attachment_image_alt', 'Portrait' );
	}

	public function set_up() {
		parent::set_up();
		if ( ! function_exists( 'wp_get_ability' ) ) {
			$this->markTestSkipped( 'Abilities API not available (requires WordPress 7.0+).' );
		}
	}

	public function tear_down() {
		unregister_post_type( 'os_test_ledger' );
		parent::tear_down();
	}

	/**
	 * All three agent abilities register under the openstation
	 * category with truthful readonly annotations.
	 *
	 * @covers ::openstation_agents_register_abilities
	 */
	public function test_registration_and_annotations() {
		$expectations = array(
			'desktop-mode/get-post'     => true,
			'desktop-mode/get-media'    => true,
			'desktop-mode/update-post'  => false,
			'desktop-mode/update-media' => false,
			'desktop-mode/create-post'  => false,
		);
		foreach ( $expectations as $name => $readonly ) {
			$ability = wp_get_ability( $name );
			$this->assertInstanceOf( 'WP_Ability', $ability, "{$name} should be registered." );
			$this->assertSame( 'openstation', $ability->get_category(), "{$name} category" );
			$meta        = (array) $ability->get_meta();
			$annotations = isset( $meta['annotations'] ) ? (array) $meta['annotations'] : array();
			$this->assertSame( $readonly, ! empty( $annotations['readonly'] ), "{$name} readonly annotation" );
		}
	}

	/**
	 * A Subscriber can read the body of a plain published post — the
	 * baseline the password check must not break.
	 *
	 * @covers ::openstation_agents_ability_get_post
	 * @covers ::openstation_agents_ability_get_post_can
	 */
	public function test_get_post_returns_body_for_subscriber_on_public_post() {
		wp_set_current_user( self::$subscriber_id );

		$out = wp_get_ability( 'desktop-mode/get-post' )->execute(
			array( 'post_id' => self::$post_id )
		);

		$this->assertNotWPError( $out );
		$this->assertSame( self::$post_id, $out['id'] );
	}

	/**
	 * A password-protected post's body stays sealed from a Subscriber:
	 * `read_post` covers visibility, never the password.
	 *
	 * @covers ::openstation_agents_ability_get_post_can
	 */
	public function test_get_post_denies_subscriber_on_password_protected_post() {
		$protected_id = self::factory()->post->create(
			array(
				'post_status'   => 'publish',
				'post_password' => 'hunter2',
				'post_content'  => 'Secret body.',
			)
		);
		wp_set_current_user( self::$subscriber_id );

		$out = wp_get_ability( 'desktop-mode/get-post' )->execute(
			array( 'post_id' => $protected_id )
		);

		$this->assertWPError( $out );
	}

	/**
	 * A caller who can edit the post still reads its raw body even when
	 * it carries a password — the same escape hatch Core grants.
	 *
	 * @covers ::openstation_agents_ability_get_post_can
	 */
	public function test_get_post_allows_editor_on_password_protected_post() {
		$protected_id = self::factory()->post->create(
			array(
				'post_status'   => 'publish',
				'post_password' => 'hunter2',
				'post_content'  => 'Secret body.',
			)
		);
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$out = wp_get_ability( 'desktop-mode/get-post' )->execute(
			array( 'post_id' => $protected_id )
		);

		$this->assertNotWPError( $out );
		$this->assertSame( 'Secret body.', $out['content'] );
	}

	/**
	 * get-post follows Core's single-read rule for post types without a
	 * public front end: a published row of such a type is read only by a
	 * caller who can edit it, because `read_post` on a published row
	 * resolves to plain `read`. Refused for a Subscriber, and the body
	 * does not come back.
	 *
	 * @covers ::openstation_agents_ability_get_post_can
	 */
	public function test_get_post_denies_subscriber_on_non_viewable_post_type() {
		$ledger_id = $this->create_non_viewable_post();
		wp_set_current_user( self::$subscriber_id );

		$out = wp_get_ability( 'desktop-mode/get-post' )->execute(
			array( 'post_id' => $ledger_id )
		);

		$this->assertWPError( $out );
		$this->assertSame( 'ability_invalid_permissions', $out->get_error_code() );
		$this->assertStringNotContainsString( 'Ledger body.', (string) wp_json_encode( $out->get_all_error_data() ) );
	}

	/**
	 * The same row reads normally for a caller holding `edit_post` on it.
	 *
	 * @covers ::openstation_agents_ability_get_post_can
	 */
	public function test_get_post_allows_editor_on_non_viewable_post_type() {
		$ledger_id = $this->create_non_viewable_post();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$out = wp_get_ability( 'desktop-mode/get-post' )->execute(
			array( 'post_id' => $ledger_id )
		);

		$this->assertNotWPError( $out );
		$this->assertSame( 'Ledger body.', $out['content'] );
	}

	/**
	 * A published row of a registered post type with no public front end.
	 *
	 * @return int Post id.
	 */
	private function create_non_viewable_post() {
		register_post_type(
			'os_test_ledger',
			array(
				'public'       => false,
				'map_meta_cap' => true,
			)
		);
		$this->assertFalse( is_post_type_viewable( 'os_test_ledger' ) );
		return self::factory()->post->create(
			array(
				'post_type'    => 'os_test_ledger',
				'post_status'  => 'publish',
				'post_content' => 'Ledger body.',
			)
		);
	}

	/**
	 * @covers ::openstation_agents_ability_get_media
	 */
	public function test_get_media_returns_details_for_author() {
		wp_set_current_user( self::$author_id );

		$out = wp_get_ability( 'desktop-mode/get-media' )->execute(
			array( 'attachment_id' => self::$attachment_id )
		);

		$this->assertNotWPError( $out );
		$this->assertSame( self::$attachment_id, $out['id'] );
		$this->assertSame( 'Profile photo', $out['title'] );
		$this->assertSame( 'image/jpeg', $out['mime'] );
		$this->assertStringContainsString( 'profile-photo.jpg', $out['url'] );
		$this->assertSame( 'Portrait', $out['alt'] );
		$this->assertSame( 'A caption.', $out['caption'] );
		$this->assertSame( self::$post_id, $out['attachedTo'] );
	}

	/**
	 * `upload_files` is the gate — a subscriber-role caller (or agent)
	 * is refused by the ability's own permission callback.
	 *
	 * @covers ::openstation_agents_ability_get_media_can
	 */
	public function test_get_media_denied_without_upload_files() {
		wp_set_current_user( self::$subscriber_id );

		$out = wp_get_ability( 'desktop-mode/get-media' )->execute(
			array( 'attachment_id' => self::$attachment_id )
		);

		$this->assertWPError( $out );
	}

	/**
	 * get-media applies Core's rule for attached media: a file attached
	 * to a post defers to that post's readability. An Author holding
	 * `upload_files` is refused a file attached to someone else's private
	 * post, and neither the caption nor the parent id comes back.
	 *
	 * @covers ::openstation_agents_ability_get_media_can
	 */
	public function test_get_media_denied_when_parent_post_is_unreadable() {
		$private_parent = self::factory()->post->create(
			array(
				'post_status' => 'private',
				'post_author' => self::factory()->user->create( array( 'role' => 'editor' ) ),
			)
		);
		$attachment_id  = self::factory()->attachment->create_object(
			'board-minutes.pdf',
			$private_parent,
			array(
				'post_mime_type' => 'application/pdf',
				'post_title'     => 'Board minutes',
				'post_excerpt'   => 'Private caption.',
			)
		);
		wp_set_current_user( self::$author_id );

		$out = wp_get_ability( 'desktop-mode/get-media' )->execute(
			array( 'attachment_id' => $attachment_id )
		);

		$this->assertWPError( $out );
		$this->assertSame( 'ability_invalid_permissions', $out->get_error_code() );
		$this->assertStringNotContainsString( 'Private caption.', (string) wp_json_encode( $out->get_all_error_data() ) );
	}

	/**
	 * @covers ::openstation_agents_ability_get_media
	 */
	public function test_get_media_unknown_id_errors() {
		wp_set_current_user( self::$author_id );

		$out = wp_get_ability( 'desktop-mode/get-media' )->execute(
			array( 'attachment_id' => 999999 )
		);

		$this->assertWPError( $out );
		$this->assertSame( 'openstation_agent_media_not_found', $out->get_error_code() );
	}

	/**
	 * A non-attachment post id is refused — the ability reads media,
	 * not arbitrary posts.
	 *
	 * @covers ::openstation_agents_ability_get_media
	 */
	public function test_get_media_rejects_non_attachment() {
		wp_set_current_user( self::$author_id );

		$out = wp_get_ability( 'desktop-mode/get-media' )->execute(
			array( 'attachment_id' => self::$post_id )
		);

		$this->assertWPError( $out );
		$this->assertSame( 'openstation_agent_media_not_found', $out->get_error_code() );
	}

	/**
	 * @covers ::openstation_agents_ability_update_media
	 */
	public function test_update_media_writes_alt_and_title() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$out = wp_get_ability( 'desktop-mode/update-media' )->execute(
			array(
				'attachment_id' => self::$attachment_id,
				'alt_text'      => 'A person smiling at the camera',
				'title'         => 'Portrait, cropped',
			)
		);

		$this->assertNotWPError( $out );
		$this->assertTrue( $out['updated'] );
		$this->assertSame(
			'A person smiling at the camera',
			get_post_meta( self::$attachment_id, '_wp_attachment_image_alt', true )
		);
		$this->assertSame( 'Portrait, cropped', get_post( self::$attachment_id )->post_title );
	}

	/**
	 * Editing someone else's attachment requires the same capability
	 * wp-admin does — an author-role caller who doesn't own it is
	 * refused.
	 *
	 * @covers ::openstation_agents_ability_update_media_can
	 */
	public function test_update_media_denied_without_edit_capability() {
		wp_set_current_user( self::$author_id );

		$out = wp_get_ability( 'desktop-mode/update-media' )->execute(
			array(
				'attachment_id' => self::$attachment_id,
				'alt_text'      => 'nope',
			)
		);
		$this->assertWPError( $out );
	}

	/**
	 * @covers ::openstation_agents_ability_create_post
	 */
	public function test_create_post_is_always_a_draft_by_the_caller() {
		wp_set_current_user( self::$author_id );

		$out = wp_get_ability( 'desktop-mode/create-post' )->execute(
			array(
				'title'   => 'Traducción: hola',
				'content' => '<p>Contenido traducido.</p>',
			)
		);

		$this->assertNotWPError( $out );
		$this->assertSame( 'draft', $out['status'] );

		$post = get_post( $out['id'] );
		$this->assertSame( 'draft', $post->post_status );
		$this->assertSame( 'post', $post->post_type );
		$this->assertSame( self::$author_id, (int) $post->post_author );
		$this->assertSame( 'Traducción: hola', $post->post_title );
	}

	/**
	 * Page creation gates on `edit_pages`, which authors lack.
	 *
	 * @covers ::openstation_agents_ability_create_post_can
	 */
	public function test_create_page_denied_for_authors() {
		wp_set_current_user( self::$author_id );

		$out = wp_get_ability( 'desktop-mode/create-post' )->execute(
			array(
				'title'   => 'Nope',
				'content' => 'x',
				'type'    => 'page',
			)
		);
		$this->assertWPError( $out );
	}

	/**
	 * An agent whose allowlist includes get-media can read media
	 * through the runner when its role carries `upload_files`.
	 *
	 * @covers ::openstation_agent_runner_dispatch_tool
	 */
	public function test_agent_can_dispatch_get_media() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$agent = openstation_agent_create(
			array(
				'name'      => 'Media Reader',
				'role'      => 'author',
				'abilities' => array( 'desktop-mode/get-media' ),
			)
		);
		$this->assertNotWPError( $agent );

		$attachment_id = self::$attachment_id;
		$turn          = 0;
		add_filter(
			'openstation_agent_runner_generate',
			static function () use ( &$turn, $attachment_id ) {
				++$turn;
				if ( 1 === $turn ) {
					return array(
						'text'           => null,
						'function_calls' => array(
							array(
								'name'      => 'get_media',
								'call_id'   => 'c1',
								'arguments' => wp_json_encode( array( 'attachment_id' => $attachment_id ) ),
							),
						),
						'message'        => null,
					);
				}
				return array(
					'text'           => 'read it',
					'function_calls' => array(),
					'message'        => null,
				);
			}
		);

		$result = openstation_agent_invoke( $agent->ID, 'Describe the image.' );

		$this->assertNotWPError( $result );
		$this->assertCount( 1, $result['toolCalls'] );
		$call = $result['toolCalls'][0];
		$this->assertSame( 'desktop-mode/get-media', $call['name'] );
		$this->assertNull( $call['error'] );
		$this->assertSame( 'image/jpeg', $call['output']['mime'] );
	}
}
