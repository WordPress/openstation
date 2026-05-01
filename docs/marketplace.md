# Extensions Marketplace

*Experimental (since 0.6.0).* The marketplace lists Desktop Mode
extensions advertised by the official release and lets users install
them in one click from inside OS Settings → Extensions.

This document is for two audiences:

1. **Plugin authors** who want to publish a new extension into the
   marketplace.
2. **Operators** who want to point their Desktop Mode install at a
   different (forked, private, or air-gapped) marketplace.

If you're just *consuming* the marketplace as an end user, the OS
Settings → Extensions tab is the only thing you need.

## Architecture in one diagram

```
┌──────────────────────┐
│  GitHub release tag  │  vX.Y.Z
└──────────┬───────────┘
           │
           │  CI runs:
           │   - bin/package.sh           → desktop-mode.zip
           │   - bin/package-extensions.sh → dist/<slug>.zip per extension
           │   - bin/build-manifest.sh     → dist/extensions.resolved.json
           │
           ▼
┌──────────────────────────────┐
│ GitHub Release assets        │
│  ├── desktop-mode.zip        │
│  ├── desktop-mode-foo.zip    │
│  ├── desktop-mode-bar.zip    │
│  └── extensions.resolved.json│   ← consumed by the WP plugin
└──────────────┬───────────────┘
               │
               │  GET releases/latest/download/extensions.resolved.json
               │
               ▼
┌──────────────────────────────┐
│ Desktop Mode WP plugin       │
│ (cached in a 15-min site     │
│  transient)                  │
└──────────┬───────────────────┘
           │
           │  Plugin_Upgrader::install( <download_url> )
           ▼
┌──────────────────────────────┐
│ wp-content/plugins/<slug>/   │
└──────────────────────────────┘
```

The marketplace is a **read-only listing on top of standard
WordPress plugin install plumbing.** No custom installer, no shadow
plugin folder — extensions land where any other plugin would and are
managed by `Plugin_Upgrader`, `activate_plugin()`, `delete_plugins()`.

## Adding an extension to the marketplace

1. **Build the plugin under `extensions/<slug>/`** in this repo. The
   `<slug>` becomes the plugin folder name on disk; the entry file
   must be `<slug>/<slug>.php` with a standard plugin header
   (`Plugin Name:`, `Version:`, `Requires Plugins: desktop-mode`,
   `Requires at least:`, `Requires PHP:`). The two extensions in tree
   are good examples.

2. **Append an entry to `extensions.json`** at the repo root:

   ```json
   {
       "slug": "desktop-mode-my-extension",
       "name": "My Extension",
       "short_description": "One-sentence pitch shown on the marketplace card.",
       "icon": null,
       "homepage": "https://github.com/WordPress/desktop-mode/tree/trunk/extensions/desktop-mode-my-extension",
       "environments": ["local", "development", "staging", "production"]
   }
   ```

   `version`, `requires_wp`, `requires_php`, and `download_url` are
   filled in automatically at release time by `bin/build-manifest.sh`
   from the plugin header. Do **not** put them in the curated catalog
   — that would duplicate a value that drifts.

   `environments` is the gate. If the current site's
   `wp_get_environment_type()` isn't in the list, the marketplace
   shows the card but disables install/activate. Use `["local"]` for
   anything that's only safe in dev (e.g. phpMyAdmin).

3. **Tag a release** (`vX.Y.Z`). The `release.yml` workflow will
   package every extension under `extensions/` and upload them as
   release assets, alongside the resolved manifest pointing at this
   tag.

4. **Wait for the WP transient to expire** (or click *Refresh* in
   OS Settings → Extensions). The new entry appears.

### Vendored content (e.g. embedded binaries)

`bin/package-extensions.sh` automatically runs any `bin/fetch-*.sh`
script an extension ships, then splices the resulting working-tree
content (under `assets/vendor/*`) into the zip. The phpMyAdmin
extension uses this pattern — its `bin/fetch-phpmyadmin.sh` downloads
the upstream phpMyAdmin tarball during the release build, and the zip
ships with it pre-bundled.

Fetcher scripts are required to be idempotent (bail out cheaply if
their target is already populated). The script runs them
unconditionally on every package build.

## Pointing the marketplace at a different release

The default manifest URL is

    https://github.com/WordPress/desktop-mode/releases/latest/download/extensions.resolved.json

Override with the `wp_desktop_marketplace_manifest_url` filter:

```php
add_filter( 'wp_desktop_marketplace_manifest_url', function () {
    return 'https://my-internal-host/desktop-mode/extensions.resolved.json';
} );
```

You'll also want to extend the SSRF allowlist if your zips live on a
host other than `github.com` / `objects.githubusercontent.com` /
`codeload.github.com`:

```php
add_filter( 'wp_desktop_marketplace_allowed_hosts', function ( $hosts ) {
    $hosts[] = 'my-internal-host';
    return $hosts;
} );
```

The host of the manifest URL itself is added implicitly, but
extension `download_url` values may live on a different host (a CDN,
a release-asset bucket) — that's why the allowlist exists separately.

## Local-dev escape hatch

For developers iterating on an extension without cutting a release:

```php
// wp-config.php
define( 'WP_DEBUG', true );
```

When `WP_DEBUG` is on AND the running plugin folder also contains
`extensions.json` and an `extensions/` directory (which is true when
the plugin is symlinked or live-mounted from a source checkout), the
local-dev path activates automatically — no further config needed.

For unusual setups where the plugin is NOT mounted from the source
checkout (e.g. wp-env mounting plugins one place and the repo
elsewhere), you can override with an explicit path:

```php
define( 'WP_DEBUG', true );
define( 'WP_DESKTOP_LOCAL_MARKETPLACE_DIR', '/abs/path/to/desktop-mode-checkout' );
```

In either case:

- **Manifest** is synthesized in PHP from `extensions.json` plus each
  plugin's header at the checkout (mirroring what
  `bin/build-manifest.sh` produces in CI). No release dependency, no
  network call, no transient cache — header changes (`Version`,
  `Requires PHP`, …) appear immediately on the next list fetch.

- **Install / update** calls run `bin/package-extensions.sh` against
  the checkout and install the freshly-built `dist/<slug>.zip` from
  disk instead of downloading.

This means the marketplace works end-to-end against a checkout — useful
for testing the whole loop before any release that ships
`extensions.resolved.json` exists, and for extension authors iterating
on a slug.

The hatch refuses to fire if `php exec()` is disabled or
`bin/package-extensions.sh` isn't executable. Production hosts almost
always disable `exec`, so this is a no-op in real deployments even if
the constants leak in.

Caveat: in local-dev mode, `download_url` is left empty on each
manifest entry, so installed extensions don't surface in WP's native
`site_transient_update_plugins` (the SSRF allowlist would reject an
empty URL). The inline "Update available" banner inside the
Extensions tab still works because it's computed from version diff,
not from the update transient.

## Update detection

The marketplace integrates with WP's native plugin-update transient
(`site_transient_update_plugins`). Any installed extension whose
manifest version is greater than the installed version surfaces in:

- Dashboard → Updates
- Plugins screen ("update available" inline)
- Admin-bar Updates badge
- WP-CLI `wp plugin update`

…in addition to the inline "Update" banner inside the OS Settings →
Extensions card. The two paths share state — clicking either runs
the same `Plugin_Upgrader::install( <download_url> )` call with
`clear_destination` overridden so the existing folder is replaced.

The manifest cache (15 minutes) is busted automatically after every
install / update / delete, and after any
`upgrader_process_complete` action that targets a plugin — so the
"needs update" indicator catches up with reality without waiting for
the transient to expire.

## See also

- [`bin/package-extensions.sh`](../bin/package-extensions.sh) — per-extension zip builder.
- [`bin/build-manifest.sh`](../bin/build-manifest.sh) — resolved-manifest emitter.
- [`includes/marketplace/`](../includes/marketplace/) — REST + installer + updates filter.
- [`src/settings/sections/extensions/`](../src/settings/sections/extensions/) — frontend UI.
- [Hooks Reference → Extensions marketplace](./hooks-reference.md#extensions-marketplace--experimental-since-060) — filter / action / REST surface.
