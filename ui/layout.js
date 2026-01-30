(function (global) {
  const App = global.App = global.App || {};
  App.ui.refs = App.ui.refs || {};

  const r = App.ui.refs;

  r.headerUserInfoEl = document.getElementById('header-user-info');

  r.tabVox = document.getElementById('tab-vox');
  r.tabAct = document.getElementById('tab-act');
  r.rowOnlyMissing = document.getElementById('row-only-missing');

  r.presetSel = document.getElementById('period-preset');
  r.customRangeBox = document.getElementById('custom-range');
  r.dateFrom = document.getElementById('date-from');
  r.dateTo = document.getElementById('date-to');
  r.chunkDays = document.getElementById('chunk-days');
  r.onlyMissingActivity = document.getElementById('only-missing-activity');

  r.btnStart = document.getElementById('btn-start');
  r.btnStop = document.getElementById('btn-stop');
  r.btnCopyLog = document.getElementById('btn-copylog');
  r.btnClearLog = document.getElementById('btn-clearlog');

  r.progressBar = document.getElementById('progress-bar');
  r.progressMeta = document.getElementById('progress-meta');
})(window);