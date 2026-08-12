<?php
/**
 * Tests for the activity bracketing the chromeless bridge emits.
 *
 * The bridge wraps `fetch` and `XMLHttpRequest` inside every iframe
 * window and posts `os-iframe-activity` around each request, which is
 * what lets an admin page's own jQuery calls move the window's status
 * ring without knowing the shell exists.
 *
 * What is worth pinning here is the *quiet*, because getting it wrong
 * is invisible in a screenshot and constant in use. Three classes of
 * request must never reach the ring:
 *
 *   - Reads. A GET changed nothing, so nothing can have failed to
 *     change, and an admin page fires them constantly on its own.
 *   - Heartbeat. A poll nobody initiated, every 15 seconds, forever.
 *   - Anything whose `begin` was refused: the `end` has to be gated on
 *     the same token, or an unbalanced decrement settles the ring
 *     while other requests are still in flight.
 *
 * The assertions read the emitted script because that is where this
 * logic lives — it runs in a document PHPUnit never loads.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-chromeless
 */
class Tests_OpenStation_ChromelessActivity extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		wp_set_current_user( self::$admin_id );
		$_GET['openstation_chromeless'] = '1';
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		unset( $_GET['openstation_chromeless'] );
		parent::tear_down();
	}

	/**
	 * Capture the inline bridge script the footer emits.
	 *
	 * @return string Script markup.
	 */
	private function bridge_markup() {
		ob_start();
		openstation_chromeless_bridge_script();
		return (string) ob_get_clean();
	}

	/**
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_the_bridge_brackets_requests_for_the_status_ring() {
		$markup = $this->bridge_markup();

		$this->assertStringContainsString( "type: 'os-iframe-activity', phase: 'start'", $markup );
		$this->assertStringContainsString( "phase: 'end'", $markup );
	}

	/**
	 * A read has no "did it go through?" attached, and an admin page
	 * fires them constantly on its own — list tables, dashboard
	 * widgets, autosave checks, media queries.
	 *
	 * QUERY is in the list for a reason worth keeping: it is a safe,
	 * idempotent read that carries a BODY, so any heuristic that
	 * separates reads from writes by asking whether there's a payload
	 * gets it exactly backwards.
	 *
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_reads_never_reach_the_ring() {
		$markup = $this->bridge_markup();

		$this->assertStringContainsString( 'osIsReadRequest', $markup );
		foreach ( array( 'GET', 'HEAD', 'OPTIONS', 'QUERY' ) as $method ) {
			$this->assertStringContainsString(
				"'" . $method . "' === m",
				$markup,
				$method . ' must be excluded from activity reporting.'
			);
		}
	}

	/**
	 * The read check has to gate the `begin`, not sit somewhere
	 * harmlessly beside it.
	 *
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_the_read_check_gates_the_begin() {
		$markup = $this->bridge_markup();

		$this->assertStringContainsString(
			'if ( osIsReadRequest( method ) || osIsBackgroundRequest( url, body ) ) {',
			$markup
		);
	}

	/**
	 * Heartbeat POSTs to `admin-ajax.php` with the action in the BODY,
	 * so a URL-only check would miss it and every idle window would
	 * pulse on a timer.
	 *
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_heartbeat_is_recognised_from_the_body_as_well_as_the_url() {
		$markup = $this->bridge_markup();

		$this->assertStringContainsString( "String( url || '' ).indexOf( 'action=heartbeat' )", $markup );
		$this->assertStringContainsString( "body.indexOf( 'action=heartbeat' )", $markup );
		// FormData bodies expose the action through `get()` rather than
		// as a string.
		$this->assertStringContainsString( "body.get( 'action' ) === 'heartbeat'", $markup );
	}

	/**
	 * Both wrappers have to pass the method through, or the read
	 * exclusion silently applies to nothing.
	 *
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_both_wrappers_report_their_method() {
		$markup = $this->bridge_markup();

		// fetch
		$this->assertStringContainsString(
			'osActivityBegin( method, url,',
			$markup
		);
		// XHR — method and URL are recorded on `open()`.
		$this->assertStringContainsString(
			'osActivityBegin( xhr.__wpdMethod, xhr.__wpdUrl, body )',
			$markup
		);
	}

	/**
	 * An `end` for a request that was never counted would decrement a
	 * counter it never incremented, settling the ring while other
	 * requests are still on the wire.
	 *
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_the_end_is_gated_on_the_begin_token() {
		$markup = $this->bridge_markup();

		$this->assertStringContainsString( 'var osActivityEnd = function ( tracked, failed, status ) {', $markup );
		$this->assertStringContainsString( 'if ( ! tracked ) {', $markup );
	}

	/**
	 * `fetch` resolves for 4xx / 5xx, so the ring has to settle on the
	 * response and not on the promise — the same bug the parent-side
	 * `wp.os.fetch` had.
	 *
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_an_http_error_settles_as_a_failure() {
		$markup = $this->bridge_markup();

		$this->assertStringContainsString( 'osActivityEnd( tracked, ! res.ok, res.status )', $markup );
	}
}
