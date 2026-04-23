# wiki/ — staging mirror of the GitHub Wiki

The files in this folder are the source of truth for the [WP Desktop Mode GitHub Wiki](https://github.com/WordPress/desktop-mode/wiki).

GitHub Wikis live in a separate git repository (`desktop-mode.wiki.git`) that a regular PR cannot write to. We stage the wiki pages here so they can be code-reviewed alongside the code and docs they describe, then one command publishes them to the live wiki.

## Publishing changes to the live wiki

After a PR that touches `wiki/*.md` is merged, a maintainer runs:

```bash
git clone https://github.com/WordPress/desktop-mode.wiki.git /tmp/dm-wiki \
  && cp wiki/*.md /tmp/dm-wiki/ \
  && (cd /tmp/dm-wiki && git add -A && git commit -m "sync from wiki/ in trunk" && git push)
```

Then verify that <https://github.com/WordPress/desktop-mode/wiki> renders with the expected sidebar entries.

## Conventions

- **Page names.** GitHub Wiki treats filenames as page names — `Development-Setup.md` becomes the page `Development Setup` at `/wiki/Development-Setup`. Keep kebab-case filenames.
- **Special pages.** `_Sidebar.md` renders as the always-visible left sidebar on every wiki page. `_Footer.md` renders as the footer. `Home.md` is the landing page.
- **Internal links.** Between wiki pages, prefer GitHub's wiki-link shorthand: `[[Features]]` or `[[Development Setup|Development-Setup]]`. These resolve correctly on the live wiki.
- **Images.** Wiki pages live in a different repo, so they cannot use relative paths into the plugin repo. Reference images via an absolute `raw.githubusercontent.com` URL pinned to `trunk` — e.g. `![cover](https://raw.githubusercontent.com/WordPress/desktop-mode/trunk/.github/marketing/wiki-home.png)`.

## What goes where

- **[README.md](../README.md)** — marketing pitch. Why the project exists. ~90 lines, no hook names.
- **`wiki/` (this folder)** — user-facing "tell me more": feature inventory, roadmap, install variations, repo tour, dev loop.
- **[docs/](../docs/README.md)** — plugin-author API contract. Hook-by-hook reference, stable/experimental status labels, `@since` versions. Stays versioned with the code.

If content would fit in two of those places, it belongs in exactly one — the most specific one.
