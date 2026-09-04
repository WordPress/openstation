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
**switches instance** instead, see the next section. A cross-origin site
switches the same way; only the view transition is lost, since that is
same-origin by specification.

## Site instances

On a network every site is its own OpenStation, and so is the network
admin: its own shell screen, dock, plugins, native windows, widgets,
desktops and session (one per admin, see Storage scoping). Switching
site is a navigation to that site's shell, animated by the
cross-document view transition the shell's stylesheet opts into
(`assets/css/desktop.css`; same-origin only, and reduced motion swaps
instantly). Nothing is emulated: the site's shell is the site's shell.

**The site switcher** is a row above the desktop tiles in overview: an
`<os-segmented>` naming the Network Admin (with `manage_network`) and
every site the user belongs to, the current instance selected. Picking
another navigates to that site's shell with `openstation_overview=1`,
which boots it straight into overview: the same panel, now with that
site selected and its desks below. A modifier or middle click opens the
site in a browser tab instead, the way to stand two sites side by side.
`buildSiteSwitcher()` in `src/multisite/site-switcher.ts` builds the row
from `wp.os.config.multisite` (`MultisiteConfig` in `src/types.ts`), and
the shell installs it through `installOverviewHeader()` in
`src/window-manager/overview.ts`, the seam overview offers for a row
above its tiles. One instance is no choice, so a user with nothing to
switch between gets no row. The list is `openstation_multisite_sites()`:
the user's own sites (`get_blogs_of_user()`, minus the archived, spam and
deleted) and, for a super admin, who can reach every site whether or not
they are a member, the network's sites by path up to the first 20, all
through the `openstation_multisite_sites` filter, which is where a large
network picks its own set. Pinned by `tests/vitest/site-switcher.test.ts`
and `Tests_OpenStation_Multisite`.

**Every cross-admin click takes the same hop.** The Network Admin tile
and its flyout rows, a site's "Dashboard" link in the network Sites list
inside a window: `hopToAdmin()` in `src/multisite/hop.ts` navigates this
tab to the raw admin URL, and the `admin_init` redirect routes it to the
matching shell screen with the URL as the boot target, exactly as if it
had been typed. The bridge hands any link leaving its admin to the shell
(`os-iframe-other-admin-link`), which it detects with its inline
`adminScope()` rule: the site root up to and including the first
`/wp-admin/`, plus the `network/` or `user/` segment when there is one,
the client twin of `self_admin_url()`. A site root alone is not enough:
the network admin sits UNDER the main site's admin and shares its
prefix, so `/wp-admin/index.php` and `/wp-admin/network/` would read as
one place. If a window ever does show another admin, its
`os-plugins-changed` payload repaints this dock with that admin's menu:
the symptom to recognise.

**Landing in overview.** `openstation_overview` is a one-shot boot arg
of the shell screen, like `target` and `intent`: read once server-side
(`openstation_shell_lands_in_overview()`) into `config.landInOverview`,
stripped from the address bar with the other two so a reload comes back
to the desk, and honoured after the session and the entry window are in
place, so overview lays out every window it will show.

The hop is animated on both sides of the page swap, because the
cross-document view transition can only crossfade the root and the new
page paints its bare desk long before overview opens. The switcher
slides the desk out towards the site it picked (`os-shell--hop-out-next`
/ `-prev` on the shell root, for the beat before it navigates), and a
shell asked to boot into overview arrives with its desk hidden
(`os-shell--arriving`, stamped server-side in `openstation_render_shell()`)
until overview is up, then slides it in from the same side, the
direction being a one-shot `sessionStorage` hint
(`openstation-hop-direction`) that a cross-origin site never sees, so it
fades instead. The wallpaper never moves. A desk never stays hidden: a
keyframe fallback in the stylesheet and a boot timer both let it in
within seconds if nothing else does, and reduced motion skips every
slide. `src/multisite/instance-transition.ts` drives it; pinned by
`tests/vitest/instance-transition.test.ts`.

**The dock is always this admin's, live refresh included.** The
menu-refresh probe short-circuits `admin.php` before Core has set a
screen, and builds a placeholder one so enqueue callbacks can run; that
screen is `admin-network` or `admin-user` where the request is
(`openstation_menu_refresh_probe_screen_id()`), because `WP_Screen`
reads a bare id's context off its suffix, and a plain `admin` screen
turned every network probe into a site request: the network menu came
back with every slug resolved against the site admin. Pinned by
`Tests_OpenStation_Multisite`.

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
`wp.os.config.multisite`, whose `networkAdmin` is null without the
capability. The tile and every flyout row switch to the network admin's
own shell (see Site instances).

It registers with `navKind: 'core'`
([javascript-reference.md](./javascript-reference.md)), so it paints with
the admin menus, moves to the sidebar with them in the split layout, and
lands second in that run — `computeNav()` slots a core TILE in behind the
lead menu.

**The switcher lives in overview, not on the desk.** A top-left chip
with the site's icon, name and a switcher was built and taken back out:
the admin bar is hidden by default (`adminBarMode` defaults to
`'hidden'`), the dock is built from an admin menu near-identical across
sites, and the desk belongs to the user's windows. Which site you are on
is said where the desks are, above their tiles, and nowhere else.

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
keys split heals instead of leaking across, and a site's windows only
ever live in that site's own instance.

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
target allowlist; links to it from inside a window leave the shell for
it, classic, through the bridge's admin-scope rule.
