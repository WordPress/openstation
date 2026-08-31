<?php
/**
 * OpenStation App Framework — the App definition.
 *
 * One object describes a whole OpenStation window: what it is
 * called, how big it opens, which buttons sit in its title bar and
 * its ⋯ menu, what state it keeps, what happens on each action, and
 * how it paints. An `.osx.php` file is nothing but a `return` of one
 * of these:
 *
 *     return App::define( 'hello' )
 *         ->title( 'Hello' )
 *         ->size( 480, 320 )
 *         ->state( array( 'count' => 0 ) )
 *         ->action( 'bump', function ( State $state ) {
 *             $state->set( 'count', $state->get( 'count' ) + 1 );
 *         } )
 *         ->view( function ( State $state ) { ?>
 *             <os-display value="<?php echo esc( $state->get( 'count' ) ); ?>"></os-display>
 *             <os-button variant="primary" os-action="bump">Bump</os-button>
 *         <?php } );
 *
 * The host asks for `manifest()` to learn the window and for
 * `render()` to get its body; `App\Runtime` turns client actions into
 * state changes and re-renders. No JavaScript is written per app.
 *
 * @package OpenStation
 */

namespace OpenStation;

use OpenStation\App\Os;
use OpenStation\App\State;
use OpenStation\App\View;
use function OpenStation\App\Html\esc;

if ( ! defined( 'ABSPATH' ) && ! defined( 'OPENSTATION_STANDALONE' ) ) {
	exit;
}

/**
 * A whole OpenStation window, declared in PHP.
 */
final class App {

	/**
	 * @var string
	 */
	private $id;

	/**
	 * @var string
	 */
	private $title = '';

	/**
	 * @var string
	 */
	private $icon = 'dashicons-admin-generic';

	/**
	 * Icon as raw SVG markup, when the app drew its own.
	 *
	 * @var string
	 */
	private $icon_svg = '';

	/**
	 * @var array{width:int,height:int,min_width:int,min_height:int}
	 */
	private $size = array(
		'width'      => 520,
		'height'     => 400,
		'min_width'  => 280,
		'min_height' => 220,
	);

	/**
	 * @var array<string,mixed>
	 */
	private $nav = array(
		'placement'  => 'dock',
		'nav_kind'   => 'app',
		'dock_order' => 0,
		'placeable'  => false,
		'autofocus'  => false,
	);

	/**
	 * @var array<string,mixed>|null
	 */
	private $desktop_icon = null;

	/**
	 * @var callable|null
	 */
	private $gate = null;

	/**
	 * @var string[]
	 */
	private $capabilities = array();

	/**
	 * @var string
	 */
	private $style = '';

	/**
	 * @var array<string,mixed>
	 */
	private $defaults = array();

	/**
	 * @var callable|null
	 */
	private $mount = null;

	/**
	 * @var array<string,callable>
	 */
	private $actions = array();

	/**
	 * @var callable|null
	 */
	private $view = null;

	/**
	 * @var callable|null
	 */
	private $data = null;

	/**
	 * Built client-view script, absolute path.
	 *
	 * @var string
	 */
	private $client = '';

	/**
	 * @var array<int,array<string,mixed>>
	 */
	private $title_bar_buttons = array();

	/**
	 * @var array<int,array<string,mixed>>
	 */
	private $window_actions = array();

	/**
	 * Per-window chrome: `theme` tokens, `controls`, `slots`.
	 *
	 * @var array<string,mixed>
	 */
	private $appearance = array();

	/**
	 * @var array<string,mixed>
	 */
	private $config = array();

	/**
	 * Extra tabs: `value => array( label, view, position )`.
	 *
	 * @var array<string,array<string,mixed>>
	 */
	private $tabs = array();

	/**
	 * Channel subscriptions: `channel => action`.
	 *
	 * @var array<string,string>
	 */
	private $channels = array();

	/**
	 * @var string
	 */
	private $dir = '';

	/**
	 * @var string
	 */
	private $file = '';

	/**
	 * @param string $id App id — also the window id and the icon id.
	 * @throws \InvalidArgumentException When the id is not a slug.
	 */
	private function __construct( $id ) {
		$id = strtolower( trim( (string) $id ) );
		if ( ! preg_match( '/^[a-z0-9][a-z0-9_-]*$/', $id ) ) {
			throw new \InvalidArgumentException( sprintf( 'Invalid app id "%s": use lowercase letters, digits, "-" and "_".', esc( $id ) ) );
		}
		$this->id = $id;
	}

	/**
	 * Start a definition.
	 *
	 * @param string $id App id.
	 * @return self
	 */
	public static function define( $id ) {
		return new self( $id );
	}

	// -------------------------------------------------------- identity

	/**
	 * Window title (also the desktop icon's label by default).
	 *
	 * @param string $title Title.
	 * @return self
	 */
	public function title( $title ) {
		$this->title = (string) $title;
		return $this;
	}

	/**
	 * Icon: a Dashicons class, an image URL, or raw `<svg>` markup
	 * drawn in `currentColor` (the shell paints it as a mask).
	 *
	 * @param string $icon Icon reference or SVG markup.
	 * @return self
	 */
	public function icon( $icon ) {
		$icon = trim( (string) $icon );
		if ( 0 === strpos( $icon, '<svg' ) ) {
			$this->icon_svg = $icon;
			// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- Building a data: URI for an inline SVG icon, not obfuscating anything.
			$this->icon = 'data:image/svg+xml;base64,' . base64_encode( $icon );
		} else {
			$this->icon_svg = '';
			$this->icon     = $icon;
		}
		return $this;
	}

	/**
	 * Initial window size.
	 *
	 * @param int $width  Pixels.
	 * @param int $height Pixels.
	 * @return self
	 */
	public function size( $width, $height ) {
		$this->size['width']  = max( 1, (int) $width );
		$this->size['height'] = max( 1, (int) $height );
		return $this;
	}

	/**
	 * Smallest size the user can drag the window to.
	 *
	 * @param int $width  Pixels.
	 * @param int $height Pixels.
	 * @return self
	 */
	public function min_size( $width, $height ) {
		$this->size['min_width']  = max( 1, (int) $width );
		$this->size['min_height'] = max( 1, (int) $height );
		return $this;
	}

	/**
	 * Where the launcher goes by default: `'dock'` for a tile in the
	 * dock, `'none'` to rely on a desktop icon or another opener.
	 *
	 * @param string $placement `dock` | `none`.
	 * @return self
	 */
	public function placement( $placement ) {
		$this->nav['placement'] = 'none' === $placement ? 'none' : 'dock';
		return $this;
	}

	/**
	 * What the window is to the navigation model.
	 *
	 * @param string $kind `app` | `control`.
	 * @return self
	 */
	public function nav_kind( $kind ) {
		$this->nav['nav_kind'] = 'control' === $kind ? 'control' : 'app';
		return $this;
	}

	/**
	 * Sort key among dock tiles.
	 *
	 * @param int $order Ascending.
	 * @return self
	 */
	public function dock_order( $order ) {
		$this->nav['dock_order'] = (int) $order;
		return $this;
	}

	/**
	 * Let the user move or hide the dock tile from Preferences.
	 *
	 * @param bool $placeable Default true.
	 * @return self
	 */
	public function placeable( $placeable = true ) {
		$this->nav['placeable'] = (bool) $placeable;
		return $this;
	}

	/**
	 * Focus the body (or a selector inside it) once the window opens.
	 *
	 * @param bool|string $autofocus `true`, or a CSS selector.
	 * @return self
	 */
	public function autofocus( $autofocus = true ) {
		$this->nav['autofocus'] = is_string( $autofocus ) ? $autofocus : (bool) $autofocus;
		return $this;
	}

	/**
	 * Also put a shortcut on the wallpaper.
	 *
	 * @param array<string,mixed> $args `position` (int), `pinned` (bool), `title`, `icon`.
	 * @return self
	 */
	public function desktop_icon( array $args = array() ) {
		$this->desktop_icon = $args;
		return $this;
	}

	// ------------------------------------------------------------ access

	/**
	 * Gate the whole app — window, icon, dispatch — behind a predicate.
	 * Combined with `capabilities()`; both must pass.
	 *
	 * @param callable $gate `function ( Os $os ): bool`.
	 * @return self
	 */
	public function can( callable $gate ) {
		$this->gate = $gate;
		return $this;
	}

	/**
	 * Capabilities the acting user must ALL hold.
	 *
	 * @param string ...$capabilities Capability slugs.
	 * @return self
	 */
	public function capabilities( ...$capabilities ) {
		$this->capabilities = array_values( array_filter( array_map( 'strval', $capabilities ) ) );
		return $this;
	}

	/**
	 * Whether the acting user may use this app.
	 *
	 * @param Os $os Host handle.
	 * @return bool
	 */
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

	// ------------------------------------------------------------- assets

	/**
	 * Stylesheet for the window body. Resolved by convention when
	 * omitted: `<app dir>/<id>.css` if that file exists.
	 *
	 * @param string $path Absolute path to a CSS file.
	 * @return self
	 */
	public function style( $path ) {
		$this->style = (string) $path;
		return $this;
	}

	/**
	 * Absolute stylesheet path, or '' when the app has none. By
	 * convention `<dir>/<id>.css`, else `<dir>/<file>.css` where
	 * `<file>` is the definition file's name without `.osx.php`.
	 *
	 * @return string
	 */
	public function style_path() {
		if ( '' !== $this->style ) {
			return $this->style;
		}
		if ( '' === $this->dir ) {
			return '';
		}
		$candidates = array( $this->dir . '/' . $this->id . '.css' );
		if ( '' !== $this->file ) {
			$candidates[] = $this->dir . '/' . preg_replace( '/\.osx\.php$/', '', basename( $this->file ) ) . '.css';
		}
		foreach ( $candidates as $candidate ) {
			if ( is_file( $candidate ) ) {
				return $candidate;
			}
		}
		return '';
	}

	/**
	 * Record where the definition file lives. Called by the loader.
	 *
	 * @param string $dir  Directory.
	 * @param string $file File path.
	 * @return self
	 */
	public function located_at( $dir, $file = '' ) {
		$this->dir  = rtrim( (string) $dir, '/\\' );
		$this->file = (string) $file;
		return $this;
	}

	/**
	 * Directory the definition was loaded from ('' when defined inline).
	 *
	 * @return string
	 */
	public function dir() {
		return $this->dir;
	}

	/**
	 * File the definition was loaded from ('' when defined inline).
	 *
	 * @return string
	 */
	public function file() {
		return $this->file;
	}

	// ---------------------------------------------------- state & logic

	/**
	 * Declare the state and its defaults. The defaults are the schema:
	 * only these keys exist, and each keeps its declared type.
	 *
	 * @param array<string,mixed> $defaults Key → default value.
	 * @return self
	 */
	public function state( array $defaults ) {
		$this->defaults = $defaults;
		return $this;
	}

	/**
	 * Runs once, before the first render, with the fresh state.
	 *
	 * @param callable $mount `function ( State $state, Os $os )`.
	 * @return self
	 */
	public function mount( callable $mount ) {
		$this->mount = $mount;
		return $this;
	}

	/**
	 * Declare an action. Markup triggers it with `os-action="<name>"`;
	 * the handler mutates the state and the view re-renders.
	 *
	 * @param string   $name    Action name (`[a-z0-9_-]`).
	 * @param callable $handler `function ( State $state, Os $os, array $args )`.
	 * @return self
	 * @throws \InvalidArgumentException When the name is not a slug or is reserved.
	 */
	public function action( $name, callable $handler ) {
		$name = strtolower( trim( (string) $name ) );
		if ( ! preg_match( '/^[a-z0-9_-]+$/', $name ) || App\Runtime::ACTION_MOUNT === $name ) {
			throw new \InvalidArgumentException( sprintf( 'Invalid action name "%s".', esc( $name ) ) );
		}
		$this->actions[ $name ] = $handler;
		return $this;
	}

	/**
	 * The view: paints the body for a state. Echo markup, return a
	 * string, or both.
	 *
	 * @param callable $view `function ( State $state, Os $os )`.
	 * @return self
	 */
	public function view( callable $view ) {
		$this->view = $view;
		return $this;
	}

	/**
	 * The data a client view (`.os.ts`) renders from — everything the
	 * browser needs to paint the body for any state without asking
	 * the server again: rows, options, environment facts. Computed
	 * after every server action, from the same `( State, Os )` a view
	 * gets, and shipped as `data` in the response. Keep it to what
	 * the view reads; it travels on every round trip.
	 *
	 * @param callable $data `function ( State $state, Os $os ): array`.
	 * @return self
	 */
	public function data( callable $data ) {
		$this->data = $data;
		return $this;
	}

	/**
	 * The built client-view script for this app. By convention an app
	 * with `<dir>/<file>.os.ts` beside its `.osx.php` needs no call —
	 * the host resolves the built bundle. Third-party apps that build
	 * their own pass the absolute path of the built file here.
	 *
	 * @param string $path Absolute path to a built `.js`.
	 * @return self
	 */
	public function client( $path ) {
		$this->client = (string) $path;
		return $this;
	}

	/**
	 * An extra tab in the window's tab strip, with its own view. The
	 * main view is the first tab (labelled with the window title).
	 * Each tab runs as its own session: same declared state shape,
	 * separate values, and `$os->view` tells an action which tab
	 * dispatched it.
	 *
	 * @param string              $value Tab slug (not `main`).
	 * @param array<string,mixed> $args  `label` (required), `view` (callable, required), `position` (int, default 100).
	 * @return self
	 * @throws \InvalidArgumentException When the slug, label or view is missing.
	 */
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

	/**
	 * Dispatch an action whenever a peer publishes on one of this
	 * window's channels (`wp.os.connect( id ).send( channel, payload )`
	 * or `Window.send()`). The payload arrives as `$args['payload']`.
	 *
	 * @param string $channel Channel name.
	 * @param string $action  Declared action to run.
	 * @return self
	 */
	public function on_channel( $channel, $action ) {
		$this->channels[ (string) $channel ] = (string) $action;
		return $this;
	}

	// ------------------------------------------------------------ chrome

	/**
	 * A button in the window's title bar that dispatches an action.
	 *
	 * @param string              $id   Button id, unique within the app.
	 * @param array<string,mixed> $args `label` (required), `action` (required), `icon`
	 *                                  (Dashicons class, inline SVG, or a built-in key such
	 *                                  as `reload`), `placement` (`left` | `right`, default
	 *                                  `right`), `order` (int), `confirm` (see `window_action()`).
	 * @return self
	 */
	public function title_bar_button( $id, array $args ) {
		$this->title_bar_buttons[] = self::normalise_control( $id, $args, 'right' );
		return $this;
	}

	/**
	 * A row in the window's ⋯ menu that dispatches an action.
	 *
	 * `confirm` may be a string (the question) or an array with
	 * `title`, `message`, `label`, `danger`; the shell asks before
	 * dispatching.
	 *
	 * @param string              $id   Row id, unique within the app.
	 * @param array<string,mixed> $args `label` (required), `action` (required), `icon`, `order`, `confirm`.
	 * @return self
	 */
	public function window_action( $id, array $args ) {
		$this->window_actions[] = self::normalise_control( $id, $args, '' );
		return $this;
	}

	/**
	 * Per-window CSS variables (`--os-window-…` tokens) — a window theme.
	 *
	 * @param array<string,string> $tokens Token → value.
	 * @return self
	 */
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

	/**
	 * Reorder or hide the standard window controls.
	 *
	 * @param array<string,mixed> $controls `order` (string[]), `hide` (string[]), `placement`.
	 * @return self
	 */
	public function controls( array $controls ) {
		$this->appearance['controls'] = $controls;
		return $this;
	}

	/**
	 * Static HTML for one of the title-bar slots (`before-titlebar`,
	 * `after-titlebar`, `after-title`, …).
	 *
	 * @param string $slot Slot name.
	 * @param string $html Markup.
	 * @return self
	 */
	public function slot( $slot, $html ) {
		$this->appearance['slots'][ (string) $slot ] = array( 'html' => (string) $html );
		return $this;
	}

	/**
	 * Extra values shipped to the client runtime, readable as
	 * `wp.os.getWindowConfig( id ).extra`.
	 *
	 * @param array<string,mixed> $config Serialisable values.
	 * @return self
	 */
	public function config( array $config ) {
		$this->config = array_merge( $this->config, $config );
		return $this;
	}

	// ----------------------------------------------------------- readers

	/**
	 * App id.
	 *
	 * @return string
	 */
	public function id() {
		return $this->id;
	}

	/**
	 * Declared state defaults.
	 *
	 * @return array<string,mixed>
	 */
	public function defaults() {
		return $this->defaults;
	}

	/**
	 * Whether an action is declared.
	 *
	 * @param string $name Action name.
	 * @return bool
	 */
	public function has_action( $name ) {
		return isset( $this->actions[ (string) $name ] );
	}

	/**
	 * Declared action names.
	 *
	 * @return string[]
	 */
	public function action_names() {
		return array_keys( $this->actions );
	}

	/**
	 * Run the mount hook, if any.
	 *
	 * @param State $state State.
	 * @param Os    $os    Host handle.
	 * @return void
	 */
	public function run_mount( State $state, Os $os ) {
		if ( null !== $this->mount ) {
			call_user_func( $this->mount, $state, $os );
		}
	}

	/**
	 * Run an action.
	 *
	 * @param string              $name     Action name.
	 * @param State               $state    State.
	 * @param Os                  $os       Host handle.
	 * @param array<string,mixed> $args     Arguments from the trigger.
	 * @param bool                $required Throw when the action is undeclared. Default true.
	 * @return void
	 * @throws \RuntimeException When `$required` and the action is undeclared.
	 */
	public function run_action( $name, State $state, Os $os, array $args = array(), $required = true ) {
		if ( ! isset( $this->actions[ $name ] ) ) {
			if ( $required ) {
				throw new \RuntimeException( sprintf( 'Unknown action "%s".', esc( $name ) ) );
			}
			return;
		}
		call_user_func( $this->actions[ $name ], $state, $os, $args );
	}

	/**
	 * Whether the app declared a `data()` callback.
	 *
	 * @return bool
	 */
	public function has_data() {
		return null !== $this->data;
	}

	/**
	 * Compute the client data for a state.
	 *
	 * @param State $state State.
	 * @param Os    $os    Host handle.
	 * @return array<string,mixed>
	 */
	public function compute_data( State $state, Os $os ) {
		if ( null === $this->data ) {
			return array();
		}
		$data = call_user_func( $this->data, $state, $os );
		return is_array( $data ) ? $data : array();
	}

	/**
	 * Explicit built client script path, or ''.
	 *
	 * @return string
	 */
	public function client_path() {
		return $this->client;
	}

	/**
	 * The `.os.ts` source beside the definition file, or '' when the
	 * app has none. The host maps it to its built bundle.
	 *
	 * @return string
	 */
	public function client_source() {
		if ( '' === $this->dir || '' === $this->file ) {
			return '';
		}
		$candidate = $this->dir . '/' . preg_replace( '/\.osx\.php$/', '', basename( $this->file ) ) . '.os.ts';
		return is_file( $candidate ) ? $candidate : '';
	}

	/**
	 * Whether a view exists: `main`, or a declared tab slug.
	 *
	 * @param string $view View name.
	 * @return bool
	 */
	public function has_view( $view ) {
		return 'main' === $view || isset( $this->tabs[ (string) $view ] );
	}

	/**
	 * Paint a view for a state.
	 *
	 * @param State  $state State.
	 * @param Os     $os    Host handle.
	 * @param string $view  `main` (default) or a tab slug.
	 * @return string HTML.
	 */
	public function render( State $state, Os $os, $view = 'main' ) {
		$callable = 'main' === $view || '' === (string) $view
			? $this->view
			: ( isset( $this->tabs[ $view ] ) ? $this->tabs[ $view ]['view'] : null );
		if ( null === $callable ) {
			return '';
		}
		return View::capture( $callable, $state, $os );
	}

	/**
	 * Declared tabs, without their callables, by position.
	 *
	 * @return array<int,array{value:string,label:string,position:int}>
	 */
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

	/**
	 * Lifecycle moments the runtime reports as actions — only when
	 * the app declared a handler of that name.
	 */
	const LIFECYCLE_ACTIONS = array( 'resize', 'show', 'hide', 'focus', 'blur' );

	/**
	 * The whole window as data — everything a host needs to register
	 * it and everything the client runtime needs to drive it.
	 *
	 * @return array<string,mixed>
	 */
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
			'config'            => $this->config,
			'tabs'              => $this->tabs(),
			'channels'          => $this->channels,
			'client'            => $this->client_path(),
			'client_source'     => $this->client_source(),
			'has_data'          => $this->has_data(),
			'lifecycle'         => array_values( array_intersect( self::LIFECYCLE_ACTIONS, $this->action_names() ) ),
		);
	}

	/**
	 * Normalise a title-bar button / window-action declaration.
	 *
	 * @param string              $id                Control id.
	 * @param array<string,mixed> $args              Declaration.
	 * @param string              $default_placement `right` for buttons, '' for menu rows.
	 * @return array<string,mixed>
	 * @throws \InvalidArgumentException When the id, label or action is missing.
	 */
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
