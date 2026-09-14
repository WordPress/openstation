# Desktop themes

[Help index](index.md) · [Appearance](appearance.md) · [Windows](windows.md)

## Choose a theme

The Themes page offers **OpenStation**, the system default, and the installed desktop theme library. `set_desktop_theme` takes a verified theme slug. The empty string `""` selects OpenStation's built-in dark appearance. This is an administration desktop theme, not a WordPress frontend theme.

`list_options` loads full theme entries when available and returns names, descriptions, surface colour tokens, and recommended settings. Use actual colour values or a clear description as evidence when the user asks for a darker or lighter theme. A name alone is not evidence of brightness. If the metadata is insufficient, explain the uncertainty or ask which visible theme they mean. Never install or fetch an unrequested theme to satisfy a colour change.

## Recommendations and order of operations

A desktop theme may recommend an accent, dock layout, dock position, size, renderer, window corner preset or reveal. The first activation seeds its applicable recommendations. That first-use record belongs to the shell; MIO cannot reset it.

Re-selecting a previously used theme respects subsequent choices. **Apply recommended layout and effects** deliberately reapplies the active theme's recommendations; MIO exposes this as `apply_theme_recommendations`. It changes only recommended fields. A theme without applicable recommendations reports that fact.

When chaining “use theme X, round the corners and unify the dock”, apply the theme first. Then set the explicitly requested corner and layout values. Otherwise first-use recommendations might override an earlier step.

## When a saved setting looks unchanged

Themes can override window surface, radius and other CSS tokens. A successfully saved `windowRadius` does not necessarily defeat a theme's own radius token. Explain the override. Do not claim to have changed the theme file or silently switch themes unless the user requested that.

The Legacy theme is a frozen snapshot of the earlier WordPress-admin appearance. Changing current defaults never rewrites that snapshot.

## Theme uploads

Administrators with the theme-management capability can upload a desktop theme ZIP from the Themes page. `open_theme_upload` takes the user to the tile. The local file must be selected by the user; MIO cannot access a device's filesystem or invent a ZIP. The existing upload flow validates the package.

Deleting an uploaded theme is destructive and is intentionally absent from MIO's action catalog. Code-registered themes belong to their providing plugin and cannot be deleted from this page. Use `set_desktop_theme` to switch away without deleting anything.
