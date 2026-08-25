# Migration — the navigation model

The dock, the sidebar and the desktop no longer decide for themselves where a thing belongs. One model in `src/nav/` answers that question once and every surface renders the answer.

Read this if your plugin registers a native window with a dock tile, reads or writes the OpenStation Preferences state, implements a dock rail renderer, or points users at the **Apps & Plugins** settings tab.

## What changed

### `itemVisibility` and `dockOrder` are now `navPlacement` and `navOrder`

The per-item placement map moved from a rail name to a **region**:

| Before (`itemVisibility`) | After (`navPlacement`) |
|---|---|
| `'dock'` | `'rail'` |
| `'desktop'` | `'desktop'` |
| `'both'` | `'both'` |
| `'hidden'` | `'hidden'` |

`'rail'` resolves to the sidebar for a WordPress admin menu while the split layout is on, and to the dock for everything else. Storing the region rather than the rail is what lets a layout switch be a re-render instead of a data migration.

`dockOrder` became `navOrder` and lost the `dock:` / `desktop:` id prefixes, which named tiles synthesized onto the opposite rail. Nothing synthesizes copies any more: an item is one item wherever it is painted.

**Existing users keep their arrangement.** `openstation_sanitize_os_settings()` reads the old fields when the new ones are absent, converts, and writes the result back on the next save. Nothing to run, and no sweep over user meta.

**No alias ships.** Reading `wp.os.getOsSettings().itemVisibility` returns `undefined`, and writing it through `updateOsSettings()` is ignored. Read `navPlacement` instead.

### Where a thing defaults to is decided by what it IS

Every default now comes from the item's **kind** rather than from the registration path that produced it:

| Kind | Default |
|---|---|
| A WordPress admin menu | a rail |
| A plugin admin menu | a rail |
| An app: a registered desktop icon, a native window's launcher | the desktop |
| An OpenStation control: Mio, Overview, System, Trash, Exit | a rail |

This is the fix for a class of bug rather than a preference change. An app registered twice — a native window with a dock tile *and* a desktop icon, which the two APIs explicitly allow — used to get two defaults, one per surface, and the surfaces disagreed until the user picked a value explicitly. Games shipped that way: Preferences read the default off the icon and said "On the desktop" while the dock read it off the window and painted a tile.

Nav items are now collapsed by id (and by the window an icon names) before anything renders, so an app registered any number of ways is one row with one answer.

### `openstation_register_window()` takes `nav_kind`

```php
openstation_register_window( 'my-window', array(
    'title'     => __( 'My window', 'my-plugin' ),
    'template'  => 'my_plugin_render',
    'placement' => 'dock',
    'nav_kind'  => 'app',   // default; 'control' is for OpenStation's own
) );
```

`nav_kind` decides the launcher's default placement and which dock zone it sits in. Plugins want `'app'` and get it by saying nothing.

`placement` still accepts `'dock'` and `'none'`, but it is now a **proposed default** rather than a render instruction. `'dock'` puts the launcher on a rail even though apps otherwise default to the wallpaper, which is where it has always been; the user's Navigation pick then wins over it, and a running window gets a tile whatever either says. Nothing to change in existing registrations.

### The dock has three zones

A rail paints WordPress's admin menus, then apps (plugin menus, app launchers, and any running window with no home of its own), then OpenStation's controls, with a divider between each adjacent pair of non-empty zones. Zone membership is derived from the kind, so a tile cannot be dragged into another zone.

The visible consequence: a plugin's native-window launcher now sits **beside** the plugin menus with no divider between them, instead of behind the divider with the station's own controls.

### `DockRailController.setZones()`

The shell's write path for a rail's contents. It takes the three zones as arrays of a `DockEntry` union, because a zone can mix menu-derived and system-derived tiles:

```js
setZones( {
    core:     [ { type: 'menu', item }, … ],
    apps:     [ { type: 'menu', item }, { type: 'system', item }, … ],
    controls: [ { type: 'system', item }, … ],
} );
```

**Optional.** A renderer that does not implement it is driven through `replaceItems` + `appendSystemItem` / `removeSystemItem` exactly as before. It loses two things: the zone boundaries, which it had no way to paint anyway, and reordering of system tiles, since that path only adds and removes them (menu-derived tiles still reorder, because `replaceItems` takes the whole list). Nothing to do unless you want either.

One related change for every renderer: `mount()` now receives an **empty** `items` array. The shell fills the rail through the controller on the same turn `mount()` returns, so a rail's contents come from exactly one place. Read `fullMenu` for the whole admin menu.

### `wp.os.listSystemTiles()` reports `navKind`, not `affinity`

```js
// Before
{ id, title, icon, affinity: 'core' | 'plugin', placeable }
// After
{ id, title, icon, navKind: 'app' | 'control', placeable, locked }
```

`affinity` described where a tile came from and had stopped selecting a rail. `navKind` describes what the tile IS, and selects its zone and its default.

`wp.os.appendSystemTile( item )` lost its second `affinity` argument; put `navKind` on the tile instead.

### Two new reads

- `wp.os.getNavItems()` — every navigable thing the shell knows about, whatever surface it is on.
- `wp.os.getNav()` — the computed result: the dock's three zones, the sidebar, the wallpaper, and the ids present only because their window is open.

### "Apps & Plugins" is now "Navigation"

The settings tab id changed from `apps-icons` to `navigation`. `wp.os.openOsSettings( { tabId: 'navigation' } )` is the new address; the old id no longer resolves. Rows are grouped by kind, and the rail option names the rail the user is actually looking at.

## Behaviour changes users will notice

- **A running window always has a tile.** An app whose launcher lives on the wallpaper, or is hidden entirely, gets a transient tile in the dock's apps zone while its window is open, and loses it when the window closes. Previously a hidden item stayed tileless, leaving its window unswitchable with nowhere to minimize into.
- **So does a window nothing on a rail answers for.** A native window opened programmatically now gets a tile while it is open. Two things are excluded, because the rail already represents them: admin pages, which are reachable through their menu's tile and its hover peek, and any window a system tile's submenu row opens — the System tile carries OpenStation Preferences, so Preferences lights that tile rather than adding one.
- **Games defaults to the desktop**, which is what its Preferences row always claimed. A user who never touched the setting will see the dock tile go away.
- **Dragging is scoped to a zone.** It always effectively was; now it is structural rather than a consequence of the sort order.
- **Exit OpenStation cannot be moved or hidden**, and no longer appears in the preferences list.
