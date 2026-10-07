<?php

namespace OpenStation\App;

use OpenStation\App\Contracts\Auth;
use OpenStation\App\Contracts\Cache;
use OpenStation\App\Contracts\Env;
use OpenStation\App\Contracts\Hooks;
use OpenStation\App\Contracts\Settings;
use OpenStation\App\Contracts\Store;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

final class Os {

	public $auth;

	public $settings;

	public $hooks;

	public $cache;

	public $env;

	public $storage;

	public $effects;

	public $client = array(
		'width'  => 0,
		'height' => 0,
	);

	public $params = array();

	public $app_id = '';

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

	public function can( $capability, ...$args ) {
		return $this->auth->can( $capability, ...$args );
	}

	public function preference( $key, $fallback = null ) {
		return $this->settings->user_preference( $key, $fallback );
	}

	public function param( $key, $fallback = null ) {
		return array_key_exists( $key, $this->params ) ? $this->params[ $key ] : $fallback;
	}

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

	public function filter( $hook, $value, ...$args ) {
		return $this->hooks->filter( $hook, $value, ...$args );
	}

	public function action( $hook, ...$args ) {
		$this->hooks->action( $hook, ...$args );
	}

	public function remember( $key, $ttl, callable $compute ) {
		$miss  = new \stdClass();
		$value = $this->cache->get( $key, $miss );
		if ( $miss === $value ) {
			$value = $compute();
			$this->cache->set( $key, $value, $ttl );
		}
		return $value;
	}

	public function stored( $key, $fallback = null, $scope = 'user' ) {
		return $this->storage->get( $scope, $this->storage_key( $key ), $fallback );
	}

	public function store( $key, $value, $scope = 'user' ) {
		$this->storage->set( $scope, $this->storage_key( $key ), $value );
		return $this;
	}

	public function forget( $key, $scope = 'user' ) {
		$this->storage->delete( $scope, $this->storage_key( $key ) );
		return $this;
	}

	private function storage_key( $key ) {
		return ( '' !== $this->app_id ? $this->app_id . ':' : '' ) . (string) $key;
	}

	public function toast( $message, $type = '' ) {
		$this->effects->toast( $message, $type );
		return $this;
	}

	public function title( $title ) {
		$this->effects->title( $title );
		return $this;
	}

	public function close() {
		$this->effects->close();
		return $this;
	}

	public function open( $window_id ) {
		$this->effects->open( $window_id );
		return $this;
	}

	public function open_url( $url, $title = '', $icon = '' ) {
		$this->effects->open_url( $url, $title, $icon );
		return $this;
	}

	public function badge( $count ) {
		$this->effects->badge( $count );
		return $this;
	}

	public function icon( $icon ) {
		$this->effects->icon( $icon );
		return $this;
	}

	public function announce( $type, $action, $ids ) {
		$this->effects->announce( $type, $action, $ids );
		return $this;
	}

	public function menu( array $items ) {
		$this->effects->menu( $items );
		return $this;
	}

	public function send( $channel, $payload = null ) {
		$this->effects->send( $channel, $payload );
		return $this;
	}

	public function refresh_menu() {
		$this->effects->refresh_menu();
		return $this;
	}
}
