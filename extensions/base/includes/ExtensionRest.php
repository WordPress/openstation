<?php

defined( 'ABSPATH' ) || exit;

if ( ! class_exists( 'OpenStation_Extension_Rest' ) ) :

abstract class OpenStation_Extension_Rest {

	abstract protected function namespace(): string;

	protected function required_caps(): array {
		return array( 'manage_options' );
	}

	abstract protected function routes(): array;

	public function boot(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		foreach ( $this->routes() as $route => $args ) {
			if ( isset( $args['callback'] ) ) {

				if ( empty( $args['permission_callback'] ) ) {
					$args['permission_callback'] = array( $this, 'check_caps' );
				}
			} else {

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
