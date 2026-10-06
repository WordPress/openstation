# Calculator browser checks

From the repository root:

```sh
node tests/e2e/calculator/calculator-regression.mjs
```

Requires Playwright and Chrome. Set `PLAYWRIGHT_MODULE` to an absolute Playwright module path if it is installed outside this checkout.

The fixture uses the calculator client app and the real app session runtime. It checks mouse and keyboard arithmetic, error recovery, keyboard focus, button sizes at narrow widths, RTL layout, and that arithmetic sends no requests. The screenshot is saved to `/tmp/openstation-calculator.png`.
