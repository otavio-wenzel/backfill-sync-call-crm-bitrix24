(function (global) {
  const App = global.App = global.App || {};
  const BX = App.core.BX24;

  async function getCalls(dateFromIso, dateToIso) {
    const filter = {
      ">=CALL_START_DATE": BX.isoToSpace(dateFromIso),
      "<=CALL_START_DATE": BX.isoToSpace(dateToIso)
    };

    return await BX.listAll(
      "voximplant.statistic.get",
      { FILTER: filter, SORT: "CALL_START_DATE", ORDER: "ASC" },
      { timeoutPerPageMs: 120000, maxTotalMs: 900000, pageDelayMs: 200, maxRetries: 3 }
    );
  }

  App.svc.TelephonyProvider = { getCalls };
})(window);