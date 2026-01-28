(function (global) {
  const App = global.App = global.App || {};
  const log = App.log;
  const refs = App.ui.refs;

  BX24.init(async function () {
    log.info("BX24.init OK.");

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

    // Sanity check do SPA (entityTypeId + fields)
    try {
      const etid = parseInt(App.config.ENTITY_TYPE_ID, 10);
      if (!etid || Number.isNaN(etid)) throw new Error("ENTITY_TYPE_ID inválido no config.js");

      const fieldsRes = await App.core.BX24.callMethod("crm.item.fields", { entityTypeId: etid });
      const data = (typeof fieldsRes.data === "function") ? fieldsRes.data() : fieldsRes.data;
      const keys = data && data.fields ? Object.keys(data.fields) : [];

      log.info("SPA sanity check OK", {
        ENTITY_TYPE_ID: etid,
        fieldsCount: keys.length
      });
    } catch (e) {
      log.error("SPA sanity check FALHOU", String(e && e.message ? e.message : e));
    }

    log.info("CONFIG CHECK (raw)", {
      ENTITY_TYPE_ID: App.config.ENTITY_TYPE_ID,
      FIELD_CODES: App.config.FIELD_CODES ? Object.keys(App.config.FIELD_CODES).length : 0
    });

    log.info("Pronto para iniciar backfill.");
  });
})(window);