# Migration — AI scoped to comment spam + native-search assistant (0.11.0)

> **TL;DR.** The AI Copilot no longer auto-analyzes posts, pages, or
> taxonomy terms. The only automatic AI analysis is **comment spam
> scoring**. The AI assistant now finds posts/pages/comments with
> **WordPress's native keyword search** instead of pre-analyzed
> `_desktop_mode_ai_analysis` summaries. The bulk `/ai/reindex` REST
> endpoint is removed. Several post/term analysis hooks are removed
> (breaking).

---

## Why the change

Enabling AI used to mean every post, page, and term was sent to OpenAI on
save to build a searchable summary, and the assistant could only "find"
content that had already been analyzed. That made AI feel like a
site-wide indexing obligation — and the orphaned `/ai/reindex` endpoint
would sweep **all** published posts/pages/comments in one unbounded pass.

The copilot is now scoped to the one analysis that earns its keep —
classifying incoming comments as spam/harmful for the comments-window
moderation score — and the assistant finds content the way WordPress
already does: keyword search.

## What changed

### Removed: bulk reindex endpoint

`POST /desktop-mode/v1/ai/reindex` is gone (the whole
`includes/ai-copilot/reindex.php` file). There was no built-in caller; if
your integration POSTed to it, drop that call. Comment analysis happens
automatically on comment insert/edit; no bulk reindex is needed.

### Removed: post & taxonomy-term analysis

Posts, pages, and terms are no longer analyzed on save. These hooks **no
longer fire and have been removed**:

| Hook | Type | Was |
|---|---|---|
| `desktop_mode_ai_supported_post_types` | filter | Stable |
| `desktop_mode_ai_supported_taxonomies` | filter | Stable |
| `desktop_mode_ai_supported_types` | filter | Stable |
| `desktop_mode_ai_schema_content` | filter | Experimental |
| `desktop_mode_ai_post_prompt` | filter | Stable |
| `desktop_mode_ai_term_prompt` | filter | Stable |
| `desktop_mode_ai_post_analyzed` | action | Stable |
| `desktop_mode_ai_term_analyzed` | action | Stable |

If you depended on `desktop_mode_ai_post_analyzed` / `_term_analyzed` to
mirror data into your own index, hook the WordPress core `save_post` /
`edited_term` events directly instead.

### Kept: comment analysis

The comment path is unchanged and remains the only auto-analysis:

- `desktop_mode_ai_comment_prompt` (filter, Stable)
- `desktop_mode_ai_schema_comment` (filter, Experimental)
- `desktop_mode_ai_comment_analyzed` (action, Stable) — result still
  carries `topic`, `ai_summary`, `harmful`, `spam`.

The comments-window spam score (`desktop_mode_comments_window_spam_score`)
continues to read the `spam` / `harmful` verdict from comment meta.

### Changed: assistant search is now keyword-based

The `search_posts`, `search_pages`, `search_comments`, and
`search_comments_by_post` tools now take a **`query`** string and run
WordPress's native search (`WP_Query` `s=` / `get_comments` `search=`).
They no longer filter on the `_desktop_mode_ai_analysis` meta, so **all**
published posts/pages and approved comments are findable — not just
previously-analyzed ones. Tool results return the real title + a content
excerpt instead of a precomputed `topic` / `ai_summary`.

If you call `wp.desktop.ai.ask()`, no code change is required — the model
supplies the `query` itself, and continuing an exhausted search with
`resumeTool` / `startOffset` reuses the original query automatically.

## Upgrade behavior

A one-time migration (version 2, on first admin load) calls
`wp_unschedule_hook()` for `desktop_mode_ai_analyze_post` and
`desktop_mode_ai_analyze_term` to clear any queued events. Existing
`_desktop_mode_ai_analysis` meta on posts/terms is left in place — it is
hidden, harmless, and simply ignored.
