# PWA install — surface your own button

Stable.

The framework already registers a persistent "Install" tile on the
dock (`id: 'os-pwa-install'`). Clicking it dispatches the
browser's install prompt or shows a contextual toast when install
isn't currently possible. If you want to add a redundant entry point
(a button in your own settings tab, a header in your plugin's
window), use the public PWA surface.

## Add an "Install as App" button to a settings tab

```js
wp.os.ready( () => {
    wp.os.registerSettingsTab( {
        id: 'my-plugin/app',
        label: 'App',
        order: 50,
        render( host ) {
            const btn = document.createElement( 'button' );
            btn.type = 'button';
            btn.textContent = 'Install as app';
            btn.addEventListener( 'click', async () => {
                const choice = await wp.os.pwa.promptInstall();
                if ( choice === 'unavailable' ) {
                    wp.os.showToast( {
                        message: 'Already installed, or the browser doesn\'t support installing this site.',
                    } );
                    return;
                }
                if ( choice === 'accepted' ) {
                    wp.os.showToast( { message: 'Installed!' } );
                }
            } );
            host.appendChild( btn );

            // Show a "reset" link if the user has dismissed the
            // built-in pill — re-surface it on demand.
            wp.os.pwa.subscribe( ( state ) => {
                btn.disabled = ! state || ! window.matchMedia(
                    '(display-mode: standalone)'
                ).matches === false;
            } );
        },
    } );
} );
```

## Read install state

```js
const state = wp.os.pwa.getState();
// { installHintDismissed: boolean, notificationsEnabled: boolean }

if ( state.installHintDismissed ) {
    // The user told the framework to stop showing the pill.
    // Be polite — don't ambush them with a giant install banner.
}
```

## Trigger the prompt only when truly available

`promptInstall()` resolves to `'unavailable'` when:

- the browser hasn't fired `beforeinstallprompt` yet,
- the app is already installed (`display-mode: standalone`),
- or the browser doesn't support installable web apps (Safari, most
  in-app webviews).

Wrap your CTA so it only renders when the framework is in a position to
honour it:

```js
let canPrompt = false;
window.addEventListener( 'beforeinstallprompt', () => { canPrompt = true; } );

document.querySelector( '#my-plugin-install-cta' ).hidden = ! canPrompt;
```

The framework consumes the `beforeinstallprompt` event itself (calls
`preventDefault` so Chromium's mini-info-bar doesn't fight your UI), but
the listener above still fires before the framework's handler runs.

## Customise the manifest

Default icons come from the WordPress Site Icon when set, falling back
to the plugin's bundled logo. Override completely via
`open_station_pwa_manifest`:

```php
add_filter( 'open_station_pwa_manifest', static function ( array $manifest ) {
    $manifest['name']        = 'Acme Console';
    $manifest['short_name']  = 'Acme';
    $manifest['theme_color'] = '#7e22ce';
    $manifest['icons']       = [
        [
            'src'     => plugins_url( 'assets/app-192.png', __FILE__ ),
            'sizes'   => '192x192',
            'type'    => 'image/png',
            'purpose' => 'any maskable',
        ],
        [
            'src'     => plugins_url( 'assets/app-512.png', __FILE__ ),
            'sizes'   => '512x512',
            'type'    => 'image/png',
            'purpose' => 'any maskable',
        ],
    ];
    $manifest['shortcuts']   = [
        [
            'name'  => 'New Post',
            'url'   => '/wp-admin/post-new.php',
            'icons' => [ [ 'src' => '/icon-pencil.png', 'sizes' => '96x96' ] ],
        ],
    ];
    return $manifest;
} );
```
