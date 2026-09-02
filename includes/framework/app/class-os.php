<?php
/**
 * OpenStation App Framework — the `$os` handle.
 *
 * Every callback an app writes — the gate, `mount`, each action, the
 * view — receives one `Os`. It is the data-access layer: the six
 * host contracts (auth, settings, hooks, cache, env, store) behind
 * one object, plus what the current dispatch brought along (the
 * client viewport, the window's open-time params) and the effects
 * queue it will take back. An app that only talks to `$os` runs on
 * WordPress and on a bare PHP host without a line changed.
 *
 * @package OpenStation
 */

namespace OpenStation\App;

use OpenStation\App\Contracts\Auth;
use OpenStation\App\Contracts\Cache;
use OpenStation\App\Contracts\Env;
use OpenStation\App\Contracts\Hooks;
use OpenStation\App\Contracts\Settings;
use OpenStation\App\Contracts\Store;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/**
 * The host handle every app callback receives.
 */
final class Os {

	/**
	 * @var Auth
	 */
	public $auth;

	/**
	 * @var Settings
	 */
	public $settings;

	/**
	 * @var Hooks
	 */
	public $hooks;

	/**
	 * @var Cache
	 */
	public $cache;

	/**
	 * @var Env
	 */
	public $env;

	/**
	 * @var Store
	 */
	public $storage;

	/**
	 * Effects queued during the current dispatch.
	 *
	 * @var Effects
	 */
	public $effects;

	/**
	 * Client viewport as reported with the dispatch (`width`, `height`).
	 *
	 * @var array{width:int,height:int}
	 */
	public $client = array(
		'width'  => 0,
		'height' => 0,
	);

	/**
	 * The window's open-time params (`wp.os.openWindow( id, { params } )`).
	 *
	 * @var array<string,scalar>
	 */
	public $params = array();

	/**
	 * Id of the app being dispatched; '' outside a dispatch.
	 *
	 * @var string
	 */
	public $app_id = '';

	/**
	 * The view being rendered: `main` or a tab value.
	 *
	 * @var string
	 */
	public $view = 'main';

	public function __construct( Auth $auth, Settings $settings, Hooks $hooks, Cache $cache, Env $env, ?Store $storage = null ) {
		$this->auth     = $auth;
		$this->settings = $settings;
		$this->hooks    = $hooks;
		$this->cache    = $cache;
		$this->env      = $env;
		$this->storage  = $storage ? $storage : new Standalone\Store();
		$this->effects  = new Effects();
	}

	/**
	 * A host built from the standalone adapters — what tests and
	 * plain PHP hosts use. Pass any contract to override just that one.
	 *
	 * @param array<string,object> $overrides `auth` | `settings` | `hooks` | `cache` | `env` | `store`.
	 * @return self
	 */
	public static function standalone( array $overrides = array() ) {
		return new self(
			isset( $overrides['auth'] ) ? $overrides['auth'] : new Standalone\Auth( 1, array( '*' ) ),
			isset( $overrides['settings'] ) ? $overrides['settings'] : new Standalone\Settings(),
			isset( $overrides['hooks'] ) ? $overrides['hooks'] : new Standalone\Hooks(),
			isset( $overrides['cache'] ) ? $overrides['cache'] : new Standalone\Cache(),
			isset( $overrides['env'] ) ? $overrides['env'] : new Standalone\Env(),
			isset( $overrides['store'] ) ? $overrides['store'] : new Standalone\Store()
		);
	}

	/**
	 * Start a fresh dispatch: new effects queue, new client facts.
	 *
	 * @param array<string,mixed> $client `width` / `height` from the client.
	 * @param array<string,mixed> $params The window's open-time params.
	 * @param string              $app_id App being dispatched.
	 * @param string              $view   View being rendered.
	 * @return self
	 */
	public function begin( array $client = array(), array $params = array(), $app_id = '', $view = 'main' ) {
		$this->effects = new Effects();
		$this->client  = array(
			'width'  => isset( $client['width'] ) ? max( 0, (int) $client['width'] ) : 0,
			'height' => isset( $client['height'] ) ? max( 0, (int) $client['height'] ) : 0,
		);
		$this->params  = array_filter( $params, 'is_scalar' );
		$this->app_id  = (string) $app_id;
		$this->view    = '' !== (string) $view ? (string) $view : 'main';
		return $this;
	}

	// ------------------------------------------------------------ sugar

	/**
	 * Whether the acting user holds a capability. Extra arguments
	 * address a meta-capability's object: `can( 'delete_post', $id )`.
	 *
	 * @param string $capability Capability slug.
	 * @param mixed  ...$args    Object the capability is asked against.
	 * @return bool
	 */
	public function can( $capability, ...$args ) {
		return $this->auth->can( $capability, ...$args );
	}

	/**
	 * A preference of the acting user.
	 *
	 * @param string $key      Preference key.
	 * @param mixed  $fallback Fallback.
	 * @return mixed
	 */
	public function preference( $key, $fallback = null ) {
		return $this->settings->user_preference( $key, $fallback );
	}

	/**
	 * One of the window's open-time params.
	 *
	 * @param string $key      Param name.
	 * @param mixed  $fallback Fallback.
	 * @return mixed
	 */
	public function param( $key, $fallback = null ) {
		return array_key_exists( $key, $this->params ) ? $this->params[ $key ] : $fallback;
	}

	/**
	 * The paged-list envelope — the one shape the client runtime's
	 * page accumulation understands, so every list-shaped `data()`
	 * key builds it here instead of hand-assembling the array (five
	 * hand-assembled copies is how the first app shipped).
	 *
	 * @param array<int,mixed> $items    This page's rows.
	 * @param int              $total    Total rows across all pages.
	 * @param int              $page     1-based page number.
	 * @param int              $per_page Rows per page.
	 * @return array{items:array<int,mixed>,total:int,pages:int,page:int,perPage:int}
	 */
	public static function page( array $items, $total, $page, $per_page ) {
		$total = max( 0, (int) $total );
		$per   = max( 1, (int) $per_page );
		return array(
			'items'   => array_values( $items ),
			'total'   => $total,
			'pages'   => max( 1, (int) ceil( $total / $per ) ),
			'page'    => max( 1, (int) $page ),
			'perPage' => $per,
		);
	}

	/**
	 * Keep only the facts that have a value.
	 *
	 * A detail pane is a list of `array( label, value )` rows (an
	 * optional third element tags the row for filters), and a row
	 * whose value came back empty should vanish rather than render a
	 * labelled blank. One definition of "empty" for every pane.
	 *
	 * @param array<int,array<int,string>> $rows Label/value(/tag) rows.
	 * @return array<int,array<int,string>>
	 */
	public static function facts( array $rows ) {
		return array_values(
			array_filter(
				$rows,
				static function ( $fact ) {
					return isset( $fact[1] ) && '' !== (string) $fact[1];
				}
			)
		);
	}

	/**
	 * Run a value through a filter hook.
	 *
	 * @param string $hook    Hook name.
	 * @param mixed  $value   Value.
	 * @param mixed  ...$args Extra callback arguments.
	 * @return mixed
	 */
	public function filter( $hook, $value, ...$args ) {
		return $this->hooks->filter( $hook, $value, ...$args );
	}

	/**
	 * Fire an action hook.
	 *
	 * @param string $hook    Hook name.
	 * @param mixed  ...$args Callback arguments.
	 * @return void
	 */
	public function action( $hook, ...$args ) {
		$this->hooks->action( $hook, ...$args );
	}

	/**
	 * Return a cached value, computing and storing it on a miss.
	 *
	 * The key is the whole contract, and on a persistent object cache
	 * it is shared by every request on the site. Two things belong in
	 * it that are easy to forget: anything a **filter** contributed to
	 * the value (run the filter outside `$compute` and fold its result
	 * into the key, or a plugin's change lags by the TTL) and the
	 * **locale**, whenever the value carries translated text (or an
	 * admin reading in one language is served another's labels).
	 *
	 * @param string   $key     Cache key.
	 * @param int      $ttl     Seconds to keep it.
	 * @param callable $compute Produces the value on a miss.
	 * @return mixed
	 */
	public function remember( $key, $ttl, callable $compute ) {
		$miss  = new \stdClass();
		$value = $this->cache->get( $key, $miss );
		if ( $miss === $value ) {
			$value = $compute();
			$this->cache->set( $key, $value, $ttl );
		}
		return $value;
	}

	// ---------------------------------------------------------- storage

	/**
	 * Read a value this app stored (keys are namespaced per app).
	 *
	 * @param string $key      Key.
	 * @param mixed  $fallback Fallback.
	 * @param string $scope    `user` (default) | `site`.
	 * @return mixed
	 */
	public function stored( $key, $fallback = null, $scope = 'user' ) {
		return $this->storage->get( $scope, $this->storage_key( $key ), $fallback );
	}

	/**
	 * Store a value for this app.
	 *
	 * @param string $key   Key.
	 * @param mixed  $value Serialisable value.
	 * @param string $scope `user` (default) | `site`.
	 * @return self
	 */
	public function store( $key, $value, $scope = 'user' ) {
		$this->storage->set( $scope, $this->storage_key( $key ), $value );
		return $this;
	}

	/**
	 * Remove a stored value.
	 *
	 * @param string $key   Key.
	 * @param string $scope `user` (default) | `site`.
	 * @return self
	 */
	public function forget( $key, $scope = 'user' ) {
		$this->storage->delete( $scope, $this->storage_key( $key ) );
		return $this;
	}

	/**
	 * Namespace a storage key by the current app.
	 *
	 * @param string $key Key.
	 * @return string
	 */
	private function storage_key( $key ) {
		return ( '' !== $this->app_id ? $this->app_id . ':' : '' ) . (string) $key;
	}

	// ---------------------------------------------------------- effects

	/**
	 * Queue a toast. See {@see Effects::toast()}.
	 *
	 * @param string $message Text.
	 * @return self
	 */
	public function toast( $message ) {
		$this->effects->toast( $message );
		return $this;
	}

	/**
	 * Queue a retitle. See {@see Effects::title()}.
	 *
	 * @param string $title New title.
	 * @return self
	 */
	public function title( $title ) {
		$this->effects->title( $title );
		return $this;
	}

	/**
	 * Queue a close. See {@see Effects::close()}.
	 *
	 * @return self
	 */
	public function close() {
		$this->effects->close();
		return $this;
	}

	/**
	 * Queue an open. See {@see Effects::open()}.
	 *
	 * @param string $window_id Native window id.
	 * @return self
	 */
	public function open( $window_id ) {
		$this->effects->open( $window_id );
		return $this;
	}

	/**
	 * Queue an admin-URL window open. See {@see Effects::open_url()}.
	 *
	 * @param string $url   Admin URL.
	 * @param string $title Title.
	 * @param string $icon  Icon (Dashicons class or image URL).
	 * @return self
	 */
	public function open_url( $url, $title = '', $icon = '' ) {
		$this->effects->open_url( $url, $title, $icon );
		return $this;
	}

	/**
	 * Queue a badge update. See {@see Effects::badge()}.
	 *
	 * @param int $count Count; 0 clears.
	 * @return self
	 */
	public function badge( $count ) {
		$this->effects->badge( $count );
		return $this;
	}

	/**
	 * Queue a tile-art swap. See {@see Effects::icon()}.
	 *
	 * @param string $icon SVG data URI or image URL.
	 * @return self
	 */
	public function icon( $icon ) {
		$this->effects->icon( $icon );
		return $this;
	}

	/**
	 * Queue a content-change announcement. See {@see Effects::announce()}.
	 *
	 * @param string    $type   Content type.
	 * @param string    $action Change kind.
	 * @param int|int[] $ids    Affected ids.
	 * @return self
	 */
	public function announce( $type, $action, $ids ) {
		$this->effects->announce( $type, $action, $ids );
		return $this;
	}

	/**
	 * Queue a context menu. See {@see Effects::menu()}.
	 *
	 * @param array<int,array<string,mixed>> $items Menu items.
	 * @return self
	 */
	public function menu( array $items ) {
		$this->effects->menu( $items );
		return $this;
	}

	/**
	 * Queue a channel publish. See {@see Effects::send()}.
	 *
	 * @param string $channel Channel.
	 * @param mixed  $payload Payload.
	 * @return self
	 */
	public function send( $channel, $payload = null ) {
		$this->effects->send( $channel, $payload );
		return $this;
	}

	/**
	 * Queue a menu-payload refresh. See {@see Effects::refresh_menu()}.
	 *
	 * @return self
	 */
	public function refresh_menu() {
		$this->effects->refresh_menu();
		return $this;
	}
}
