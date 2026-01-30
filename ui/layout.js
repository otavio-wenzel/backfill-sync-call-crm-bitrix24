(function (global) {
  const App = global.App = global.App || {};
  App.ui.refs = App.ui.refs || {};

  const r = App.ui.refs;

  r.headerUserInfoEl = document.getElementById('header-user-info');

  // Tabs
  r.tabVox = document.getElementById('tab-vox');
  r.tabAct = document.getElementById('tab-act');
  r.tabBodyVox = document.getElementById('tab-body-vox');
  r.tabBodyAct = document.getElementById('tab-body-act');

  // Mode controls
  r.actOnlyMissing = document.getElementById('act-only-missing');
  r.actForceRelink = document.getElementById('act-force-relink');

  // Period controls
  r.presetSel = document.getElementById('period-preset');
  r.customRangeBox = document.getElementById('custom-range');
  r.dateFrom = document.getElementById('date-from');
  r.dateTo = document.getElementById('date-to');
  r.chunkDays = document.getElementById('chunk-days');
  r.matchWindowFixed = document.getElementById('match-window-fixed');

  // Buttons
  r.btnStart = document.getElementById('btn-start');
  r.btnStop = document.getElementById('btn-stop');
  r.btnCopyLog = document.getElementById('btn-copylog');
  r.btnClearLog = document.getElementById('btn-clearlog');

  // Stats
  r.stK1 = document.getElementById('st-k1');
  r.stK2 = document.getElementById('st-k2');
  r.stK3 = document.getElementById('st-k3');
  r.stK4 = document.getElementById('st-k4');
  r.stK5 = document.getElementById('st-k5');
  r.stK6 = document.getElementById('st-k6');

  r.stV1 = document.getElementById('st-v1');
  r.stV2 = document.getElementById('st-v2');
  r.stV3 = document.getElementById('st-v3');
  r.stV4 = document.getElementById('st-v4');
  r.stV5 = document.getElementById('st-v5');
  r.stV6 = document.getElementById('st-v6');

  // Progress
  r.progressBar = document.getElementById('progress-bar');
  r.progressMeta = document.getElementById('progress-meta');

})(window);