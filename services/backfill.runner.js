(function (global) {
  const App = global.App = global.App || {};
  const BX = App.core.BX24;
  const log = App.log;
  const refs = App.ui.refs;

  const Telephony = App.svc.TelephonyProvider;
  const Activity = App.svc.ActivityProvider;
  const SPA = App.svc.SpaProvider;

  if (!Telephony || typeof Telephony.getCalls !== "function") {
    throw new Error("TelephonyProvider não carregou (App.svc.TelephonyProvider.getCalls ausente).");
  }
  if (!Activity || typeof Activity.getActivities !== "function") {
    throw new Error("ActivityProvider não carregou (App.svc.ActivityProvider.getActivities ausente).");
  }
  if (!SPA || typeof SPA.upsertFromCall !== "function") {
    throw new Error("SpaProvider não carregou (App.svc.SpaProvider.upsertFromCall ausente).");
  }

  App.state = App.state || {};
  App.state.backfill = App.state.backfill || { running: false, canceled: false };

  function setButtons(running) {
    refs.btnStart.disabled = !!running;
    refs.btnStop.disabled = !running;
  }

  function setStat(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  }

  function setProgress(pct, meta) {
    if (refs.progressBar) refs.progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (refs.progressMeta) refs.progressMeta.textContent = meta || "";
  }

  function computeRangeFromUi() {
    const preset = refs.presetSel.value;
    const now = new Date();

    function ymd(d) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }

    if (preset === "custom") {
      const df = refs.dateFrom.value;
      const dt = refs.dateTo.value;
      if (!df || !dt) return { error: "Selecione data inicial e final." };
      const { dateFromIso, dateToIso } = BX.isoLocalStartEndFromDates(df, dt);
      if (new Date(dateFromIso) > new Date(dateToIso)) return { error: "Data inicial maior que final." };
      return { dateFromIso, dateToIso };
    }

    const days = parseInt(preset.replace("d", ""), 10) || 7;
    const start = new Date(now);
    start.setDate(now.getDate() - (days - 1));
    const df = ymd(start);
    const dt = ymd(now);
    return BX.isoLocalStartEndFromDates(df, dt);
  }

  async function start() {
    App.state.backfill.running = true;
    App.state.backfill.canceled = false;
    setButtons(true);

    const counters = { total: 0, done: 0, created: 0, updated: 0, noact: 0, amb: 0, errors: 0 };

    setStat("st-total", 0);
    setStat("st-created", 0);
    setStat("st-updated", 0);
    setStat("st-noact", 0);
    setStat("st-amb", 0);
    setStat("st-errors", 0);
    setProgress(0, "Preparando...");

    try {
      await SPA.loadEnums();

      const range = computeRangeFromUi();
      if (range.error) {
        log.warn("Filtro inválido: " + range.error);
        setProgress(0, "Filtro inválido.");
        return;
      }

      const chunkDays = parseInt(refs.chunkDays.value, 10) || 7;
      const windowMin = parseInt(refs.matchWindowMin.value, 10) || 10;

      const chunks = BX.splitIntoChunks(range.dateFromIso, range.dateToIso, chunkDays);
      log.info(`Executando ${chunks.length} chunk(s), chunkDays=${chunkDays}, windowMin=${windowMin}`);

      setProgress(0, "Iniciando...");

      for (let ci = 0; ci < chunks.length; ci++) {
        if (App.state.backfill.canceled) throw new Error("CANCELED");

        const ch = chunks[ci];

        setProgress(
          Math.round((ci / Math.max(1, chunks.length)) * 100),
          `Chunk ${ci + 1}/${chunks.length} preparando...`
        );

        const calls = await Telephony.getCalls(ch.dateFrom, ch.dateTo);
        counters.total += calls.length;
        setStat("st-total", counters.total);

        if (!calls.length) {
          log.info(`Chunk ${ci + 1}/${chunks.length}: calls=0 (pulando activities)`);
          log.info(`Chunk ${ci + 1} concluído.`);
          continue;
        }

        const respIds = Array.from(new Set(
          calls.map(c => c.PORTAL_USER_ID ? String(c.PORTAL_USER_ID) : null).filter(Boolean)
        ));

        function shiftIso(iso, minutes) {
          const d = new Date(iso);
          d.setMinutes(d.getMinutes() + minutes);
          return BX.nowIsoFromDate(d);
        }

        const windowMs = Math.max(60_000, windowMin * 60_000);
        const windowMinPad = Math.ceil(windowMs / 60000);

        const actFrom = shiftIso(ch.dateFrom, -windowMinPad);
        const actTo   = shiftIso(ch.dateTo, +windowMinPad);

        const acts = await Activity.getActivities(actFrom, actTo, respIds);
        const actIndex = Activity.indexActivities(acts);

        log.info(`Chunk ${ci + 1}/${chunks.length}: calls=${calls.length}, activities=${acts.length}`);

        for (let i = 0; i < calls.length; i++) {
          if (App.state.backfill.canceled) throw new Error("CANCELED");

          const c = calls[i];
          const callId = String(c.CALL_ID || c.ID || "");
          const resolved = Activity.resolveForCall(c, actIndex, windowMs);

          if (resolved && resolved.ambiguity) {
            counters.amb++;
            log.warn(`AMBIGUOUS call=${callId}`, resolved.candidates || {});
          }
          if (!(resolved && resolved.activityId)) {
            counters.noact++;
          }

          try {
            // ✅ 1) tenta “colar” activity no telephony (quando suportado)
            if (resolved?.activityId) {
              await Telephony.tryAttachActivity(callId, resolved.activityId);
            }

            // ✅ 2) grava disposition no Activity (RESULT)
            if (resolved?.activityId && resolved?.disposition) {
              await Activity.tryWriteDispositionToActivity(resolved.activityId, resolved.disposition);
            }

            // ✅ 3) upsert no SPA (como vocês já faziam)
            const r = await SPA.upsertFromCall(c, resolved);
            if (r.mode === "created") counters.created++;
            else if (r.mode === "updated") counters.updated++;

          } catch (e) {
            counters.errors++;
            log.error(`Falha upsert call=${callId}`, {
              msg: (e && e.message) ? e.message : String(e),
              stack: e && e.stack ? String(e.stack).slice(0, 1200) : null
            });
          }

          counters.done++;

          if (i % 5 === 0 || i === calls.length - 1) {
            setStat("st-created", counters.created);
            setStat("st-updated", counters.updated);
            setStat("st-noact", counters.noact);
            setStat("st-amb", counters.amb);
            setStat("st-errors", counters.errors);

            const pct = Math.round((counters.done / Math.max(1, counters.total)) * 100);
            setProgress(pct, `Processando ${counters.done}/${counters.total} (chunk ${ci + 1}/${chunks.length})`);
          }

          if (i % 25 === 0) await new Promise(r => setTimeout(r, 50));
        }

        log.info(`Chunk ${ci + 1} concluído.`);
      }

      setProgress(100, "✅ Concluído.");
      log.info("✅ TAREFA CONCLUÍDA", counters);

      alert(
        `✅ Concluído!\n\nChamadas: ${counters.total}\nCriados: ${counters.created}\nAtualizados: ${counters.updated}\nSem activity: ${counters.noact}\nAmbíguos: ${counters.amb}\nErros: ${counters.errors}`
      );
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (msg === "CANCELED") {
        log.warn("⛔ Backfill interrompido pelo usuário.");
        setProgress(0, "Interrompido.");
      } else {
        log.error("Erro fatal no backfill", msg);
        setProgress(0, "Erro fatal.");
        alert("Erro fatal no backfill: " + msg);
      }
    } finally {
      App.state.backfill.running = false;
      App.state.backfill.canceled = false;
      setButtons(false);
    }
  }

  function stop() {
    if (!App.state.backfill.running) return;
    App.state.backfill.canceled = true;
    log.warn("Solicitação de parada enviada...");
  }

  function startFromUi() {
    if (App.state.backfill.running) return;
    start();
  }

  App.svc.BackfillRunner = { startFromUi, stop };
})(window);