<?php
/**
 * OpenStation App Framework — app registry and `.os.php` loader.
 *
 * Holds every defined `App` by id and knows how to find them on
 * disk: an `.os.php` file is a PHP file that `return`s an `App`.
 * Loading a directory picks up the `.os.php` files directly inside
 * it and those one folder down, so an app can be a single file or a
 * folder with its stylesheet and helpers beside it.
 *
 * @package OpenStation
 */

namespace OpenStation\App;

use OpenStation\App;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/**
 * App registry + `.os.php` loader.
 */
final class Registry {

	const FILE_SUFFIX = '.os.php';

	/**
	 * @var array<string,App>
	 */
	private $apps = array();

	/**
	 * Real paths already included, so a file is never evaluated twice.
	 *
	 * @var array<string,true>
	 */
	private $loaded = array();

	/**
	 * Register an app. A second app with the same id replaces the first.
	 *
	 * @param App $app App definition.
	 * @return App The same app, for chaining.
	 */
	public function add( App $app ) {
		$this->apps[ $app->id() ] = $app;
		return $app;
	}

	/**
	 * Forget an app.
	 *
	 * @param string $id App id.
	 * @return void
	 */
	public function remove( $id ) {
		unset( $this->apps[ (string) $id ] );
	}

	/**
	 * Look an app up.
	 *
	 * @param string $id App id.
	 * @return App|null
	 */
	public function get( $id ) {
		return isset( $this->apps[ (string) $id ] ) ? $this->apps[ (string) $id ] : null;
	}

	/**
	 * Whether an app is registered.
	 *
	 * @param string $id App id.
	 * @return bool
	 */
	public function has( $id ) {
		return isset( $this->apps[ (string) $id ] );
	}

	/**
	 * Every registered app, keyed by id.
	 *
	 * @return array<string,App>
	 */
	public function all() {
		return $this->apps;
	}

	/**
	 * Evaluate one `.os.php` file and register the app it returns.
	 *
	 * @param string $path Absolute file path.
	 * @return App|null The app, or null when the file returned none.
	 */
	public function load_file( $path ) {
		$real = realpath( (string) $path );
		if ( false === $real || ! is_file( $real ) ) {
			return null;
		}
		if ( isset( $this->loaded[ $real ] ) ) {
			return $this->find_by_file( $real );
		}
		$this->loaded[ $real ] = true;

		$result = include $real;
		if ( ! $result instanceof App ) {
			return null;
		}
		$result->located_at( dirname( $real ), $real );
		return $this->add( $result );
	}

	/**
	 * Load every `.os.php` under a directory (one level of
	 * sub-folders deep), alphabetical.
	 *
	 * @param string $dir Absolute directory path.
	 * @return App[] Apps loaded from this call.
	 */
	public function load_dir( $dir ) {
		$dir = rtrim( (string) $dir, '/\\' );
		if ( '' === $dir || ! is_dir( $dir ) ) {
			return array();
		}
		$files = array_merge(
			(array) glob( $dir . '/*' . self::FILE_SUFFIX ),
			(array) glob( $dir . '/*/*' . self::FILE_SUFFIX )
		);
		sort( $files );

		$apps = array();
		foreach ( $files as $file ) {
			$app = $this->load_file( $file );
			if ( $app ) {
				$apps[] = $app;
			}
		}
		return $apps;
	}

	/**
	 * The app that was loaded from a given file, if any.
	 *
	 * @param string $real Real path.
	 * @return App|null
	 */
	private function find_by_file( $real ) {
		foreach ( $this->apps as $app ) {
			if ( $app->file() === $real ) {
				return $app;
			}
		}
		return null;
	}
}
