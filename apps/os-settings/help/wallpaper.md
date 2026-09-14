# Wallpaper images and custom configuration

[Help index](index.md) · [Appearance](appearance.md) · [Themes](themes.md)

## Select a wallpaper

`list_options` lists currently registered wallpapers. `set_wallpaper` selects one by its exact id. Animated wallpapers may load lazily; the Preferences grid hydrates them for previews and settings controls. A plugin can add or remove wallpaper choices during the session.

A custom image wallpaper requires an existing image selection. Prefer `select_wallpaper_image` for a new media choice; it verifies the attachment and activates the custom-image wallpaper together. A custom gradient can be configured and selected in one `set_custom_gradient` call.

## Custom gradient

`set_custom_gradient` takes `from` and `to` as `#rrggbb` strings and `angle` from 0 through 360 degrees. It preserves unrelated preferences and selects `custom-gradient`. If the user asks to change just one endpoint or the angle, use `read_settings` first to retain the other current values.

## Existing images

`search_wallpaper_images` takes a search `query` (empty lists images) and one-based `page`. It asks the authenticated WordPress Media REST API for up to 12 image attachments, including ids and dimensions. It never scrapes an arbitrary URL. `select_wallpaper_image` takes one attachment id, verifies access and image type against WordPress, then stores the server-returned URL and id.

`set_library_hd_only` toggles the picker’s HD filter. The UI considers at least 1920 × 1080 to be HD. This filter affects library presentation; it is not an upload requirement. Smaller images may look blurry across a large desktop. Search results include dimensions so MIO can explain the tradeoff.

## Upload a local image

`open_image_picker` with `source: upload` opens the upload area if the user has `upload_files`. The user must choose or drop the local file. With `source: library`, it opens existing images. MIO cannot upload an unprovided local file and must not claim that opening the picker uploaded one. The normal WordPress upload permission and validation apply.

## Snow settings

When Snow (`wp-snow`) is registered, `set_snow_settings` exposes all four controls:

- `wind`: 0–80; default 22. Controls peak horizontal wind in pixels per second. Zero stops the broad wind sweep, while individual flakes can still sway.
- `particleCount`: integer 100–2000; default 660. More particles make denser snow and increase graphics work.
- `flakeSize`: 6–40 CSS pixels; default 16. Maximum flake diameter including the soft halo; smaller flakes preserve depth variation.
- `background`: a six-digit hex backdrop colour; default `#0c1a36`. The scene derives its night-sky gradient from it.

The action expects all four values so it cannot silently reset unspecified knobs. Read `wallpaperSettings['wp-snow']` first and merge the defaults above for missing fields when only one knob was requested. Saving Snow settings does not switch the active wallpaper; call `set_wallpaper` separately if requested.

## Other wallpaper settings

`open_wallpaper_settings` opens the active wallpaper's registered custom dialog. Third-party dialogs are arbitrary UI; MIO must not invent their keys or mutate an undocumented configuration bag. An extension should contribute its own validated private actions if it wants direct conversational control of those settings. MIO can open the existing dialog for user interaction in the meantime.

Removing an image selection and deleting uploaded data are intentionally outside MIO's action set.
