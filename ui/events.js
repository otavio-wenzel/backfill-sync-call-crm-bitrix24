(function (global) {
  const App = global.App = global.App || {};
  const log = App.log;
  const refs = App.ui.refs;

  function toggleCustom() {
    refs.customRangeBox.style.display = (refs.presetSel.value === 'custom') ? 'flex' : 'none';
  }

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
    if (App.svc.BackfillRunner) App.svc.BackfillRunner.startFromUi();
  });

  refs.btnStop.addEventListener('click', function () {
    if (App.svc.BackfillRunner) App.svc.BackfillRunner.stop();
  });
})(window);