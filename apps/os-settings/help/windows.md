# Window appearance and behaviour

[Help index](index.md) · [Themes](themes.md) · [Features](features.md)

## Corners

`set_window_radius` selects `sharp` (0 px), `default` (8 px) or `round` (16 px). “Rounded corners” means `round` unless the user asks for the default rounding. A desktop theme can override the visual radius token; see [Themes](themes.md).

## Unfocused windows

`set_unfocus_effect` chooses how windows look when another window is focused. `none` disables the treatment. The other ids and labels come from `list_options`; the catalog can change when plugins register effects. This controls appearance, not minimization or focus ownership.

## Opening reveals

`set_window_reveal` chooses a content reveal. `none` uses the ordinary opacity fade. `set_window_reveal_duration` accepts `0` for the effect's own timing, or a number from 80 to 4000 milliseconds. Reduced motion is respected by the shell. The duration does not control MIO's ownership transition.

## Window links

Related windows can carry visual ties. `set_window_link_renderer` chooses a registered renderer, or `none` to disable the visuals. `set_window_link_visibility` accepts `always`, `focus` (visible while a related-group member is focused), or `off`.

The master **Window links** feature (`set_window_links_enabled`) is on Features. Turning it off disables link visuals and group behaviour but preserves your style choices. Two independent switches are `set_window_link_raise_on_focus` (raise related windows behind the focused member) and `set_window_link_highlight` (outline related windows). None of these actions modifies site content or creates arbitrary relations.

## Confirm closing all windows

`set_confirm_close_all_windows` chooses whether the close-all shortcut asks first. This preference is reversible; MIO can change it. MIO does not expose the close-all operation itself because windows may contain unsaved work.

## MIO inside a window

An explicitly registered, focused window can host MIO. Inside it, MIO ignores other windows, docks and controls for collision and magnet calculations; only the owning window body's outer boundaries constrain its movement. Closing, minimizing or leaving the owner cancels its active conversation work. A focused eligible window receives MIO through a shrink/move/grow transition, with reduced-motion users receiving an immediate handoff. See [MIO actions](actions.md).
