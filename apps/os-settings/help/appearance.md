# Appearance: colour and desktop layout

[Help index](index.md) · [Themes](themes.md) · [Wallpaper](wallpaper.md) · [Navigation](navigation.md)

## Accent colour

Choose a preset accent from the live swatches (`set_accent`), or supply a six-digit hex colour to `set_custom_accent`. Custom accent both stores the colour and activates the Custom swatch. It colours shell controls and focus treatments. It does not restyle admin documents inside iframe windows. Ask `list_options` for preset ids and their colours; installed extensions can add swatches.

## Unified and Split docks

The **Unified** layout (`desktopLayout: unified`) combines core administration menus, plugin launchers and system items in one dock. **Split** (`desktopLayout: classic`) uses a left sidebar for core menus and a bottom dock for the other items. The API value `classic` deliberately means the UI label Split.

`set_desktop_layout` changes this arrangement. Individual launcher visibility and location are separate preferences in [Navigation](navigation.md); unifying the dock does not delete those choices.

## Dock placement

In Unified, `set_dock_placement` accepts `bottom`, `left`, or `right`. Split derives its placement from the layout: left sidebar plus bottom dock. Changing `dockPlacement` while Split is active preserves the choice for Unified but does not move the Split rails.

## Dock size

`set_dock_size` accepts `compact`, `default`, or `large`. These correspond to rail widths of 48, 56 and 72 CSS pixels and icon scales of 18, 20 and 26 pixels. Desktop themes may further shape their appearance.

## Static and dynamic behaviour

`set_dock_behavior` controls the single Unified dock or the bottom Split dock. `static` keeps it visible and reserves its occupied band in the work area. `dynamic` folds the rail into a subtle edge indicator, reveals it when the pointer reaches it or keyboard focus enters it, and reserves no desktop band.

`set_side_dock_behavior` controls only Split's sidebar, independently. Both accept `static` or `dynamic`. “Hide the docks until I need them” means dynamic, not hiding every Navigation item. “Make the docks dynamic” in Split should change both rail behaviours.

## Dock renderer

`set_dock_rail_renderer` selects the rendering style from the live renderer catalog. It changes the presentation of a rail, not which items belong to it. Never guess a renderer id; `list_options` supplies ids and labels.

## WordPress admin bar

`set_admin_bar_mode` accepts `static` (always shown), `dynamic` (auto-hiding peek strip), or `hidden` (not rendered). This affects the bar above the desktop. It is separate from the dock and sidebar behaviours. The shell measures the actual visible bar height when calculating its work area.

## Examples

- “One large dock on the right”: set desktop layout to `unified`, dock size to `large`, dock placement to `right`.
- “Split layout but let both rails get out of the way”: set layout `classic`, dock behaviour `dynamic`, sidebar behaviour `dynamic`.
- “Use turquoise”: list available accent colours first, then select the user's intended swatch or ask for a custom colour if the choice is ambiguous.
