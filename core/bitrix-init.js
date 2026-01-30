(function (global) {
  const App = global.App = global.App || {};
  const log = App.log;
  const refs = App.ui.refs;

  BX24.init(async function () {
    log.info("BX24.init OK.");

    // preencher janela fixa na UI
    try {
      if (refs.matchWindowFixed) {
        refs.matchWindowFixed.value = `${App.config.MATCH_WINDOW_MIN_FIXED} min`;
      }
    } catch {}

    try {
      const res = await App.core.BX24.callMethod("user.current", {});
      const u = (typeof res.data === "function") ? res.data() : res.data;
      const user = u || {};
      const name = ((user.NAME || "") + " " + (user.LAST_NAME || "")).trim();
      if (refs.headerUserInfoEl) {
        refs.headerUserInfoEl.textContent = name ? `Usuário: ${name}` : "Usuário conectado";
      }
      log.info("user.current", { ID: user.ID, NAME: name });
    } catch (e) {
      log.warn("Falha ao obter usuário atual", String(e));
    }

    try {
      await App.svc.SpaProvider?.sanityCheck?.();
    } catch (e) {
      log.error("SPA sanity check FALHOU", String(e && e.message ? e.message : e));
    }

    log.info("CONFIG CHECK (raw)", {
      ENTITY_TYPE_ID: App.config.ENTITY_TYPE_ID,
      FIELD_CODES: App.config.FIELD_CODES ? Object.keys(App.config.FIELD_CODES).length : 0,
      MATCH_WINDOW_MIN_FIXED: App.config.MATCH_WINDOW_MIN_FIXED
    });

    log.info("Pronto para iniciar backfill.");
  });
})(window);