# Ship a window as an `.osx.php` app

A complete OpenStation window from one PHP file: state, actions, a
title-bar button, a ⋯-menu row, auto-refresh, and a confirm dialog —
no JavaScript. The full reference is
[`app-framework.md`](../app-framework.md); the shipped example is
`apps/code-blue/`.

## 1. Point the framework at your plugin's `apps/` folder

```php
<?php
/**
 * Plugin Name: My Desktop Extension
 */
defined( 'ABSPATH' ) || exit;

add_filter( 'openstation_apps_directories', static function ( array $dirs ) {
	$dirs[] = __DIR__ . '/apps';
	return $dirs;
} );
```

## 2. Write the app — `apps/notes-counter/notes-counter.osx.php`

```php
<?php
use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;
use function OpenStation\App\Html\attr;
use function OpenStation\App\Html\esc;

defined( 'ABSPATH' ) || exit;

return App::define( 'notes-counter' )
	->title( __( 'Notes counter', 'my-plugin' ) )
	->icon( 'dashicons-edit' )
	->size( 480, 320 )
	->capabilities( 'edit_posts' )
	->desktop_icon( array( 'position' => 40 ) )

	// The schema: only these keys exist, each with its type.
	->state( array( 'status' => 'draft', 'auto' => false, 'note' => '' ) )

	// Chrome, from PHP.
	->title_bar_button( 'refresh', array(
		'label'  => __( 'Refresh', 'my-plugin' ),
		'icon'   => 'reload',
		'action' => 'refresh',
	) )
	->window_action( 'trash-drafts', array(
		'label'   => __( 'Trash every draft', 'my-plugin' ),
		'icon'    => 'dashicons-trash',
		'action'  => 'trash-drafts',
		'confirm' => array(
			'title'   => __( 'Trash every draft?', 'my-plugin' ),
			'message' => __( 'They move to the Trash and can be restored for 30 days.', 'my-plugin' ),
			'danger'  => true,
		),
	) )

	// Actions mutate the state; the view re-renders after each one.
	->action( 'refresh', static function () {} )
	->action( 'trash-drafts', static function ( State $state, Os $os ) {
		foreach ( get_posts( array( 'post_status' => 'draft', 'numberposts' => -1, 'fields' => 'ids' ) ) as $id ) {
			wp_trash_post( $id );
		}
		$os->toast( __( 'Drafts trashed.', 'my-plugin' ), 'success' );
	} )

	// The view is a function of the state. Derived data is computed
	// here, never stored in the state.
	->view( static function ( State $state, Os $os ) {
		$counts = wp_count_posts();
		$status = $state->get( 'status' );
		$total  = isset( $counts->{$status} ) ? (int) $counts->{$status} : 0;
		?>
		<os-panel>
			<os-segmented label="<?php echo esc( __( 'Status', 'my-plugin' ) ); ?>" os-bind="status" value="<?php echo esc( $status ); ?>">
				<os-segment value="draft"><?php echo esc( __( 'Drafts', 'my-plugin' ) ); ?></os-segment>
				<os-segment value="publish"><?php echo esc( __( 'Published', 'my-plugin' ) ); ?></os-segment>
			</os-segmented>

			<os-display size="xl" value="<?php echo esc( number_format( $total ) ); ?>"></os-display>

			<os-text-field label="<?php echo esc( __( 'Note to self', 'my-plugin' ) ); ?>" os-bind="note" value="<?php echo esc( $state->get( 'note' ) ); ?>"></os-text-field>
			<?php if ( '' !== $state->get( 'note' ) ) : ?>
				<os-notice tone="info" not-dismissible><?php echo esc( $state->get( 'note' ) ); ?></os-notice>
			<?php endif; ?>

			<os-cluster justify="space-between">
				<os-switch label="<?php echo esc( __( 'Auto-refresh', 'my-plugin' ) ); ?>" os-bind="auto"<?php echo attr( array( 'checked' => $state->get( 'auto' ) ) ); ?>></os-switch>
				<os-button variant="danger" os-action="trash-drafts"
					os-confirm="<?php echo esc( __( 'Move every draft to the Trash?', 'my-plugin' ) ); ?>" os-confirm-danger>
					<?php echo esc( __( 'Trash drafts', 'my-plugin' ) ); ?>
				</os-button>
			</os-cluster>

			<?php if ( $state->get( 'auto' ) ) : ?>
				<span os-poll="15000" os-action="refresh" hidden></span>
			<?php endif; ?>
		</os-panel>
		<?php
	} );
```

What each line buys you:

- `os-bind="status"` on the segmented control writes the pick into the state and re-renders — the count changes with no handler at all.
- `os-bind="note"` on the text field debounces typing (250 ms) and re-renders; the notice appears as you type.
- `os-confirm` on the button asks through `wp.os.confirm` before the action runs; the ⋯ row does the same through its `confirm` array.
- `os-poll` exists only while `auto` is on — render it conditionally and the runtime starts and stops the timer for you.
- `$os->toast()` is an **effect**: the shell shows it after the body has morphed.

## 3. Style it — `apps/notes-counter/notes-counter.css` (optional)

A stylesheet named after the app id, beside the `.osx.php`, is picked up automatically and injected on the window's first open.

```css
.os-app[data-os-app='notes-counter'] os-display {
	color: var( --os-ui-accent, #2271b1 );
}
```

## 4. Drive it from JavaScript (optional)

```js
// Bump the window from another bundle, e.g. after a REST mutation.
wp.os.apps.dispatch( 'notes-counter', 'refresh' );
```

## 5. Make it instant (optional) — `apps/notes-counter/notes-counter.os.ts`

If the window re-slices rows it already has, keep the body in the browser: move the rows into `->data()` on the PHP side and add a client view. `os-bind` writes and `local` actions never make a request; `refresh` and `trash-drafts` still do.

```ts
import { defineApp, html, __ } from '@openstation/app';

interface State extends Record< string, unknown > { status: string; note: string; auto: boolean }
interface Data { counts: Record< string, number > }

export default defineApp< State, Data >( 'notes-counter', {
	view: ( { state, data } ) => html`
		<os-panel>
			<os-segmented label=${ __( 'Status' ) } os-bind="status" value=${ state.status }>
				<os-segment value="draft">${ __( 'Drafts' ) }</os-segment>
				<os-segment value="publish">${ __( 'Published' ) }</os-segment>
			</os-segmented>
			<os-display size="xl" value=${ String( data.counts[ state.status ] ?? 0 ) }></os-display>
			<os-button os-action="refresh">${ __( 'Refresh' ) }</os-button>
			${ state.auto ? html`<span os-poll="15000" os-action="refresh" hidden></span>` : '' }
		</os-panel>
	`,
} );
```

```php
->data( static function () {
	return array( 'counts' => (array) wp_count_posts() );
} )
```

`npm run build:apps` builds it; the host loads it with the window. See [`app-framework.md` → The client view](../app-framework.md#the-client-view--osts).

## Running it outside WordPress

The same file runs on a bare PHP host through the standalone adapters —
see [Standalone host in three lines](../app-framework.md#standalone-host-in-three-lines).
Only the two `get_posts()` / `wp_count_posts()` calls above are
WordPress-specific; an app that talks to the host through `$os` alone
needs no changes.
