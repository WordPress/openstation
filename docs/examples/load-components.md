# Use `<os-*>` components from a plugin that ships as a zip

**Surface:** [`wp.os.loadComponents( tags? )`](../javascript-reference.md#wposloadcomponents-tags---stable) · **Status:** Stable

The component kit registers per bundle, at import time. After boot the page has 26 of the 64 tags — whichever ones `desktop.min.js`, `shell-overlays` and `window-system` happened to import for their own UI. `<os-switch>`, `<os-number-field>`, `<os-table>` and 35 others are not among them.

If your plugin is built beside this repo you can [import them](../use-from-a-plugin.md). If it installs from a zip onto a site that already has OpenStation, there is no path to import from at build time — and that is what this API is for.

```javascript
await wp.os.loadComponents( [ 'os-switch', 'os-number-field' ] );
```

One `await`, and the tags upgrade.

## A settings panel

```javascript
( function () {
    const TAGS = [ 'os-panel', 'os-row', 'os-switch', 'os-number-field', 'os-button' ];

    async function renderSettings( host ) {
        // Cheap on every call: with the tags already registered this
        // resolves without touching the network. Don't memoize it.
        await wp.os.loadComponents( TAGS );

        host.innerHTML = `
            <os-panel heading="Delivery">
                <os-row>
                    <os-switch id="live" label="Send immediately"></os-switch>
                </os-row>
                <os-row>
                    <os-number-field id="retries" label="Retries" min="0" max="9" value="3">
                    </os-number-field>
                </os-row>
                <os-row>
                    <os-button id="save" variant="primary">Save</os-button>
                </os-row>
            </os-panel>
        `;

        host.querySelector( '#save' ).addEventListener( 'click', () => {
            save( {
                live: host.querySelector( '#live' ).checked,
                retries: Number( host.querySelector( '#retries' ).value ),
            } );
        } );
    }

    wp.os.ready( () => {
        renderSettings( document.getElementById( 'my-plugin-settings' ) );
    } );
} )();
```

Your script needs the shell as a dependency so `wp.os` exists when it runs:

```php
wp_enqueue_script(
    'my-plugin-settings',
    plugins_url( 'settings.js', __FILE__ ),
    array( 'openstation' ),
    '1.0.0',
    true
);
```

## What it costs

`os-components[.min].js` is **309 KB raw / 77 KB gzip** — the whole kit, including the components the page already had. A lazy bundle cannot import from `desktop.min.js`, so that overlap can't be avoided; what it can be is unpaid, and it is, by every page that never calls this.

Rules of thumb:

| You want… | Do this |
|---|---|
| Two or three tags, and you already ship a bundle | `import` the classes — ~3 KB gzip each, nothing at runtime |
| The kit, or several components across several screens | `loadComponents()` — one fetch, cached, shared with anything else that asks |
| A zip-distributed plugin with no build-time link to this repo | `loadComponents()` — it is the only route that works |

## Details worth knowing

**Pass the tags you're about to render.** The argument is what lets the loader skip the fetch when they're already there; `loadComponents()` with no argument always loads the kit.

**Names that aren't components** get a `console.error` naming them, and the rest of the call proceeds — a typo costs you one component, not the panel.

**It never double-registers.** The custom-element registry is page-global and `defineComponent()` no-ops on a tag that exists, so a tag another plugin loaded first is simply used.

**Failure is loud in the right place.** The promise rejects only if the bundle was needed and the fetch failed. On a page where no bundle URL is configured it resolves instead, and any tag that stayed inert is named by the [missing-import warner](../components-reference.md) in the console — the same message a developer would get from a forgotten import.

## See also

- [`components-reference.md`](../components-reference.md) — every tag, class, and `static help` descriptor
- [`use-from-a-plugin.md`](../use-from-a-plugin.md) — the build-time route, types, and class imports
- OpenStation Preferences → Components — the whole kit rendered live, with props and working examples
