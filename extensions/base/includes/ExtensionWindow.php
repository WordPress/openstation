<?php
/**
 * Desktop Mode — Extension window base.
 *
 * Abstract base for in-tree (and third-party) Desktop Mode
 * extensions that ship a single native window backed by an
 * admin-ajax-served bundle. Replaces ~250 LOC of boilerplate per
 * extension with ~30 lines of subclass declarations.
 *
 * The bundle-serving pattern: each extension's window script is
 * registered with a `src` that points at
 * `admin-ajax.php?action=<bundle_action>`. When the browser
 * fetches it, an AJAX handler emits a single response that:
 *
 *   1. Sets `window.<config_global>` with REST URLs + nonce.
 *   2. Streams the prebuilt bundle (.js or .min.js depending on
 *      SCRIPT_DEBUG).
 *   3. Closes with a best-effort `customElements.whenDefined(
 *      'wpd-table' )` probe whose Promise is discarded — it does
 *      NOT defer the bundle's render callback. Extensions whose
 *      first render depends on upgraded `<wpd-*>` elements must
 *      defend against the upgrade race themselves (see the
 *      desktop-mode-cron-manager bundle trailer for a wrapper
 *      that does).
 *
 * Concrete subclasses declare the constants the base needs;
 * everything else is inherited.
 *
 * @package Desktop_Mode_Extension_Base
 */

defined( 'ABSPATH' ) || exit;

if ( ! class_exists( 'Desktop_Mode_Extension_Window' ) ) :

/**
 * Base class an extension subclasses to declare its native window.
 */
abstract class Desktop_Mode_Extension_Window {

	/**
	 * Stable id for the native window. Matches the value passed
	 * to `desktop_mode_register_window()`.
	 */
	abstract protected function window_id(): string;

	/**
	 * Script + style handle. Same value used for both;
	 * convention across the in-tree extensions.
	 */
	abstract protected function asset_handle(): string;

	/**
	 * Plugin URL (`plugin_dir_url( __FILE__ )` from the entry
	 * file). Used to resolve the bundle's `.js` / `.min.js`
	 * path on disk and the stylesheet URL.
	 */
	abstract protected function plugin_url(): string;

	/**
	 * Plugin filesystem dir (`plugin_dir_path( __FILE__ )` from
	 * the entry file).
	 */
	abstract protected function plugin_dir(): string;

	/**
	 * Plugin version constant (cache-busts asset URLs).
	 */
	abstract protected function version(): string;

	/**
	 * `wp_ajax_<action>` slug used to serve the bundle. Must be
	 * unique across all extensions. Convention:
	 * `desktop_mode_<plugin>_bundle`.
	 */
	abstract protected function bundle_action(): string;

	/**
	 * Global on `window` that holds the config blob the bundle
	 * reads at load time. Convention: `wpDesktop<Plugin>Config`.
	 */
	abstract protected function config_global(): string;

	/**
	 * Native-window registration args passed to
	 * `desktop_mode_register_window()` minus the `script`,
	 * `style`, and `id` fields the base fills in. Subclasses
	 * declare title, icon, template, default size, etc.
	 *
	 * @return array
	 */
	abstract protected function window_args(): array;

	/**
	 * Config blob serialised into the bundle (REST URLs, nonces,
	 * preferences). Returned as a JSON-encodable array.
	 *
	 * @return array
	 */
	abstract protected function config_payload(): array;

	/**
	 * Capabilities that gate every REST + AJAX interaction. The
	 * base only consults this when serving the bundle — concrete
	 * REST controllers are expected to enforce it themselves.
	 */
	protected function required_caps(): array {
		return array( 'manage_options' );
	}

	/**
	 * Wire the extension. Call once from the entry plugin file's
	 * top-level scope:
	 *
	 *   ( new MyExtensionWindow() )->boot();
	 */
	public function boot(): void {
		add_action( 'init', array( $this, 'register_assets' ) );
		add_action( 'plugins_loaded', array( $this, 'register_window' ) );
		add_action(
			'wp_ajax_' . $this->bundle_action(),
			array( $this, 'serve_bundle' )
		);
	}

	/**
	 * Hook callback — registers the script + style handles. Runs
	 * on `init`.
	 */
	public function register_assets(): void {
		$bundle_url = add_query_arg(
			array( 'action' => $this->bundle_action() ),
			admin_url( 'admin-ajax.php' )
		);

		wp_register_script(
			$this->asset_handle(),
			$bundle_url,
			array( 'wp-i18n', 'desktop-mode' ),
			$this->version(),
			true
		);

		wp_register_style(
			$this->asset_handle(),
			$this->plugin_url() . 'assets/css/' . $this->asset_handle() . '.css',
			array( 'desktop-mode-variables', 'dashicons' ),
			$this->version()
		);
	}

	/**
	 * Hook callback — registers the native window. Runs on
	 * `plugins_loaded` so the desktop-mode plugin's
	 * `desktop_mode_register_window()` is available.
	 */
	public function register_window(): void {
		if ( ! function_exists( 'desktop_mode_register_window' ) ) {
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
		desktop_mode_register_window( $this->window_id(), $args );
	}

	/**
	 * Hook callback — serves the bundle on
	 * `wp_ajax_<bundle_action>`. The trailing
	 * `customElements.whenDefined( 'wpd-table' )` call is a
	 * fire-and-forget probe (its Promise is discarded) — it does
	 * not wrap or defer the bundle's render callback. Render
	 * callbacks that need the `<wpd-*>` upgrade must wait for it
	 * themselves.
	 *
	 * Subclasses normally don't override this.
	 */
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

		echo "/* desktop-mode extension bundle: " . esc_js( $this->asset_handle() ) . " */\n";

		echo 'window.' . esc_js( $this->config_global() ) . ' = '
			. wp_json_encode( $this->config_payload() ) . ";\n";

		// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- prebuilt bundle file controlled by the plugin.
		echo file_get_contents( $file );

		// Fire-and-forget probe only: the Promise is discarded, so
		// this does NOT defer the render callback past the `<wpd-*>`
		// upgrade. Render callbacks that need upgraded elements must
		// await `customElements.whenDefined()` themselves.
		echo "\n;( function () {\n";
		echo "  if ( ! window.customElements ) { return; }\n";
		echo "  if ( window.customElements.whenDefined ) {\n";
		echo "    window.customElements.whenDefined( 'wpd-table' );\n";
		echo "  }\n";
		echo "} )();\n";

		wp_die();
	}
}

endif;
