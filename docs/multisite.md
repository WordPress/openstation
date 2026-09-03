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
cross-origin from any subdomain or mapped site too. Cross-admin windows
are therefore not supported, and neither is a network-wide desktop,
since windows have no site identity. Anything leaving the current admin
**hops** instead — see the next section — and cross-origin URLs, which
cannot hop through a same-origin navigation's view transition, open a
browser tab as they always did.

## Site Spaces

A same-origin click that leaves the current admin — the Network Admin
tile and its flyout rows, the Sites list's "Dashboard" links inside a
window — opens the target **in that admin's own Space**: the virtual
desktop scoped to it, created on first use (labelled after the site, or
"Network Admin"), slid to with the desktops switcher's own animation,
and reused by every later click for the same admin. The page itself is
an ordinary iframe window on that desktop, which is why this only
exists where framing does (see the table above): a **cross-origin**
admin opens a browser tab instead, and a **modifier or middle click**
opens one anywhere — the universal "open elsewhere" gesture.
`createSpaceOpener()` in `src/multisite/spaces.ts` owns the whole rule;
the dock tile and the bridge both route through the one opener, so the
two entry points cannot disagree. The shell's own admin never gets a
Space — its desktop is the primary one — so a click that targets it
while the user is standing in a Space (the main site's Dashboard row in
the network Sites list, seen from the main site's own shell) goes home
first rather than dropping the home admin's window onto another admin's
desktop.

The desktop carries its admin as `Desktop.scope` (an admin-scope path,
below), and three behaviors hang off it:

- **Its windows persist.** The per-admin session scoping (Storage
  scoping) makes exactly one exception: a window whose URL's admin
  scope equals its desktop's declared scope survives sanitize and
  read — `openstation_session_window_url_ok()`. Same host required;
  the scope value itself is validated as a normalized admin-scope
  path (`openstation_session_desktop_scope()`).
- **Closing the Space closes them.** `closeDesktop()` migrates a
  normal desktop's windows to the neighbour; a scoped desktop's own
  admin's windows close with it — migrating them would put another
  admin's windows on a desktop with no business hosting them, and the
  sanitizer would drop them at the next save anyway.
- **Their payloads are quarantined.** A Space's window is another
  admin's page: its `os-plugins-changed` payload describes THAT
  admin's menu and is dropped whole, and its `os-menu-signature`
  fingerprints are ignored (`frameSourceIsOtherAdmin()` in
  `src/boot/menu-refresh.ts`) — otherwise the first `plugins.php`
  opened in a Space would repaint this dock with the other admin's
  menu, and every Space navigation would spend a refresh probe.
  `os-updates-changed` is deliberately NOT quarantined: plugin and
  theme updates are network-wide, and the probe it spends runs
  against this shell's own admin.

**The dock follows the active desktop's admin.** Ordinary desktops show
the shell's own menu; inside a Space the dock shows THAT admin's menu —
the network menu in the Network Admin Space, a site's own menu in its
Space — so a Space reads as that admin's desktop, dock and all. A plain
admin page emits only a menu signature, never its dock menu, so the
menu is harvested lazily the first time the user enters the Space: one
hidden probe against that admin (the same `openstation_menu_refresh`
probe live refresh uses, pointed at the Space's admin base), cached,
and swapped in on every later switch through `applyDockItems()` — a
dock-only repaint. `createSpaceDockController()` in
`src/multisite/space-dock.ts` owns it. Only the admin MENU is swapped:
system tiles (Mio, Overview, the Network Admin tile, …) stay on every
desktop, and the full-payload quarantine above still stands — a foreign
admin's native windows, widgets and the rest never register here.
Until a Space's first harvest lands, the previous dock stays (never an
empty dock); a harvest that lands after the user has left is cached
for next time without repainting. The shell's own live refresh (a full
payload from one of the home admin's windows, or a probe) repaints the
dock only while it shows the home menu: inside a Space the fresh home
items wait for the next switch home (`applyHomeDockItems()`), so a
home-admin window that lives on a Space, opened there or restored with
the session, cannot paint the home menu over the Space's. Pinned by
`tests/vitest/space-dock.test.ts`.

The probe keeps the request's admin context. It short-circuits
`admin.php` before Core has set a screen, and builds a placeholder one
so enqueue callbacks can run; that screen is `admin-network` or
`admin-user` where the request is (`openstation_menu_refresh_probe_screen_id()`),
because `WP_Screen` reads a bare id's context off its suffix, and a
plain `admin` screen turned every network probe into a site request:
the network menu came back with every slug resolved against the site
admin, and the Space's Plugins tile opened the site's `plugins.php`.
Pinned by `tests/phpunit/tests/openStationMultisite.php`.

Shell-to-shell navigations that still happen (typed URLs, bookmarks, a
kept admin bar) animate through the cross-document view-transition
opt-in in `assets/css/desktop.css`, which only the shell loads —
chromeless iframes and classic admin never transition, and reduced
motion swaps instantly. Pinned by `tests/vitest/site-spaces.test.ts`
and `tests/vitest/workspace-hop.test.ts`.

**Same origin is not the same admin.** The unit is the **admin scope**:
the site root up to and including the first `/wp-admin/`, plus the
`network/` or `user/` segment when there is one — the client-side twin of
`self_admin_url()`. A site root alone is not enough: the network admin
sits UNDER the main site's admin and shares its prefix, so
`/wp-admin/index.php` and `/wp-admin/network/` would read as one place.
The rule has three deliberate copies — `adminScope()` in
`src/chromeless-bridge.js` (the bridge must stay a self-contained
plain script), `src/admin-scope.ts` for the shell, and
`openstation_admin_scope_of_path()` in PHP — pinned against one shared
URL table (`tests/vitest/admin-scope.test.ts` and its PHPUnit twin),
because an unpinned second copy once drifted out of sync within a day.
The bridge hands any link leaving its scope to the shell
(`os-iframe-other-admin-link`) — which is what the Sites list does on
each "Dashboard" link. If a window ever does show
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
without the capability. The tile and every flyout row open the network
admin in its Space (see above).

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
keys split heals instead of leaking across. The one exception is a
desktop persisted with a `scope` — a site Space keeps its own admin's
windows; see Site Spaces above.

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

The WP Explorer's Users section offers **Add user**, which opens Core's
`user-new.php` as a window — deliberately Core's screen rather than a
bespoke form, because on multisite that screen is the invite flow: Add
Existing User, confirmation emails, and the network's Add Users setting
all come with it. The affordance follows Core's own menu gate
(`create_users`, or `promote_users` on multisite).

## The PWA on a network

Each site registers its own service worker at its own home-path scope
(`/` for the main site, `/site2/` for a subdirectory subsite), and the
worker derives its portal and admin prefixes from that scope. The
browser routes every page to the longest matching scope, so the
workers coexist and a sibling site's worker is never "foreign" to the
registration guard. Subdomain and domain-mapped networks are separate
origins and always had their own workers. See
[pwa.md](./pwa.md#why-home-path-scope-with-a-narrow-fetch-handler).

## The user admin

`wp-admin/user/` — multisite's dashboard for users with no site role —
renders classic. It has no shell screen, and its URLs never survive the
target allowlist; links to it from inside a window still open a browser
tab through the bridge's admin-scope rule.
