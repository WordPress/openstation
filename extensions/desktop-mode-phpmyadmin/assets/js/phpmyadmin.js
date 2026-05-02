(function() {
  "use strict";
  const ROOT_SELECTOR = "[data-wpdc-phpmyadmin-root]";
  function getConfig() {
    const cfg = window.wpDesktopPhpMyAdminConfig;
    if (!cfg || typeof cfg.vendorUrl !== "string" || cfg.vendorUrl === "") {
      return null;
    }
    return cfg;
  }
  function renderError(root, message) {
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "wpdc-phpmyadmin__error";
    wrap.textContent = message;
    root.appendChild(wrap);
  }
  function renderPhpMyAdmin(body) {
    const root = body.querySelector(ROOT_SELECTOR);
    if (!root) {
      return;
    }
    const cfg = getConfig();
    if (!cfg) {
      renderError(
        root,
        "phpMyAdmin is not available — bundle missing or configuration not loaded."
      );
      return;
    }
    // Make the root fill the window body even when the extension's
    // stylesheet hasn't been loaded — this happens when the plugin is
    // activated mid-session via the marketplace (admin_enqueue_scripts
    // doesn't fire for already-loaded admin pages, so phpmyadmin.css
    // is missing until the next full reload).
    root.style.cssText = "display:flex;flex-direction:column;width:100%;height:100%;";
    root.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.className = "wpdc-phpmyadmin__frame";
    // Inline sizing so the iframe doesn't fall back to its 300×150
    // user-agent default if the stylesheet is missing.
    iframe.style.cssText = "flex:1 1 auto;width:100%;height:100%;border:0;display:block;";
    iframe.src = cfg.vendorUrl + "/index.php?_=" + Date.now();
    iframe.title = "phpMyAdmin";
    iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-downloads"
    );
    root.appendChild(iframe);
  }
  const registry = window.wpDesktopNativeWindows ?? (window.wpDesktopNativeWindows = {});
  registry["wpdc-phpmyadmin"] = (body) => {
    renderPhpMyAdmin(body);
  };

  // Self-recover: when this bundle is loaded lazily after openWindow has
  // already mounted the window template (e.g. immediately after a
  // marketplace activate triggers refreshMenu), the framework's
  // synchronous mount path saw no registry entry and left the loading
  // skeleton in place. Find any already-mounted skeleton and render
  // into it — idempotent because renderPhpMyAdmin clears the root
  // before injecting the iframe.
  const skeletons = document.querySelectorAll("[data-wpdc-phpmyadmin-loading]");
  skeletons.forEach((skel) => {
    const body = skel.closest(".wp-desktop-window__body");
    if (body) {
      renderPhpMyAdmin(body);
    }
  });
})();
