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
    root.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.className = "wpdc-phpmyadmin__frame";
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
})();
