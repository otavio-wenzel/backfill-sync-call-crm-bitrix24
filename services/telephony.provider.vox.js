(function (global) {
  const App = global.App = global.App || {};
  const BX = App.core.BX24;
  const log = App.log;

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

  /**
   * ✅ Tenta vincular a chamada no telephony ao CRM_ACTIVITY_ID
   * - Em alguns portais existe `voximplant.statistic.update` (ou variação) para “colar” CRM_ACTIVITY_ID.
   * - Se não existir, apenas loga e segue (sem quebrar o backfill).
   */
  async function tryAttachActivity(callId, activityId) {
    if (!App.config.TELEPHONY_TRY_ATTACH_ACTIVITY) return { ok: false, skipped: true };

    const cid = String(callId || "").trim();
    const aid = String(activityId || "").trim();
    if (!cid || !aid) return { ok: false, skipped: true };

    // Tentativa 1: voximplant.statistic.update (quando disponível no portal) :contentReference[oaicite:2]{index=2}
    try {
      const res = await BX.callMethod("voximplant.statistic.update", {
        CALL_ID: cid,
        CRM_ACTIVITY_ID: aid
      });
      log?.info?.("TELEPHONY_ATTACH_OK", { callId: cid, activityId: aid, method: "voximplant.statistic.update" });
      return { ok: true, method: "voximplant.statistic.update", res: (typeof res.data === "function") ? res.data() : res.data };
    } catch (e1) {
      log?.warn?.("TELEPHONY_ATTACH_FAIL", { callId: cid, activityId: aid, method: "voximplant.statistic.update", err: e1?.message || String(e1) });
    }

    // Tentativa 2 (fallback): telephony.externalcall.finish (apenas para telefonia EXTERNA) :contentReference[oaicite:3]{index=3}
    // Mantido aqui para casos híbridos; normalmente NÃO aplica ao voximplant nativo.
    try {
      const res = await BX.callMethod("telephony.externalcall.finish", {
        CALL_ID: cid,
        CRM_ACTIVITY_ID: aid
      });
      log?.info?.("TELEPHONY_ATTACH_OK", { callId: cid, activityId: aid, method: "telephony.externalcall.finish" });
      return { ok: true, method: "telephony.externalcall.finish", res: (typeof res.data === "function") ? res.data() : res.data };
    } catch (e2) {
      log?.warn?.("TELEPHONY_ATTACH_FAIL", { callId: cid, activityId: aid, method: "telephony.externalcall.finish", err: e2?.message || String(e2) });
    }

    return { ok: false };
  }

  App.svc.TelephonyProvider = { getCalls, tryAttachActivity };
})(window);