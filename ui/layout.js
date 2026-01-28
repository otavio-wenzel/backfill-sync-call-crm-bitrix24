(function (global) {
  const App = global.App = global.App || {};
  App.ui.refs = App.ui.refs || {};

  const r = App.ui.refs;
  r.headerUserInfoEl = document.getElementById('header-user-info');

  r.presetSel = document.getElementById('period-preset');
  r.customRangeBox = document.getElementById('custom-range');
  r.dateFrom = document.getElementById('date-from');
  r.dateTo = document.getElementById('date-to');
  r.matchWindowMin = document.getElementById('match-window-min');
  r.chunkDays = document.getElementById('chunk-days');

  r.btnStart = document.getElementById('btn-start');
  r.btnStop = document.getElementById('btn-stop');
  r.btnCopyLog = document.getElementById('btn-copylog');
  r.btnClearLog = document.getElementById('btn-clearlog');

  r.stTotal = document.getElementById('st-total');
  r.stCreated = document.getElementById('st-created');
  r.stUpdated = document.getElementById('st-updated');
  r.stNoAct = document.getElementById('st-noact');
  r.stAmb = document.getElementById('st-amb');
  r.stErrors = document.getElementById('st-errors');

  r.progressBar = document.getElementById('progress-bar');
  r.progressMeta = document.getElementById('progress-meta');
})(window);