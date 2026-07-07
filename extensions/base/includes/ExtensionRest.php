<?php
/**
 * Desktop Mode — Extension REST controller base.
 *
 * Boilerplate-eliminator for REST endpoints used by extensions:
 * each extension's `rest.php` typically registers 3-6 routes
 * with the same permission gate (`is_user_logged_in()` +
 * capability + per-environment guard) and the same
 * Content-Type negotiation.
 *
 * Subclass, declare `routes()`, and call `boot()` from the
 * plugin entry. The base wires `rest_api_init` and the
 * permission callback for you.
 *
 * @package Desktop_Mode_Extension_Base
 * @since   0.8.1
 */

defined( 'ABSPATH' ) || exit;

if ( ! class_exists( 'Desktop_Mode_Extension_Rest' ) ) :

/**
 * @since 0.8.1
 */
abstract class Desktop_Mode_Extension_Rest {

	/**
	 * REST namespace, e.g. `desktop-mode/v1` (the desktop-mode
	 * shell's own routes use this) or
	 * `desktop-mode-<plugin>/v1` for extensions that prefer
	 * isolation.
	 */
	abstract protected function namespace(): string;

	/**
	 * Capabilities required for every route. Concrete subclasses
	 * can override per-route by passing `permission_callback`
	 * directly in `routes()`.
	 */
	protected function required_caps(): array {
		return array( 'manage_options' );
	}

	/**
	 * Route definitions. Each entry is the array
	 * `register_rest_route()` accepts as its third argument,
	 * keyed by the route's URL pattern.
	 *
	 * Example:
	 *
	 *   protected function routes(): array {
	 *       return array(
	 *           '/items' => array(
	 *               'methods'  => 'GET',
	 *               'callback' => array( $this, 'list_items' ),
	 *               'permission_callback' => array( $this, 'check_caps' ),
	 *           ),
	 *           '/items/(?P<id>\d+)' => array(
	 *               'methods'  => 'POST',
	 *               'callback' => array( $this, 'update_item' ),
	 *               'permission_callback' => array( $this, 'check_caps' ),
	 *               'args'     => array( 'id' => array( 'type' => 'integer' ) ),
	 *           ),
	 *       );
	 *   }
	 *
	 * @return array<string,array<string,mixed>>
	 */
	abstract protected function routes(): array;

	/**
	 * Wire the routes. Call once from the entry plugin file's
	 * top-level scope.
	 */
	public function boot(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Hook callback — registers every route declared by
	 * {@see routes()} under the namespace.
	 *
	 * Handles both shapes `register_rest_route()` accepts: a
	 * single endpoint array (top-level `callback`) and a
	 * numerically-indexed list of endpoint arrays (one per HTTP
	 * method). Each endpoint missing a `permission_callback`
	 * gets {@see check_caps()}.
	 */
	public function register_routes(): void {
		foreach ( $this->routes() as $route => $args ) {
			if ( isset( $args['callback'] ) ) {
				// Single-endpoint shape.
				if ( empty( $args['permission_callback'] ) ) {
					$args['permission_callback'] = array( $this, 'check_caps' );
				}
			} else {
				/*
				 * Multi-endpoint shape — one endpoint array per
				 * HTTP method, keyed numerically. Core treats
				 * non-numeric keys (e.g. the shared `args` key)
				 * as route options, so gate each numeric entry
				 * individually; a top-level permission_callback
				 * would be ignored per endpoint.
				 */
				foreach ( $args as $key => $endpoint ) {
					if ( ! is_numeric( $key ) || ! is_array( $endpoint ) ) {
						continue;
					}
					if ( empty( $endpoint['permission_callback'] ) ) {
						$args[ $key ]['permission_callback'] = array( $this, 'check_caps' );
					}
				}
			}
			register_rest_route(
				$this->namespace(),
				(string) $route,
				$args
			);
		}
	}

	/**
	 * Default permission callback. Logged-in users with all
	 * required caps pass; logged-out users get a 401 and
	 * logged-in users missing any required cap get a 403.
	 *
	 * @return true|WP_Error
	 */
	public function check_caps() {
		if ( ! is_user_logged_in() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You must be logged in.', 'desktop-mode' ),
				array( 'status' => 401 )
			);
		}
		foreach ( $this->required_caps() as $cap ) {
			if ( ! current_user_can( (string) $cap ) ) {
				return new WP_Error(
					'rest_forbidden',
					__( 'You do not have permission to do this.', 'desktop-mode' ),
					array( 'status' => 403 )
				);
			}
		}
		return true;
	}
}

endif;
