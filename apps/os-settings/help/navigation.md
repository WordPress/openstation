# Navigation and mobile

[Help index](index.md) · [Appearance](appearance.md) · [Features](features.md)

## Put launchers where you want them

Navigation lists the same live launcher registry the shell uses. Each placeable item can appear on its **rail**, on the **desktop**, on **both**, or be **hidden**. MIO's `set_navigation_placement` takes a returned item `id` and `placement` (`rail`, `desktop`, `both`, `hidden`). It merges just that item into existing preferences, preserving all others.

In Split, a core menu's rail is the sidebar; other items use the dock. In Unified everything uses the one dock. The API value remains `rail`, so saved placement survives layout changes.

Locked or transient launchers cannot be moved by MIO. Some system tiles are deliberately not placeable; they do not appear in its catalog. Hiding a launcher does not deactivate its plugin or delete its contents. The Mio tile can be hidden independently of whether the companion is enabled.

## Phone layout

`set_mobile_layout` accepts `auto`, `desktop`, or `mobile`. Automatic follows the viewport. Desktop forces the desktop experience, including on a phone. Mobile forces the phone interface, including on a large screen for previewing. Changing modes may alter or hide the current desktop conversation surface; completed settings writes remain in effect.

## Phone tab bar pins

The phone tab bar reserves slots for Home and the app switcher. Up to three additional launchers can be pinned in order. `list_options` returns `phonePins`; `set_mobile_tabs` accepts a unique list of up to three of those ids. Empty means “use the server defaults,” not “remove every pin.” Unknown or unavailable ids are rejected by the MIO action.

To change a single pin while retaining others, read current settings and construct the desired complete list. Never replace the user's other pins unless requested. The phone's pin list is distinct from desktop Navigation placement.

## Examples

- “Put Media on the desktop and keep it in the dock”: look up its id and set placement `both`.
- “Hide the MIO dock icon”: choose the Mio item's placement `hidden`; this does not disable MIO.
- “Keep Posts, Pages and Media in the phone tabs”: look up their current ids, then set the three-item list in the requested order.
