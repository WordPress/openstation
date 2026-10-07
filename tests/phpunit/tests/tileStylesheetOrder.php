<?php

class Tests_OpenStation_TileStylesheetOrder extends WP_UnitTestCase {

	const TILE_CHROME_HANDLE = 'os-files';

	public function set_up() {
		parent::set_up();
		$this->ensure_styles_registered();
	}

	private function ensure_styles_registered() {
		if ( wp_style_is( self::TILE_CHROME_HANDLE, 'registered' )
			&& wp_style_is( 'desktop-mode-my-wordpress', 'registered' ) ) {
			return;
		}
		if ( function_exists( 'openstation_register_assets' ) ) {
			openstation_register_assets();
		}
		if ( function_exists( 'openstation_my_wordpress_register_assets' ) ) {
			openstation_my_wordpress_register_assets();
		}
	}

	private function transitive_deps( $handle, &$seen = array() ) {
		$styles = wp_styles();
		if ( isset( $seen[ $handle ] ) || ! isset( $styles->registered[ $handle ] ) ) {
			return array();
		}
		$seen[ $handle ] = true;

		$deps = (array) $styles->registered[ $handle ]->deps;
		foreach ( $deps as $dep ) {
			$deps = array_merge( $deps, $this->transitive_deps( $dep, $seen ) );
		}

		return array_values( array_unique( $deps ) );
	}

	private function plugin_css_path( $handle ) {
		$styles = wp_styles();
		if ( ! isset( $styles->registered[ $handle ] ) ) {
			return '';
		}
		$src = (string) $styles->registered[ $handle ]->src;
		if ( '' === $src || 0 !== strpos( $src, OPENSTATION_URL ) ) {
			return '';
		}

		$path = OPENSTATION_DIR . substr( $src, strlen( OPENSTATION_URL ) );
		return file_exists( $path ) ? $path : '';
	}

	private function css_without_comments( $path ) {
		$css = (string) file_get_contents( $path );
		return (string) preg_replace( '#/\*.*?\*/#s', '', $css );
	}

	private function print_order( array $queue ) {
		$styles        = wp_styles();
		$saved_to_do   = $styles->to_do;
		$saved_done    = $styles->done;
		$styles->to_do = array();
		$styles->done  = array();

		$styles->all_deps( $queue );
		$order = $styles->to_do;

		$styles->to_do = $saved_to_do;
		$styles->done  = $saved_done;

		return $order;
	}

	public function test_my_wordpress_style_declares_the_tile_chrome_dependency() {
		$this->assertContains(
			self::TILE_CHROME_HANDLE,
			$this->transitive_deps( 'desktop-mode-my-wordpress' ),
			'my-wordpress.css overrides `.os-file-tile` at equal specificity, so it must declare `os-files` as a dependency to be guaranteed to print after it.'
		);
	}

	public function test_tile_chrome_prints_before_the_window_stylesheet() {
		$order = $this->print_order(
			array( self::TILE_CHROME_HANDLE, 'desktop-mode-my-wordpress' )
		);

		$this->assertLessThan(
			array_search( 'desktop-mode-my-wordpress', $order, true ),
			array_search( self::TILE_CHROME_HANDLE, $order, true ),
			'desktop-files.css must print before my-wordpress.css.'
		);
	}

	public function test_tile_chrome_still_prints_first_when_a_dependent_is_enqueued_ahead_of_the_shell() {
		wp_register_style(
			'os-test-my-wordpress-companion',
			OPENSTATION_URL . 'assets/css/my-wordpress-woocommerce.css',
			array( 'desktop-mode-my-wordpress' ),
			'1.0.0'
		);

		$order = $this->print_order(
			array(
				'os-test-my-wordpress-companion',
				self::TILE_CHROME_HANDLE,
				'desktop-mode-my-wordpress',
			)
		);

		$chrome = array_search( self::TILE_CHROME_HANDLE, $order, true );
		$window = array_search( 'desktop-mode-my-wordpress', $order, true );

		$this->assertNotFalse( $chrome, 'os-files did not make it into the print queue.' );
		$this->assertNotFalse( $window, 'desktop-mode-my-wordpress did not make it into the print queue.' );
		$this->assertLessThan(
			$window,
			$chrome,
			'A companion stylesheet enqueued before the shell pulled my-wordpress.css ahead of desktop-files.css — the Explorer media grid stacks in one corner when that happens.'
		);

		wp_deregister_style( 'os-test-my-wordpress-companion' );
	}

	public function test_every_stylesheet_that_restyles_a_tile_depends_on_the_tile_chrome() {
		$offenders = array();

		foreach ( array_keys( wp_styles()->registered ) as $handle ) {
			if ( self::TILE_CHROME_HANDLE === $handle ) {
				continue;
			}
			$path = $this->plugin_css_path( $handle );
			if ( '' === $path ) {
				continue;
			}
			if ( false === strpos( $this->css_without_comments( $path ), '.os-file-tile' ) ) {
				continue;
			}
			if ( in_array( self::TILE_CHROME_HANDLE, $this->transitive_deps( $handle ), true ) ) {
				continue;
			}
			$offenders[] = $handle . ' (' . basename( $path ) . ')';
		}

		$this->assertSame(
			array(),
			$offenders,
			"These stylesheets write `.os-file-tile` rules but don't declare `os-files` as a dependency, so whether their overrides win depends on enqueue order. Add 'os-files' to the handle's deps:\n" . implode( "\n", $offenders )
		);
	}
}
