# Calculator browser regression

Run against an isolated WordPress instance with OpenStation active and desktop mode enabled for the test user:

```bash
OPENSTATION_URL=http://localhost:8894 \
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node tests/e2e/calculator/regression.mjs
```

The runner uses installed Chrome and opens Calculator from its dock launcher. It checks button arithmetic, percentages, keyboard entry, repeated equals, Enter activation of focused buttons, error recovery, local interactions without HTTP dispatches, large touch targets and a narrow RTL layout. Screenshots go to `.scratch/calculator/`, or `ARTIFACTS_DIR` when set. Credentials default to `admin` / `password`; override with `WP_USERNAME` and `WP_PASSWORD`.
