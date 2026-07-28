# Desktop Mode — Remove Background

Registers a **`media-tools/remove-background`** ability on the
WordPress Abilities API: given an attachment id, it removes the image
background and sideloads the result as a **new** PNG attachment (the
original is never modified). The new attachment is authored by the
calling user — for Desktop Mode agents, the agent's own account.

The ability is mutating (no `readonly` annotation), so the AI Copilot
never sees it; a Desktop Mode agent must be explicitly granted it in
the agent's Tools pane.

## Configuration

Deliberately **no admin settings UI** — the extension's only
user-facing surface is the ability. Configuration is code/CLI-level,
resolved in this order (later wins):

```bash
# 1. Option
wp option update desktop_mode_remove_background \
  '{"backend":"removebg","removebg_api_key":"YOUR_KEY"}' --format=json
```

```php
// 2. Constants (wp-config.php — keeps the key out of the database)
define( 'DESKTOP_MODE_REMOVE_BG_BACKEND', 'removebg' );
define( 'DESKTOP_MODE_REMOVE_BG_API_KEY', 'YOUR_KEY' );
define( 'DESKTOP_MODE_REMOVE_BG_ENDPOINT', 'http://127.0.0.1:7000/api/remove' );

// 3. Filter (wins last)
add_filter( 'desktop_mode_remove_background_settings', function ( $s ) {
	$s['backend'] = 'rembg';
	return $s;
} );
```

## Backends

| Backend | Needs | Notes |
|---|---|---|
| `removebg` (default) | remove.bg API key | Best segmentation quality; media leaves the site; paid credits after the free tier. |
| `rembg` | Endpoint URL of a self-hosted [rembg](https://github.com/danielgatis/rembg) server (`rembg s`, POST multipart `file`) | No key, no third-party data sharing — good next to wp-env. |
| `ai` | An image-capable connector in the WordPress AI Client | Experimental: generative editing regenerates pixels, so the subject may not be identical. |

Add a custom backend via the `desktop_mode_remove_background_backends`
filter (`slug => callable( $path, $mime, $attachment_id )` returning
binary PNG or `WP_Error`), or short-circuit processing entirely via
`desktop_mode_remove_background_pre`.

## Typical agent recipe

1. Create an agent (role `author` or above — the ability requires
   `upload_files`).
2. Tick `desktop-mode/search-posts`, `desktop-mode/get-post`,
   `desktop-mode/get-media`, and `media-tools/remove-background` in
   its Tools pane.
3. Chat: *"Take the picture in the post named `My pic` and remove the
   background."* The agent resolves the post, reads the attachment,
   calls the ability, and answers with the new attachment's URL.
