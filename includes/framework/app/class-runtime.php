<?php
/**
 * OpenStation App Framework — dispatch runtime.
 *
 * The whole request cycle of a window, host-agnostic:
 *
 *     request  { action, state, args, client }
 *       → rebuild State from the app's declared defaults
 *       → run the action (or `mount` / the built-in `set`)
 *       → render the view
 *     response { state, html, effects }
 *
 * The host (a REST route on WordPress, anything on a bare PHP host)
 * only has to move those two arrays over the wire. A failure comes
 * back as `array( 'ok' => false, 'error' => <code>, 'status' => <http> )`
 * with an English `message` the host may translate.
 *
 * @package OpenStation
 */

namespace OpenStation\App;

use OpenStation\App;

if ( ! defined( 'ABSPATH' ) && ! defined( 'OPENSTATION_STANDALONE' ) ) {
	exit;
}

/**
 * Runs dispatches against the registry.
 */
final class Runtime {

	/** First render of a window. Runs the app's `mount` hook, if any. */
	const ACTION_MOUNT = 'mount';

	/** Built-in: the client changed a bound key; nothing to run, just re-render. */
	const ACTION_SET = 'set';

	/**
	 * @var Registry
	 */
	private $registry;

	public function __construct( Registry $registry ) {
		$this->registry = $registry;
	}

	/**
	 * The registry this runtime dispatches into.
	 *
	 * @return Registry
	 */
	public function registry() {
		return $this->registry;
	}

	/**
	 * Run one dispatch.
	 *
	 * @param string              $app_id  App id.
	 * @param array<string,mixed> $request `action` (string), `state` (array), `args` (array), `client` (array).
	 * @param Os                  $os      Host handle for the acting user.
	 * @return array<string,mixed> `ok`, then `state` / `html` / `effects` on success or
	 *                             `error` / `message` / `status` on failure.
	 */
	public function dispatch( $app_id, array $request, Os $os ) {
		$app = $this->registry->get( $app_id );
		if ( ! $app ) {
			return self::failure( 'not_found', 'Unknown app.', 404 );
		}
		if ( ! $app->allows( $os ) ) {
			return self::failure( 'forbidden', 'You are not allowed to use this window.', 403 );
		}

		$action = isset( $request['action'] ) ? strtolower( (string) preg_replace( '/[^a-zA-Z0-9_-]/', '', (string) $request['action'] ) ) : '';
		$args   = isset( $request['args'] ) && is_array( $request['args'] ) ? $request['args'] : array();
		$view   = isset( $request['view'] ) ? strtolower( (string) preg_replace( '/[^a-zA-Z0-9_-]/', '', (string) $request['view'] ) ) : 'main';
		if ( '' === $view ) {
			$view = 'main';
		}
		if ( ! $app->has_view( $view ) ) {
			return self::failure( 'unknown_view', sprintf( 'Unknown view "%s".', $view ), 400 );
		}
		$state = new State(
			$app->defaults(),
			isset( $request['state'] ) && is_array( $request['state'] ) ? $request['state'] : array()
		);
		$os->begin(
			isset( $request['client'] ) && is_array( $request['client'] ) ? $request['client'] : array(),
			isset( $request['params'] ) && is_array( $request['params'] ) ? $request['params'] : array(),
			$app->id(),
			$view
		);

		try {
			if ( self::ACTION_MOUNT === $action ) {
				$app->run_mount( $state, $os );
			} elseif ( self::ACTION_SET === $action ) {
				// State already carries the bound value.
				$app->run_action( self::ACTION_SET, $state, $os, $args, false );
			} elseif ( $app->has_action( $action ) ) {
				$app->run_action( $action, $state, $os, $args );
			} else {
				return self::failure( 'unknown_action', sprintf( 'Unknown action "%s".', $action ), 400 );
			}

			$data = $app->has_data() ? $app->compute_data( $state, $os ) : null;
			$html = $app->render( $state, $os, $view );
		} catch ( \Throwable $e ) {
			return self::failure( 'action_failed', $e->getMessage(), 500 );
		}

		$response = array(
			'ok'      => true,
			'state'   => $state->all(),
			'html'    => $html,
			'effects' => $os->effects->all(),
		);
		if ( null !== $data ) {
			$response['data'] = $data;
		}

		/**
		 * Filter a dispatch response before it leaves the runtime.
		 *
		 * @param array<string,mixed> $response `ok`, `state`, `html`, `effects`.
		 * @param string              $app_id   App id.
		 * @param string              $action   Action that ran.
		 * @param State               $state    Final state.
		 */
		$filtered = $os->filter( 'openstation_app_response', $response, $app->id(), $action, $state );

		return is_array( $filtered ) ? $filtered : $response;
	}

	/**
	 * Render an app straight from a state array — no action, no
	 * request cycle. What a host calls to get "the whole window" as
	 * a value: the manifest plus the body it would paint.
	 *
	 * @param string              $app_id App id.
	 * @param array<string,mixed> $state  State values (partial; defaults fill the rest).
	 * @param Os                  $os     Host handle.
	 * @return array<string,mixed> `manifest`, `state`, `html`, `effects` — or a failure array.
	 */
	public function describe( $app_id, array $state, Os $os ) {
		$app = $this->registry->get( $app_id );
		if ( ! $app ) {
			return self::failure( 'not_found', 'Unknown app.', 404 );
		}
		if ( ! $app->allows( $os ) ) {
			return self::failure( 'forbidden', 'You are not allowed to use this window.', 403 );
		}
		$os->begin( array(), array(), $app->id(), 'main' );
		$window_state = new State( $app->defaults(), $state );
		try {
			$app->run_mount( $window_state, $os );
			$data = $app->has_data() ? $app->compute_data( $window_state, $os ) : null;
			$html = $app->render( $window_state, $os );
			$tabs = array();
			foreach ( $app->tabs() as $tab ) {
				$os->view              = $tab['value'];
				$tabs[ $tab['value'] ] = $app->render( new State( $app->defaults(), $state ), $os, $tab['value'] );
			}
		} catch ( \Throwable $e ) {
			return self::failure( 'action_failed', $e->getMessage(), 500 );
		}
		return array(
			'ok'       => true,
			'manifest' => $app->manifest(),
			'state'    => $window_state->all(),
			'html'     => $html,
			'data'     => $data,
			'tabs'     => $tabs,
			'effects'  => $os->effects->all(),
		);
	}

	/**
	 * Shape a failure.
	 *
	 * @param string $code    Machine code.
	 * @param string $message English message.
	 * @param int    $status  HTTP status the host should use.
	 * @return array<string,mixed>
	 */
	private static function failure( $code, $message, $status ) {
		return array(
			'ok'      => false,
			'error'   => $code,
			'message' => $message,
			'status'  => (int) $status,
		);
	}
}
