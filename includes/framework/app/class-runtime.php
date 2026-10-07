<?php

namespace OpenStation\App;

use OpenStation\App;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

final class Runtime {

	const ACTION_MOUNT = 'mount';

	const ACTION_REOPEN = 'reopen';

	const ACTION_SET = 'set';

	const ACTION_REFRESH = 'refresh';

	private $registry;

	public function __construct( Registry $registry ) {
		$this->registry = $registry;
	}

	public function registry() {
		return $this->registry;
	}

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

		if ( self::ACTION_MOUNT === $action || self::ACTION_REOPEN === $action ) {
			self::apply_menu_tab( $app, $state, $os );
		}

		try {
			if ( self::ACTION_MOUNT === $action ) {
				$app->run_mount( $state, $os );
			} elseif ( self::ACTION_REOPEN === $action && ! $app->has_action( $action ) ) {

				$state->get( 'tab' );
			} elseif ( self::ACTION_SET === $action ) {

				$app->run_action( self::ACTION_SET, $state, $os, $args, false );
			} elseif ( $app->has_action( $action ) ) {
				$app->run_action( $action, $state, $os, $args );
			} elseif ( self::ACTION_REFRESH !== $action ) {

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

		$filtered = $os->filter( 'openstation_app_response', $response, $app->id(), $action, $state );

		return is_array( $filtered ) ? $filtered : $response;
	}

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

	private static function apply_menu_tab( App $app, State $state, Os $os ) {
		$tabs = $app->menu_tabs();
		if ( ! $tabs ) {
			return;
		}
		$wanted = (string) $os->param( 'tab', '' );
		if ( '' === $wanted ) {
			return;
		}
		foreach ( $tabs as $tab ) {
			if ( $tab['id'] === $wanted ) {
				$state->set( 'tab', $wanted );
				return;
			}
		}
	}

	private static function failure( $code, $message, $status ) {
		return array(
			'ok'      => false,
			'error'   => $code,
			'message' => $message,
			'status'  => (int) $status,
		);
	}
}
