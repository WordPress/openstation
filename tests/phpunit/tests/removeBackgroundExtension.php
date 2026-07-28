<?php
/**
 * Tests for the Remove Background extension — ability registration,
 * the execute lifecycle (via the `desktop_mode_remove_background_pre`
 * short-circuit, network-free), and agent-runner dispatch with
 * attribution.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-agents
 */
class Tests_DesktopMode_RemoveBackgroundExtension extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $author_id;
	protected static $subscriber_id;
	protected static $post_id;

	/** 1x1 transparent PNG. */
	const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$author_id     = $factory->user->create( array( 'role' => 'author' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
		self::$post_id       = $factory->post->create( array( 'post_status' => 'publish' ) );
	}

	public function set_up() {
		parent::set_up();
		if ( ! function_exists( 'wp_get_ability' ) || ! wp_get_ability( 'media-tools/remove-background' ) ) {
			$this->markTestSkipped( 'Abilities API not available (requires WordPress 7.0+).' );
		}
	}

	private function tiny_png() {
		return base64_decode( self::TINY_PNG_BASE64 ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
	}

	private function create_source_attachment() {
		$attachment_id = self::factory()->attachment->create_upload_object(
			DIR_TESTDATA . '/images/canola.jpg',
			self::$post_id
		);
		$this->assertGreaterThan( 0, $attachment_id );
		update_post_meta( $attachment_id, '_wp_attachment_image_alt', 'A canola field' );
		return $attachment_id;
	}

	private function stub_backend( $png ) {
		add_filter(
			'desktop_mode_remove_background_pre',
			static function () use ( $png ) {
				return $png;
			}
		);
	}

	/**
	 * @covers ::desktop_mode_remove_bg_register_ability
	 */
	public function test_registration_is_mutating_media_tools() {
		$ability = wp_get_ability( 'media-tools/remove-background' );
		$this->assertInstanceOf( 'WP_Ability', $ability );
		$this->assertSame( 'media-tools', $ability->get_category() );

		$meta        = (array) $ability->get_meta();
		$annotations = isset( $meta['annotations'] ) ? (array) $meta['annotations'] : array();
		$this->assertTrue( empty( $annotations['readonly'] ), 'remove-background must NOT be readonly.' );
	}

	/**
	 * Happy path: a new PNG attachment appears next to the original,
	 * authored by the current user, alt copied, original untouched.
	 *
	 * @covers ::desktop_mode_remove_bg_execute
	 */
	public function test_execute_creates_new_attachment() {
		wp_set_current_user( self::$author_id );
		$source_id = $this->create_source_attachment();
		$this->stub_backend( $this->tiny_png() );

		$out = wp_get_ability( 'media-tools/remove-background' )->execute(
			array( 'attachment_id' => $source_id )
		);

		$this->assertNotWPError( $out );
		$this->assertGreaterThan( 0, $out['id'] );
		$this->assertNotSame( $source_id, $out['id'] );
		$this->assertStringContainsString( '-no-bg', $out['url'] );
		$this->assertSame( $source_id, $out['sourceId'] );
		$this->assertSame( self::$post_id, $out['attachedTo'] );

		$new_post = get_post( $out['id'] );
		$this->assertSame( 'attachment', $new_post->post_type );
		$this->assertSame( 'image/png', $new_post->post_mime_type );
		$this->assertSame( self::$author_id, (int) $new_post->post_author );
		$this->assertSame( self::$post_id, (int) $new_post->post_parent );
		$this->assertSame( 'A canola field', get_post_meta( $out['id'], '_wp_attachment_image_alt', true ) );

		// The original is untouched.
		$this->assertSame( 'image/jpeg', get_post( $source_id )->post_mime_type );
	}

	/**
	 * @covers ::desktop_mode_remove_bg_can
	 */
	public function test_denied_without_upload_files() {
		wp_set_current_user( self::$author_id );
		$source_id = $this->create_source_attachment();
		$this->stub_backend( $this->tiny_png() );

		wp_set_current_user( self::$subscriber_id );
		$out = wp_get_ability( 'media-tools/remove-background' )->execute(
			array( 'attachment_id' => $source_id )
		);
		$this->assertWPError( $out );
	}

	/**
	 * @covers ::desktop_mode_remove_bg_execute
	 */
	public function test_rejects_non_image_attachment() {
		wp_set_current_user( self::$author_id );
		$pdf_id = self::factory()->attachment->create_object(
			'document.pdf',
			self::$post_id,
			array( 'post_mime_type' => 'application/pdf' )
		);
		$this->stub_backend( $this->tiny_png() );

		$out = wp_get_ability( 'media-tools/remove-background' )->execute(
			array( 'attachment_id' => $pdf_id )
		);
		$this->assertWPError( $out );
		$this->assertSame( 'desktop_mode_remove_bg_unsupported_type', $out->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_remove_bg_execute
	 */
	public function test_backend_error_propagates() {
		wp_set_current_user( self::$author_id );
		$source_id = $this->create_source_attachment();
		$this->stub_backend( new WP_Error( 'boom', 'Backend exploded.' ) );

		$out = wp_get_ability( 'media-tools/remove-background' )->execute(
			array( 'attachment_id' => $source_id )
		);
		$this->assertWPError( $out );
		$this->assertSame( 'boom', $out->get_error_code() );
	}

	/**
	 * Default settings (remove.bg, no key) yield a clear
	 * configuration error rather than an HTTP attempt.
	 *
	 * @covers ::desktop_mode_remove_bg_backend_removebg
	 */
	public function test_unconfigured_backend_errors_cleanly() {
		wp_set_current_user( self::$author_id );
		$source_id = $this->create_source_attachment();

		$out = wp_get_ability( 'media-tools/remove-background' )->execute(
			array( 'attachment_id' => $source_id )
		);
		$this->assertWPError( $out );
		$this->assertSame( 'desktop_mode_remove_bg_no_key', $out->get_error_code() );
	}

	/**
	 * Configuration resolves through the filter — there is no settings
	 * UI; option, constants, and this filter are the whole surface.
	 *
	 * @covers ::desktop_mode_remove_bg_get_settings
	 */
	public function test_settings_filter_overrides_backend() {
		wp_set_current_user( self::$author_id );
		$source_id = $this->create_source_attachment();

		add_filter(
			'desktop_mode_remove_background_settings',
			static function ( $settings ) {
				$settings['backend'] = 'rembg';
				return $settings;
			}
		);

		$out = wp_get_ability( 'media-tools/remove-background' )->execute(
			array( 'attachment_id' => $source_id )
		);
		$this->assertWPError( $out );
		$this->assertSame( 'desktop_mode_remove_bg_no_endpoint', $out->get_error_code() );
	}

	/**
	 * An unknown backend slug in the option falls back to the default
	 * instead of dispatching to nothing.
	 *
	 * @covers ::desktop_mode_remove_bg_get_settings
	 */
	public function test_unknown_backend_falls_back_to_default() {
		update_option( DESKTOP_MODE_REMOVE_BG_OPTION, array( 'backend' => 'bogus' ) );
		$settings = desktop_mode_remove_bg_get_settings();
		$this->assertSame( 'removebg', $settings['backend'] );
	}

	/**
	 * The full agent story: an agent allowlisted for the ability
	 * dispatches it through the runner, and the resulting attachment
	 * is authored by the AGENT user — the audit-trail promise.
	 *
	 * @covers ::desktop_mode_agent_runner_dispatch_tool
	 */
	public function test_agent_dispatch_attributes_new_attachment_to_agent() {
		wp_set_current_user( self::$admin_id );
		$source_id = $this->create_source_attachment();
		$this->stub_backend( $this->tiny_png() );

		$agent = desktop_mode_agent_create(
			array(
				'name'      => 'Remove BG',
				'role'      => 'author',
				'abilities' => array( 'media-tools/remove-background' ),
			)
		);
		$this->assertNotWPError( $agent );

		$turn = 0;
		add_filter(
			'desktop_mode_agent_runner_generate',
			static function () use ( &$turn, $source_id ) {
				++$turn;
				if ( 1 === $turn ) {
					return array(
						'text'           => null,
						'function_calls' => array(
							array(
								'name'      => 'remove_background',
								'call_id'   => 'c1',
								'arguments' => wp_json_encode( array( 'attachment_id' => $source_id ) ),
							),
						),
						'message'        => null,
					);
				}
				return array(
					'text'           => 'Background removed.',
					'function_calls' => array(),
					'message'        => null,
				);
			},
			10,
			5
		);

		$result = desktop_mode_agent_invoke( $agent->ID, 'Remove the background of my pic.' );

		$this->assertNotWPError( $result );
		$call = $result['toolCalls'][0];
		$this->assertSame( 'media-tools/remove-background', $call['name'] );
		$this->assertNull( $call['error'] );

		$new_id = (int) $call['output']['id'];
		$this->assertSame(
			(int) $agent->ID,
			(int) get_post( $new_id )->post_author,
			'The processed attachment must be attributed to the agent user.'
		);
	}
}
