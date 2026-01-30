(function (global) {
  const App = global.App = global.App || {};
  const log = App.log;
  const refs = App.ui.refs;

  function toggleCustom() {
    refs.customRangeBox.style.display = (refs.presetSel.value === 'custom') ? 'flex' : 'none';
  }

  function setActiveTab(which) {
    const isVox = which === 'vox';
    refs.tabVox.classList.toggle('active', isVox);
    refs.tabAct.classList.toggle('active', !isVox);
    refs.tabBodyVox.classList.toggle('hidden', !isVox);
    refs.tabBodyAct.classList.toggle('hidden', isVox);

    App.state.mode = isVox ? 'VOX_TO_SPA' : 'ACTIVITY_TO_SPA';

    // Ajusta labels do status para o modo
    App.svc.BackfillRunner?.configureUiForMode?.(App.state.mode);
  }

  refs.presetSel.addEventListener('change', toggleCustom);
  toggleCustom();

  refs.tabVox.addEventListener('click', () => setActiveTab('vox'));
  refs.tabAct.addEventListener('click', () => setActiveTab('act'));

  // Default
  App.state.mode = 'VOX_TO_SPA';
  setActiveTab('vox');

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