(function (global) {
  const App = global.App = global.App || {};

  function getBaseUrls() {
    const full = window.location.href.split('#')[0].split('?')[0];
    const idx  = full.lastIndexOf('/');
    const appBase = full.substring(0, idx + 1);
    const noSlash = appBase.endsWith('/') ? appBase.slice(0, -1) : appBase;
    const idx2 = noSlash.lastIndexOf('/');
    const rootBase = noSlash.substring(0, idx2 + 1);
    return { appBase, rootBase };
  }

  const { appBase, rootBase } = getBaseUrls();
  App.config.APP_BASE_URL  = appBase;
  App.config.ROOT_BASE_URL = rootBase;
})(window);