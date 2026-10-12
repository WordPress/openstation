<?php
/**
 * Tests for the AI Copilot search loop — network-free via the
 * `openstation_ai_search_generate` pre-filter, which scripts the model's
 * turns.
 *
 * Pins the out-of-rounds behaviour: a run that never answers on its own
 * ends with a toolless wrap-up turn built from everything it found,
 * instead of discarding it for the stock "couldn't find" message.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-ai
 */
class Tests_OpenStation_AiSearchLoop extends WP_UnitTestCase {

	protected static $admin_id;

	/**
	 * Every turn the scripted model was asked for, in order.
	 *
	 * @var array[]
	 */
	private $turns = array();

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
		$factory->post->create(
			array(
				'post_title'   => 'PlayStation 5 Pro',
				'post_content' => 'A subtle performance boost, but a big jump in image quality.',
				'post_status'  => 'publish',
			)
		);
	}

	public function set_up() {
		parent::set_up();
		if ( ! function_exists( 'wp_get_ability' ) || ! function_exists( 'openstation_ai_user_text_message' ) ) {
			$this->markTestSkipped( 'Abilities API and AI Client required (WordPress 7.0+).' );
		}
		wp_set_current_user( self::$admin_id );
		$this->turns = array();
	}

	/**
	 * Script the model: `$script( $turn_number, $tools )` returns a turn.
	 *
	 * @param callable $script Turn factory.
	 */
	private function script_model( callable $script ) {
		add_filter(
			'openstation_ai_search_generate',
			function ( $generated, $messages, $tools, $context ) use ( $script ) {
				$this->turns[] = array(
					'messages' => $messages,
					'tools'    => $tools,
					'source'   => $context['source'] ?? '',
				);
				return $script( count( $this->turns ), $tools );
			},
			10,
			4
		);
	}

	private static function search_call( $n, $query ) {
		return array(
			'text'           => null,
			'function_calls' => array(
				array(
					'name'      => 'search_posts',
					'call_id'   => 'call_' . $n,
					'arguments' => wp_json_encode(
						array(
							'query'  => $query,
							'offset' => 0,
						)
					),
				),
			),
			'message'        => openstation_ai_user_text_message( 'tool call ' . $n ),
			'usage'          => null,
			'model'          => null,
		);
	}

	private static function answer( $message ) {
		return array(
			'text'           => wp_json_encode(
				array(
					'answer_type' => 'chat',
					'message'     => $message,
					'entity_id'   => null,
					'entity_type' => null,
					'admin_links' => null,
				)
			),
			'function_calls' => array(),
			'message'        => null,
			'usage'          => null,
			'model'          => null,
		);
	}

	/**
	 * The production failure: the first search hits, then the model keeps
	 * refining with other words until the rounds run out. The run must end
	 * with a toolless wrap-up turn that sees the first search's hit.
	 *
	 * @covers ::openstation_ai_run_search
	 * @covers ::openstation_ai_search_wrap_up_prompt
	 */
	public function test_out_of_rounds_answers_from_gathered_results() {
		$this->script_model(
			static function ( $n, $tools ) {
				if ( empty( $tools ) ) {
					return self::answer( 'Here is the PlayStation 5 Pro post.' );
				}
				return self::search_call( $n, 1 === $n ? 'performance' : 'direct' );
			}
		);

		$result = openstation_ai_run_search( 'find the post about performance please' );

		$this->assertIsArray( $result );
		$this->assertSame( 'Here is the PlayStation 5 Pro post.', $result['message'] );

		$wrap_up = end( $this->turns );
		$this->assertSame( 'ai-copilot/search-wrap-up', $wrap_up['source'] );
		$this->assertSame( array(), $wrap_up['tools'], 'The wrap-up turn offers no tools.' );
		$this->assertStringContainsString(
			'PlayStation 5 Pro',
			$wrap_up['messages'][0]->getParts()[0]->getText(),
			'The wrap-up prompt carries the first search hit.'
		);
	}

	/**
	 * An answer on the turn generated after the last round is returned,
	 * not discarded.
	 *
	 * @covers ::openstation_ai_run_search
	 */
	public function test_answer_on_final_turn_is_returned() {
		$this->script_model(
			static function ( $n ) {
				return $n <= OPENSTATION_AI_SEARCH_MAX_ITERATIONS
					? self::search_call( $n, 'performance' )
					: self::answer( 'Answered on the last turn.' );
			}
		);

		$result = openstation_ai_run_search( 'find the post about performance please' );

		$this->assertSame( 'Answered on the last turn.', $result['message'] );
		$this->assertCount( OPENSTATION_AI_SEARCH_MAX_ITERATIONS + 1, $this->turns, 'No wrap-up turn was needed.' );
	}

	/**
	 * A failed wrap-up falls back to the "couldn't find" message rather
	 * than an error.
	 *
	 * @covers ::openstation_ai_run_search
	 */
	public function test_failed_wrap_up_falls_back_to_no_match_message() {
		$this->script_model(
			static function ( $n, $tools ) {
				if ( empty( $tools ) ) {
					return new WP_Error( 'provider_down', 'Provider unavailable.' );
				}
				return self::search_call( $n, 'performance' );
			}
		);

		$result = openstation_ai_run_search( 'find the post about performance please' );

		$this->assertIsArray( $result );
		$this->assertSame( 'chat', $result['answer_type'] );
		$this->assertStringStartsWith( 'I couldn', $result['message'] );
	}

	/**
	 * An answer on the first turn is unchanged: one turn, no wrap-up.
	 *
	 * @covers ::openstation_ai_run_search
	 */
	public function test_immediate_answer_skips_the_loop() {
		$this->script_model(
			static function () {
				return self::answer( 'Hello!' );
			}
		);

		$result = openstation_ai_run_search( 'hi' );

		$this->assertSame( 'Hello!', $result['message'] );
		$this->assertCount( 1, $this->turns );
	}
}
