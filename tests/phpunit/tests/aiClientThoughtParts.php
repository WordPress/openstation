<?php
/**
 * Tests for stripping thought-channel parts from replayed assistant turns.
 *
 * The agentic loop appends each assistant turn back into the conversation
 * history. Providers can't round-trip reasoning blocks (the Anthropic
 * provider drops the `signature` a replayed `thinking` block must carry),
 * so `desktop_mode_ai_strip_thought_parts()` removes thought parts before
 * the message re-enters history.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-ai
 */

use WordPress\AiClient\Messages\DTO\Message;
use WordPress\AiClient\Messages\DTO\MessagePart;
use WordPress\AiClient\Messages\Enums\MessagePartChannelEnum;
use WordPress\AiClient\Messages\Enums\MessageRoleEnum;
use WordPress\AiClient\Tools\DTO\FunctionCall;

class Tests_DesktopMode_AiClientThoughtParts extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		if ( ! class_exists( 'WordPress\AiClient\Messages\DTO\Message' ) ) {
			$this->markTestSkipped( 'AI Client SDK not available (requires WordPress 7.0+).' );
		}
	}

	/**
	 * Thought parts are removed; text and function-call parts survive in order.
	 *
	 * @covers ::desktop_mode_ai_strip_thought_parts
	 */
	public function test_strips_thought_parts_and_keeps_the_rest() {
		$message = new Message(
			MessageRoleEnum::model(),
			array(
				new MessagePart( 'Let me look that up…', MessagePartChannelEnum::thought() ),
				new MessagePart( 'Searching your posts now.' ),
				new MessagePart( new FunctionCall( 'call_1', 'search_posts', array( 'query' => 'paella' ) ) ),
			)
		);

		$stripped = desktop_mode_ai_strip_thought_parts( $message );
		$parts    = $stripped->getParts();

		$this->assertCount( 2, $parts, 'Only the thought part should be removed.' );
		$this->assertTrue( $parts[0]->getType()->isText() );
		$this->assertSame( 'Searching your posts now.', $parts[0]->getText() );
		$this->assertTrue( $parts[1]->getType()->isFunctionCall() );
		$this->assertSame( 'search_posts', $parts[1]->getFunctionCall()->getName() );
		$this->assertTrue( $stripped->getRole()->isModel(), 'The role must be preserved.' );
	}

	/**
	 * A message without thought parts is returned untouched (same instance).
	 *
	 * @covers ::desktop_mode_ai_strip_thought_parts
	 */
	public function test_message_without_thought_parts_is_returned_unchanged() {
		$message = new Message(
			MessageRoleEnum::model(),
			array(
				new MessagePart( 'Here is your answer.' ),
			)
		);

		$this->assertSame( $message, desktop_mode_ai_strip_thought_parts( $message ) );
	}

	/**
	 * A message that is ALL thought parts is not emptied — an empty parts
	 * list would be a worse (invalid) message than the original.
	 *
	 * @covers ::desktop_mode_ai_strip_thought_parts
	 */
	public function test_thought_only_message_is_not_emptied() {
		$message = new Message(
			MessageRoleEnum::model(),
			array(
				new MessagePart( 'Pondering…', MessagePartChannelEnum::thought() ),
			)
		);

		$this->assertSame( $message, desktop_mode_ai_strip_thought_parts( $message ) );
	}
}
