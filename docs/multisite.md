# Multisite

*Experimental.* What OpenStation does on a network, and the constraint
that decides the shape of all of it.

## The constraint: nothing cross-admin can be a window

A window is an iframe, and WordPress refuses to be framed cross-origin:
every admin response carries `X-Frame-Options: SAMEORIGIN` and
`frame-ancestors 'self'` (core hooks `send_frame_options_header` on
`admin_init`).

| Network | Sibling site | Auth cookies in an iframe |
|---|---|---|
| Subdirectory (`example.com/site2/`) | same origin | sent |
| Subdomain (`site2.example.com`) | different origin, same site | sent — core sets `COOKIE_DOMAIN` to `.example.com` |
| Domain-mapped (`site2.com`) | different origin, different site | third-party, blocked by Safari, partitioned by Firefox |

The network admin is on the **network's** domain (`network_site_url()`
builds from `get_network()->domain`), never the current site's, so it is
cross-origin from any subdomain or mapped site too. So anything leaving
the current admin **opens a browser tab**: one behaviour on all three
shapes, and it leaves the desktop the user is standing on intact.
Cross-admin windows are therefore not supported, and neither is a
network-wide desktop, since windows have no site identity.

**Same origin is not the same admin.** The unit is the **admin scope**:
the site root up to and including the first `/wp-admin/`, plus the
`network/` or `user/` segment when there is one — the client-side twin of
`self_admin_url()`. A site root alone is not enough: the network admin
sits UNDER the main site's admin and shares its prefix, so
`/wp-admin/index.php` and `/wp-admin/network/` would read as one place.
`adminScope()` in `src/chromeless-bridge.js` is the only copy of that
rule (a second one in the shell drifted out of sync within a day), and
the bridge opens a tab for any link leaving its scope — which is what the
Sites list does on each "Dashboard" link. If a window ever does show
another admin, its `os-plugins-changed` payload repaints this dock with
that admin's menu: the symptom to recognise.

## The network admin

**The network admin has its own shell screen**, at
`wp-admin/network/admin.php?page=openstation`. The screen is registered
on `network_admin_menu` as well as `admin_menu`, and `network/admin.php`
routes `?page=` exactly as `admin.php` does. Two screens rather than one
because a window belongs to the admin whose dock is behind it: opening a
network screen on the site shell is one admin inside another's desktop.

`openstation_shell_url()` follows the admin its **target** lives in, so
every route into the desktop lands on the matching screen without its
caller knowing which. `admin-ajax.php` is the exception, having no
context of its own: the admin bar's **Switch to OpenStation** reports
where it was clicked and the handler confirms `manage_network` before
honouring it.

Two things then have to know about `wp-admin/network/`: the target
allowlist, which resolves the network's own filenames through
`openstation_network_admin_target_allowlist()` (the site list cannot
stand in, since the directories share filenames that mean different
things), and menu URLs, `currentPage` and `adminUrl`, which resolve
through `self_admin_url()` rather than `admin_url()`.

**Native windows are not offered there.** Every one OpenStation ships is
site-scoped — Posts, Users and the rest read the current site's REST API
— so a `users.php` tile meaning "everyone on the network" would have
opened one site's user list. That server-side gate is also what disarms
the client-side URL remaps there.

## The Network Admin dock tile

Only on a multisite, only with `manage_network`. It mirrors the admin
bar's Network Admin node with core's own capability gates (copied from
`wp_admin_bar_my_sites_menu()`), and hides itself inside the network
admin where the dock already *is* that menu. It reads
`wp.os.config.multisite` (`MultisiteConfig` in `src/types.ts`), null
without the capability.

It registers with `navKind: 'core'`
([javascript-reference.md](./javascript-reference.md)), so it paints with
the admin menus, moves to the sidebar with them in the split layout, and
lands second in that run — `computeNav()` slots a core TILE in behind the
lead menu.

**There is deliberately no site switcher, and nothing that names the
current site.** A top-left chip with the site's icon, name and a switcher
was built and taken back out. So which site you are on goes unsaid: the
admin bar is hidden by default (`adminBarMode` defaults to `'hidden'`),
and the dock is built from an admin menu near-identical across sites.

## Storage scoping

OS settings, wallpaper, theme and accent are user meta, so network-wide;
desktop files and folders are per-blog tables, so per site. **The session
is per ADMIN, and that is the one that changed** — one per site, plus one
of the network admin's own. See `openstation_session_meta_key()` for why,
and for why the main site keeps the bare key. The network admin cannot
share the main site's blob even though it runs in that site's blog
context: the two desktops derive the same window ids from different
admins (`index-php` is the site dashboard on one, the network dashboard
on the other), so a shared session restored one admin's dashboard on the
other's desktop and handed its window id to the dock's Dashboard tile.

The session REST route runs in the main site's blog context whichever
desktop is saving, so the network screen's `sessionUrl` carries
`network=1` and the handlers honour it only alongside `manage_network` —
see `openstation_rest_session_network()`. Both read and write filter
windows to the session's own admin scope, so a blob written before the
keys split heals instead of leaking across.

Deleting a subsite drops the plugin's per-site tables with Core's own —
`openstation_filter_wpmu_drop_tables()` on the `wpmu_drop_tables`
filter, fed by a static name list (`openstation_site_table_names()`)
so the cleanup works whether or not the feature that created a table is
enabled on the request that deletes the site.

## What a site admin is offered

The Plugins window follows Core's multisite split: per-site activate
and deactivate stay, while install, upload and delete never appear on a
site desktop — plugin files are network-wide and Core's own site
screens offer none of the three, so neither do the window's caps
(`openstation_plugins_window_caps()`), its per-row flags, or its
marketplace AJAX endpoints, even for a super admin who holds the
capabilities everywhere.

## The user admin

`wp-admin/user/` — multisite's dashboard for users with no site role —
renders classic. It has no shell screen, and its URLs never survive the
target allowlist; links to it from inside a window still open a browser
tab through the bridge's admin-scope rule.
