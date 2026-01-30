(function (global) {
  const App = global.App = global.App || {};
  const log = App.log;
  const refs = App.ui.refs;

  App.state = App.state || {};
  App.state.ui = App.state.ui || { activeTab: "vox" };

  function toggleCustom() {
    refs.customRangeBox.style.display = (refs.presetSel.value === 'custom') ? 'flex' : 'none';
  }

  function setTab(tab) {
    App.state.ui.activeTab = tab;

    refs.tabVox.classList.toggle("active", tab === "vox");
    refs.tabAct.classList.toggle("active", tab === "act");

    // somente na aba 2
    refs.rowOnlyMissing.style.display = (tab === "act") ? "flex" : "none";
  }

  refs.tabVox.addEventListener("click", () => setTab("vox"));
  refs.tabAct.addEventListener("click", () => setTab("act"));
  setTab("vox");

  refs.presetSel.addEventListener('change', toggleCustom);
  toggleCustom();

  refs.btnCopyLog.addEventListener('click', async function () {
    try {
      const text = (App.state.logs || []).join("\n");
      await navigator.clipboard.writeText(text);
      log.info("Log copiado para área de transferência.");
    } catch (e) {
      log.warn("Não foi possível copiar o log.", String(e));
    }
  });

  refs.btnClearLog.addEventListener('click', function () {
    App.log.clear();
    log.info("Log limpo.");
  });

  refs.btnStart.addEventListener('click', function () {
    App.svc.BackfillRunner?.startFromUi?.();
  });

  refs.btnStop.addEventListener('click', function () {
    App.svc.BackfillRunner?.stop?.();
  });
})(window);