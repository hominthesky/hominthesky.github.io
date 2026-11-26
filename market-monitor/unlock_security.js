"use strict";

(() => {
  const sensitiveQueryNames = new Set(["password", "pass", "pwd"]);
  const currentUrl = new URL(window.location.href);
  let changed = false;

  for (const name of [...currentUrl.searchParams.keys()]) {
    if (!sensitiveQueryNames.has(name.toLowerCase())) continue;
    currentUrl.searchParams.delete(name);
    changed = true;
  }

  if (changed) {
    const sanitizedUrl = currentUrl.toString();
    try {
      window.history.replaceState(window.history.state, "", sanitizedUrl);
    } catch {
      // Form protection below must still register if history access is blocked.
    }
  }

  // Bind before the deferred application module. If that module fails to load,
  // the browser must not fall back to a native GET form submission.
  document.addEventListener(
    "submit",
    (event) => {
      if (event.target?.id === "unlock-form") event.preventDefault();
    },
    true,
  );
})();
