# Migration — AI comment scoring leaves core

**Breaking.** The "Score new comments with AI" feature is gone from OpenStation. The toggle, its option, its REST route, its two filters and the comment-save hooks that drove it have all been removed. Nothing in the plugin analyzes content in the background any more: every AI call OpenStation makes is one a user asked for.

Nothing here changes what the Comments window shows by default. Its spam-confidence column is heuristic and never depended on AI.

## What is gone

| Surface | Kind |
|---|---|
| `openstation_comments_ai_is_enabled` | filter |
| `openstation_comments_ai_toggled` | action |
| `GET` / `POST` `desktop-mode/v1/comments/ai-settings` | REST route |
| `desktop_mode_comments_ai_moderation` | site option |
| `openstation_comments_ai_is_enabled()`, `openstation_comments_ai_provider_configured()` | PHP functions |
| `OPENSTATION_COMMENTS_AI_OPTION` | constant |
| OpenStation Preferences → Features → "Score new comments with AI" | UI |
| `set_comments_ai` | MIO ability |
| `commentsAi`, `commentsAiUrl` in the shell page config | JS config keys |

The `wp_insert_comment` and `edit_comment` listeners are gone with them, so no comment is queued for analysis on save.

## What is unchanged

- **`openstation_comments_window_spam_score`** — the Comments window's per-row spam confidence. It is computed by the heuristics in `apps/comments/parts/spam-score.php`, which never depended on AI. The filter, its signature and its 0–100 range are exactly as they were; only the AI moderation's own listener on it has been withdrawn.
- **`desktop-mode/analyze-comment`** — the ability that runs the spam/harm analysis for one comment on demand still exists, still returns `{ topic, ai_summary, harmful, spam }`, and is still gated on `moderate_comments`. It was never offered to the model during a search turn and still is not. What changed is that nothing calls it automatically.
- **`_desktop_mode_ai_analysis`** comment meta, and the `openstation_ai_comment_analyzed` action that fires when the ability writes it.
- The AI assistant, its own Features toggle, and every `openstation_ai_*` hook around the search loop.

## Upgrade

Migration 8 runs on the next admin request and does two things:

```php
wp_unschedule_hook( 'desktop_mode_ai_analyze_comment' );
delete_option( 'desktop_mode_comments_ai_moderation' );
```

Queued analysis events would no-op anyway with the scheduler gone; clearing them keeps `wp cron event list` honest. Existing `_desktop_mode_ai_analysis` meta is left alone — it is hidden, harmless, and still the shape the ability writes.

**If you read the option directly**, stop: it no longer exists and no code consults it. **If you filtered `openstation_comments_ai_is_enabled`** to gate scoring by environment, that filter never fires now.

## Reproducing it outside

Everything the removed code did is still reachable from a plugin, which is why it left: it never needed to be in core.

- **Trigger:** `wp_insert_comment` and `edit_comment`, both Core hooks.
- **Analysis:** `wp_ai_client_prompt()`, Core's AI Client, with credentials and model from Settings → Connectors.
- **Surfacing:** [`openstation_comments_window_spam_score`](./hooks-reference.md#openstation_comments_window_spam_score--experimental-filter), which is unchanged. A listener that raises the score for its own stored verdict reproduces the column behaviour exactly.

A plugin doing that needs nothing private from OpenStation.
