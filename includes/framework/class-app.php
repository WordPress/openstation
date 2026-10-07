<?php

namespace OpenStation;

use OpenStation\App\Os;
use OpenStation\App\State;
use OpenStation\App\View;
use function OpenStation\App\Html\esc;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

final class App {

	private $id;

	private $title = '';

	private $icon = 'dashicons-admin-generic';

	private $icon_svg = '';

	private $size = array(
		'width'      => 520,
		'height'     => 400,
		'min_width'  => 280,
		'min_height' => 220,
	);

	private $nav = array(
		'admin'      => 'site',
		'placement'  => 'dock',
		'nav_kind'   => 'app',
		'dock_order' => 0,
		'placeable'  => false,
		'autofocus'  => false,
	);

	private $desktop_icon = null;

	private $gate = null;

	private $capabilities = array();

	private $style = '';

	private $defaults = array();

	private $menu = null;

	private $mount = null;

	private $actions = array();

	private $view = null;

	private $data = null;

	private $client = '';

	private $prefetch = false;

	private $title_bar_buttons = array();

	private $window_actions = array();

	private $appearance = array();

	private $config = array();

	private $config_lazy = array();

	private $tabs = array();

	private $channels = array();

	private $watch = array();

	private $dir = '';

	private $file = '';

	private function __construct( $id ) {
		$id = strtolower( trim( (string) $id ) );
		if ( ! preg_match( '/^[a-z0-9][a-z0-9_-]*$/', $id ) ) {

			throw new \InvalidArgumentException( sprintf( 'Invalid app id "%s": use lowercase letters, digits, "-" and "_".', esc( $id ) ) );
		}
		$this->id = $id;
	}

	public static function define( $id ) {
		return new self( $id );
	}

	public function title( $title ) {
		$this->title = (string) $title;
		return $this;
	}

	public function icon( $icon ) {
		$icon = trim( (string) $icon );
		if ( 0 === strpos( $icon, '<svg' ) ) {
			$this->icon_svg = $icon;

			$this->icon = 'data:image/svg+xml;base64,' . base64_encode( $icon );
		} else {
			$this->icon_svg = '';
			$this->icon     = $icon;
		}
		return $this;
	}

	public function size( $width, $height ) {
		$this->size['width']  = max( 1, (int) $width );
		$this->size['height'] = max( 1, (int) $height );
		return $this;
	}

	public function min_size( $width, $height ) {
		$this->size['min_width']  = max( 1, (int) $width );
		$this->size['min_height'] = max( 1, (int) $height );
		return $this;
	}

	public function placement( $placement ) {
		$this->nav['placement'] = 'none' === $placement ? 'none' : 'dock';
		return $this;
	}

	public function admin( $admin ) {
		$this->nav['admin'] = in_array( $admin, array( 'site', 'network', 'any' ), true ) ? $admin : 'site';
		return $this;
	}

	public function nav_kind( $kind ) {
		$this->nav['nav_kind'] = 'control' === $kind ? 'control' : 'app';
		return $this;
	}

	public function dock_order( $order ) {
		$this->nav['dock_order'] = (int) $order;
		return $this;
	}

	public function placeable( $placeable = true ) {
		$this->nav['placeable'] = (bool) $placeable;
		return $this;
	}

	public function autofocus( $autofocus = true ) {
		$this->nav['autofocus'] = is_string( $autofocus ) ? $autofocus : (bool) $autofocus;
		return $this;
	}

	public function desktop_icon( array $args = array() ) {
		$this->desktop_icon = $args;
		return $this;
	}

	public function can( callable $gate ) {
		$this->gate = $gate;
		return $this;
	}

	public function capabilities( ...$capabilities ) {
		$this->capabilities = array_values( array_filter( array_map( 'strval', $capabilities ) ) );
		return $this;
	}

	public function allows( Os $os ) {
		if ( ! $os->auth->is_logged_in() ) {
			return false;
		}
		foreach ( $this->capabilities as $capability ) {
			if ( ! $os->auth->can( $capability ) ) {
				return false;
			}
		}
		if ( null !== $this->gate ) {
			return (bool) call_user_func( $this->gate, $os );
		}
		return true;
	}

	public function style( $path ) {
		$this->style = (string) $path;
		return $this;
	}

	public function style_path() {
		if ( '' !== $this->style ) {
			return $this->style;
		}
		if ( '' === $this->dir ) {
			return '';
		}
		$candidates = array( $this->dir . '/' . $this->id . '.css' );
		if ( '' !== $this->file_base() ) {
			$candidates[] = $this->dir . '/' . $this->file_base() . '.css';
		}
		foreach ( $candidates as $candidate ) {
			if ( is_file( $candidate ) ) {
				return $candidate;
			}
		}
		return '';
	}

	public function located_at( $dir, $file = '' ) {
		$this->dir  = rtrim( (string) $dir, '/\\' );
		$this->file = (string) $file;
		return $this;
	}

	public function dir() {
		return $this->dir;
	}

	public function file() {
		return $this->file;
	}

	public function state( array $defaults ) {
		$this->defaults = $defaults;
		return $this;
	}

	public function menu( $slug, $tabs, $enabled = null ) {
		$this->menu = array(
			'slug'    => (string) $slug,
			'tabs'    => $tabs,
			'enabled' => $enabled,
		);
		return $this;
	}

	public function menu_tabs() {
		if ( ! $this->menu ) {
			return array();
		}
		$tabs = is_callable( $this->menu['tabs'] )
			? (array) call_user_func( $this->menu['tabs'] )
			: (array) $this->menu['tabs'];
		$out  = array();
		foreach ( $tabs as $id => $tab ) {
			$id    = strtolower( (string) preg_replace( '/[^a-zA-Z0-9_-]/', '', (string) $id ) );
			$label = is_array( $tab ) ? (string) ( $tab['label'] ?? '' ) : (string) $tab;
			if ( '' === $id || '' === $label ) {
				continue;
			}
			$out[] = array(
				'id'    => $id,
				'label' => $label,

				'page'  => is_array( $tab ) ? (string) ( $tab['page'] ?? '' ) : '',
			);
		}
		return $out;
	}

	public function menu_slug() {
		return $this->menu ? (string) $this->menu['slug'] : '';
	}

	public function menu_owns_dock() {
		if ( ! $this->menu ) {
			return false;
		}
		return ! is_callable( $this->menu['enabled'] ) || (bool) call_user_func( $this->menu['enabled'] );
	}

	public function mount( callable $mount ) {
		$this->mount = $mount;
		return $this;
	}

	public function action( $name, callable $handler ) {
		$name = strtolower( trim( (string) $name ) );
		if ( ! preg_match( '/^[a-z0-9_-]+$/', $name ) || App\Runtime::ACTION_MOUNT === $name ) {

			throw new \InvalidArgumentException( sprintf( 'Invalid action name "%s".', esc( $name ) ) );
		}
		$this->actions[ $name ] = $handler;
		return $this;
	}

	public function view( callable $view ) {
		$this->view = $view;
		return $this;
	}

	public function data( callable $data ) {
		$this->data = $data;
		return $this;
	}

	public function prefetch( $prefetch = true ) {
		$this->prefetch = (bool) $prefetch;
		return $this;
	}

	public function prefetches() {
		return $this->prefetch && null !== $this->data;
	}

	public function client( $path ) {
		$this->client = (string) $path;
		return $this;
	}

	public function tab( $value, array $args ) {
		$value = strtolower( (string) preg_replace( '/[^a-zA-Z0-9_-]/', '', (string) $value ) );
		if ( '' === $value || 'main' === $value || empty( $args['label'] ) || empty( $args['view'] ) || ! is_callable( $args['view'] ) ) {
			throw new \InvalidArgumentException( 'A tab needs a slug other than "main", a label and a callable view.' );
		}
		$this->tabs[ $value ] = array(
			'value'    => $value,
			'label'    => (string) $args['label'],
			'view'     => $args['view'],
			'position' => isset( $args['position'] ) ? (int) $args['position'] : 100,
		);
		return $this;
	}

	public function on_channel( $channel, $action ) {
		$this->channels[ (string) $channel ] = (string) $action;
		return $this;
	}

	public function watch( ...$types ) {
		foreach ( $types as $type ) {
			$type = '*' === $type ? '*' : strtolower( trim( (string) $type ) );
			if ( '' !== $type && ! in_array( $type, $this->watch, true ) ) {
				$this->watch[] = $type;
			}
		}
		return $this;
	}

	public function title_bar_button( $id, array $args ) {
		$this->title_bar_buttons[] = self::normalise_control( $id, $args, 'right' );
		return $this;
	}

	public function window_action( $id, array $args ) {
		$this->window_actions[] = self::normalise_control( $id, $args, '' );
		return $this;
	}

	public function theme( array $tokens ) {
		$clean = array();
		foreach ( $tokens as $name => $value ) {
			if ( 0 === strpos( (string) $name, '--' ) ) {
				$clean[ (string) $name ] = (string) $value;
			}
		}
		$this->appearance['theme'] = $clean;
		return $this;
	}

	public function controls( array $controls ) {
		$this->appearance['controls'] = $controls;
		return $this;
	}

	public function slot( $slot, $html ) {
		$this->appearance['slots'][ (string) $slot ] = array( 'html' => (string) $html );
		return $this;
	}

	public function config( $config ) {
		if ( is_callable( $config ) ) {
			$this->config_lazy[] = $config;
			return $this;
		}
		$this->config = array_merge( $this->config, (array) $config );
		return $this;
	}

	public function resolved_config() {
		$config = $this->config;
		foreach ( $this->config_lazy as $callable ) {
			$config = array_merge( $config, (array) call_user_func( $callable, $this ) );
		}

		$tabs = $this->menu_tabs();
		if ( $tabs ) {
			$config['menuTabs'] = $tabs;
		}
		return $config;
	}

	public function id() {
		return $this->id;
	}

	public function defaults() {
		if ( ! $this->menu || array_key_exists( 'tab', $this->defaults ) ) {
			return $this->defaults;
		}

		$tabs = $this->menu_tabs();
		return array_merge(
			array( 'tab' => $tabs ? $tabs[0]['id'] : '' ),
			$this->defaults
		);
	}

	public function has_action( $name ) {
		$this->ensure_menu_reopen();
		return isset( $this->actions[ (string) $name ] );
	}

	public function action_names() {
		$this->ensure_menu_reopen();
		return array_keys( $this->actions );
	}

	private function ensure_menu_reopen() {
		if ( $this->menu && ! isset( $this->actions['reopen'] ) ) {
			$this->actions['reopen'] = static function () {};
		}
	}

	public function run_mount( State $state, Os $os ) {
		if ( null !== $this->mount ) {
			call_user_func( $this->mount, $state, $os );
		}
	}

	public function run_action( $name, State $state, Os $os, array $args = array(), $required = true ) {
		if ( ! isset( $this->actions[ $name ] ) ) {
			if ( $required ) {

				throw new \RuntimeException( sprintf( 'Unknown action "%s".', esc( $name ) ) );
			}
			return;
		}
		call_user_func( $this->actions[ $name ], $state, $os, $args );
	}

	public function has_data() {
		return null !== $this->data;
	}

	public function compute_data( State $state, Os $os ) {
		if ( null === $this->data ) {
			return array();
		}
		$data = call_user_func( $this->data, $state, $os );
		return is_array( $data ) ? $data : array();
	}

	public function client_path() {
		return $this->client;
	}

	public function client_source() {
		if ( '' === $this->dir || '' === $this->file_base() ) {
			return '';
		}
		$candidate = $this->dir . '/' . $this->file_base() . '.os.ts';
		return is_file( $candidate ) ? $candidate : '';
	}

	private function file_base() {
		if ( '' === $this->file ) {
			return '';
		}
		return (string) preg_replace( '/\.os\.php$/', '', basename( $this->file ) );
	}

	public function has_view( $view ) {
		return 'main' === $view || isset( $this->tabs[ (string) $view ] );
	}

	public function render( State $state, Os $os, $view = 'main' ) {
		$callable = 'main' === $view || '' === (string) $view
			? $this->view
			: ( isset( $this->tabs[ $view ] ) ? $this->tabs[ $view ]['view'] : null );
		if ( null === $callable ) {
			return '';
		}
		return View::capture( $callable, $state, $os );
	}

	public function tabs() {
		$tabs = array_values(
			array_map(
				static function ( $tab ) {
					return array(
						'value'    => $tab['value'],
						'label'    => $tab['label'],
						'position' => $tab['position'],
					);
				},
				$this->tabs
			)
		);
		usort(
			$tabs,
			static function ( $a, $b ) {
				return $a['position'] <=> $b['position'];
			}
		);
		return $tabs;
	}

	const LIFECYCLE_ACTIONS = array( 'resize', 'show', 'hide', 'focus', 'blur', 'reopen' );

	public function manifest() {
		return array(
			'id'                => $this->id,
			'title'             => $this->title,
			'icon'              => $this->icon,
			'icon_svg'          => $this->icon_svg,
			'width'             => $this->size['width'],
			'height'            => $this->size['height'],
			'min_width'         => $this->size['min_width'],
			'min_height'        => $this->size['min_height'],
			'admin'             => $this->nav['admin'],
			'placement'         => $this->nav['placement'],
			'nav_kind'          => $this->nav['nav_kind'],
			'dock_order'        => $this->nav['dock_order'],
			'placeable'         => $this->nav['placeable'],
			'autofocus'         => $this->nav['autofocus'],
			'desktop_icon'      => $this->desktop_icon,
			'capabilities'      => $this->capabilities,
			'style'             => $this->style_path(),
			'state'             => $this->defaults,
			'actions'           => $this->action_names(),
			'title_bar_buttons' => $this->title_bar_buttons,
			'window_actions'    => $this->window_actions,
			'appearance'        => $this->appearance,
			'config'            => $this->resolved_config(),
			'menu'              => $this->menu_slug(),
			'menu_tabs'         => $this->menu_tabs(),
			'tabs'              => $this->tabs(),
			'channels'          => $this->channels,
			'watch'             => $this->watch,
			'client'            => $this->client_path(),
			'client_source'     => $this->client_source(),
			'file'              => $this->file,
			'has_data'          => $this->has_data(),
			'prefetch'          => $this->prefetches(),
			'lifecycle'         => array_values( array_intersect( self::LIFECYCLE_ACTIONS, $this->action_names() ) ),
		);
	}

	private static function normalise_control( $id, array $args, $default_placement ) {
		$id = strtolower( (string) preg_replace( '/[^a-zA-Z0-9_-]/', '', (string) $id ) );
		if ( '' === $id ) {
			throw new \InvalidArgumentException( 'A title-bar button or window action needs an id.' );
		}
		if ( empty( $args['label'] ) || empty( $args['action'] ) ) {

			throw new \InvalidArgumentException( sprintf( 'Control "%s" needs both a label and an action.', esc( $id ) ) );
		}

		$confirm = null;
		if ( ! empty( $args['confirm'] ) ) {
			$confirm = is_array( $args['confirm'] ) ? $args['confirm'] : array( 'message' => (string) $args['confirm'] );
		}

		$control = array(
			'id'      => $id,
			'label'   => (string) $args['label'],
			'action'  => (string) $args['action'],
			'icon'    => isset( $args['icon'] ) ? (string) $args['icon'] : 'dashicons-admin-generic',
			'order'   => isset( $args['order'] ) ? (int) $args['order'] : 100,
			'confirm' => $confirm,
			'args'    => isset( $args['args'] ) && is_array( $args['args'] ) ? $args['args'] : array(),
		);
		if ( '' !== $default_placement ) {
			$control['placement'] = isset( $args['placement'] ) && 'left' === $args['placement'] ? 'left' : $default_placement;
		}
		return $control;
	}
}
