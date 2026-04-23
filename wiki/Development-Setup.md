# Development Setup

For hacking on the plugin itself: clone the repo, run the build in watch mode, and load it into a local WordPress via symlink so every save is one browser refresh away.

> For deeper contributor workflow — ESLint, PHPUnit in `wp-env`, the `src/` module layout — see [DEVELOPMENT.md](https://github.com/WordPress/desktop-mode/blob/trunk/DEVELOPMENT.md).

## 1. Install dependencies

```bash
npm install
```

## 2. Build the TypeScript bundle

The plugin uses **[Vite](https://vitejs.dev/)** in library mode. esbuild handles transpile and minify, so builds finish in ~70 ms per bundle.

**Full build** — produces both bundles:

```bash
npm run build
```

Writes:

- `assets/js/desktop.js` — unminified IIFE, loaded when `SCRIPT_DEBUG` is `true`.
- `assets/js/desktop.min.js` — esbuild-minified IIFE, loaded otherwise.

**Development watch** — auto-recompiles the unminified bundle on save:

```bash
npm run dev
```

Leave it running in a separate terminal; refresh the browser after each save. Set `define( 'SCRIPT_DEBUG', true )` in `wp-config.php` so WordPress picks up the unminified bundle during development.

## 3. Load into a local WordPress

You need a running WordPress to load the plugin into. Pick whichever is easier.

### Studio, wp-env, or a hosted WP

Run `npm run package` to build a zip from `HEAD` (with correct 0644 / 0755 permissions), then follow the [Quick install](https://github.com/WordPress/desktop-mode#try-it-in-30-seconds) steps to upload and activate it. Re-package and re-upload after each change.

> If you changed source, run `npm run build` before `npm run package` — the Vite output is gitignored, and `bin/package.sh` splices the built files into the zip from your working tree.

### Clone `wordpress-develop` and symlink

Gives you the full dev loop: `npm run dev` rebuilds on save, a browser refresh picks it up.

```bash
# clone Core's Docker-based dev host alongside this repo
git clone https://github.com/WordPress/wordpress-develop.git
cd wordpress-develop
npm install

# symlink this plugin into the WP plugins directory
ln -s "$(pwd)/../desktop-mode" src/wp-content/plugins/wp-desktop-mode

# boot + install WordPress
npm run env:start      # nginx + PHP + MySQL in Docker
npm run env:install    # installs WordPress
```

Site: **http://localhost:8889**
Admin: **http://localhost:8889/wp-admin/**
Credentials: `admin` / `password`

Stop the environment with `npm run env:stop` (from the `wordpress-develop` directory). Activate the plugin per the project's [Quick install](https://github.com/WordPress/desktop-mode#try-it-in-30-seconds) steps.

## Requirements

- WordPress **6.0+**
- PHP **7.4+**
- Node matching [`.nvmrc`](https://github.com/WordPress/desktop-mode/blob/trunk/.nvmrc) (currently `24`)
