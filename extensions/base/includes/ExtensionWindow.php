<?php

defined( 'ABSPATH' ) || exit;

if ( ! class_exists( 'OpenStation_Extension_Window' ) ) :

abstract class OpenStation_Extension_Window {

	abstract protected function window_id(): string;

	abstract protected function asset_handle(): string;

	abstract protected function plugin_url(): string;

	abstract protected function plugin_dir(): string;

	abstract protected function version(): string;

	abstract protected function bundle_action(): string;

	abstract protected function config_global(): string;

	abstract protected function window_args(): array;

	abstract protected function config_payload(): array;

	protected function required_caps(): array {
		return array( 'manage_options' );
	}

	public function boot(): void {
		add_action( 'init', array( $this, 'register_assets' ) );
		add_action( 'plugins_loaded', array( $this, 'register_window' ) );
		add_action(
			'wp_ajax_' . $this->bundle_action(),
			array( $this, 'serve_bundle' )
		);
	}

	public function register_assets(): void {
		$bundle_url = add_query_arg(
			array( 'action' => $this->bundle_action() ),
			admin_url( 'admin-ajax.php' )
		);

		wp_register_script(
			$this->asset_handle(),
			$bundle_url,
			array( 'wp-i18n', 'openstation' ),
			$this->version(),
			true
		);

		wp_register_style(
			$this->asset_handle(),
			$this->plugin_url() . 'assets/css/' . $this->asset_handle() . '.css',
			array( 'os-variables', 'dashicons' ),
			$this->version()
		);
	}

	public function register_window(): void {
		if ( ! function_exists( 'openstation_register_window' ) ) {
			return;
		}
		$args = array_merge(
			$this->window_args(),
			array(
				'id'     => $this->window_id(),
				'script' => $this->asset_handle(),
				'style'  => $this->asset_handle(),
			)
		);
		openstation_register_window( $this->window_id(), $args );
	}

	public function serve_bundle(): void {
		$caps = $this->required_caps();
		foreach ( $caps as $cap ) {
			if ( ! current_user_can( (string) $cap ) ) {
				wp_die( '', '', 403 );
			}
		}

		$debug = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG );
		$file  = $this->plugin_dir() . 'assets/js/' . $this->asset_handle()
			. ( $debug ? '.js' : '.min.js' );
		if ( ! is_readable( $file ) ) {
			wp_die( '', '', 404 );
		}

		header( 'Content-Type: application/javascript; charset=utf-8' );
		header( 'X-Robots-Tag: noindex' );


		echo 'window.' . esc_js( $this->config_global() ) . ' = '
			. wp_json_encode( $this->config_payload() ) . ";\n";

		echo file_get_contents( $file );

		echo "\n;( function () {\n";
		echo "  if ( ! window.customElements ) { return; }\n";
		echo "  if ( window.customElements.whenDefined ) {\n";
		echo "    window.customElements.whenDefined( 'os-table' );\n";
		echo "  }\n";
		echo "} )();\n";

		wp_die();
	}
}

endif;
