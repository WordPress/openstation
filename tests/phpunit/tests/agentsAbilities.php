<?php
/**
 * Tests for the agent-oriented abilities — registration annotations
 * and the `desktop-mode/get-media` execute/permission lifecycle.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-agents
 */
class Tests_DesktopMode_AgentsAbilities extends WP_UnitTestCase {

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

	/**
	 * All three agent abilities register under the desktop-mode
	 * category with truthful readonly annotations.
	 *
	 * @covers ::desktop_mode_agents_register_abilities
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
			$this->assertSame( 'desktop-mode', $ability->get_category(), "{$name} category" );
			$meta        = (array) $ability->get_meta();
			$annotations = isset( $meta['annotations'] ) ? (array) $meta['annotations'] : array();
			$this->assertSame( $readonly, ! empty( $annotations['readonly'] ), "{$name} readonly annotation" );
		}
	}

	/**
	 * @covers ::desktop_mode_agents_ability_get_media
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
	 * @covers ::desktop_mode_agents_ability_get_media_can
	 */
	public function test_get_media_denied_without_upload_files() {
		wp_set_current_user( self::$subscriber_id );

		$out = wp_get_ability( 'desktop-mode/get-media' )->execute(
			array( 'attachment_id' => self::$attachment_id )
		);

		$this->assertWPError( $out );
	}

	/**
	 * @covers ::desktop_mode_agents_ability_get_media
	 */
	public function test_get_media_unknown_id_errors() {
		wp_set_current_user( self::$author_id );

		$out = wp_get_ability( 'desktop-mode/get-media' )->execute(
			array( 'attachment_id' => 999999 )
		);

		$this->assertWPError( $out );
		$this->assertSame( 'desktop_mode_agent_media_not_found', $out->get_error_code() );
	}

	/**
	 * A non-attachment post id is refused — the ability reads media,
	 * not arbitrary posts.
	 *
	 * @covers ::desktop_mode_agents_ability_get_media
	 */
	public function test_get_media_rejects_non_attachment() {
		wp_set_current_user( self::$author_id );

		$out = wp_get_ability( 'desktop-mode/get-media' )->execute(
			array( 'attachment_id' => self::$post_id )
		);

		$this->assertWPError( $out );
		$this->assertSame( 'desktop_mode_agent_media_not_found', $out->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_agents_ability_update_media
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
	 * @covers ::desktop_mode_agents_ability_update_media_can
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
	 * @covers ::desktop_mode_agents_ability_create_post
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
	 * @covers ::desktop_mode_agents_ability_create_post_can
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
	 * @covers ::desktop_mode_agent_runner_dispatch_tool
	 */
	public function test_agent_can_dispatch_get_media() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$agent = desktop_mode_agent_create(
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
			'desktop_mode_agent_runner_generate',
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

		$result = desktop_mode_agent_invoke( $agent->ID, 'Describe the image.' );

		$this->assertNotWPError( $result );
		$this->assertCount( 1, $result['toolCalls'] );
		$call = $result['toolCalls'][0];
		$this->assertSame( 'desktop-mode/get-media', $call['name'] );
		$this->assertNull( $call['error'] );
		$this->assertSame( 'image/jpeg', $call['output']['mime'] );
	}
}
