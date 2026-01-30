(function (global) {
  const App = global.App = global.App || {};
  const BX = App.core.BX24;
  const log = App.log;
  const refs = App.ui.refs;

  const Telephony = App.svc.TelephonyProvider;
  const Activity = App.svc.ActivityProvider;
  const SPA = App.svc.SpaProvider;

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

  function shiftIso(iso, minutes) {
    const d = new Date(iso);
    d.setMinutes(d.getMinutes() + minutes);
    return BX.nowIsoFromDate(d);
  }

  async function runVoxToSpa(range, chunkDays, counters) {
    const chunks = BX.splitIntoChunks(range.dateFromIso, range.dateToIso, chunkDays);
    log.info(`(Aba 1) Vox → SPA: ${chunks.length} chunk(s)`);

    for (let ci = 0; ci < chunks.length; ci++) {
      if (App.state.backfill.canceled) throw new Error("CANCELED");
      const ch = chunks[ci];

      setProgress(Math.round((ci / Math.max(1, chunks.length)) * 100), `Aba 1 • Chunk ${ci + 1}/${chunks.length}...`);

      const calls = await Telephony.getCalls(ch.dateFrom, ch.dateTo);
      log.info(`Aba 1 • Chunk ${ci + 1}/${chunks.length}: calls=${calls.length}`);

      counters.total += calls.length;
      setStat("st-total", counters.total);

      for (let i = 0; i < calls.length; i++) {
        if (App.state.backfill.canceled) throw new Error("CANCELED");

        const c = calls[i];
        const callId = String(c.CALL_ID || c.ID || "");

        try {
          const r = await SPA.upsertFromVoxCall(c);
          if (r.mode === "created") counters.created++;
          else counters.updated++;
        } catch (e) {
          counters.errors++;
          log.error(`Aba 1 • Falha upsert call=${callId}`, { msg: e?.message || String(e) });
        }

        counters.done++;

        if (i % 10 === 0 || i === calls.length - 1) {
          setStat("st-created", counters.created);
          setStat("st-updated", counters.updated);
          setStat("st-errors", counters.errors);

          const pct = Math.round((counters.done / Math.max(1, counters.total)) * 100);
          setProgress(pct, `Aba 1 • Processando ${counters.done}/${counters.total}`);
        }
      }
    }
  }

  async function runActivitiesToSpa(range, chunkDays, onlyMissingActivity, counters) {
    const chunks = BX.splitIntoChunks(range.dateFromIso, range.dateToIso, chunkDays);
    const windowMin = parseInt(App.config.MATCH_WINDOW_MIN, 10) || 3;
    const windowMs = Math.max(60_000, windowMin * 60_000);

    log.info(`(Aba 2) Activities → SPA: ${chunks.length} chunk(s), onlyMissing=${!!onlyMissingActivity}, windowMin=${windowMin}`);

    for (let ci = 0; ci < chunks.length; ci++) {
      if (App.state.backfill.canceled) throw new Error("CANCELED");
      const ch = chunks[ci];

      setProgress(Math.round((ci / Math.max(1, chunks.length)) * 100), `Aba 2 • Chunk ${ci + 1}/${chunks.length}...`);

      const spas = await SPA.listSpasByPeriod(ch.dateFrom, ch.dateTo, !!onlyMissingActivity);
      log.info(`Aba 2 • Chunk ${ci + 1}/${chunks.length}: spas=${spas.length}`);

      counters.total += spas.length;
      setStat("st-total", counters.total);

      if (!spas.length) continue;

      // responsibleIds presentes nos SPAs do chunk
      const respIds = Array.from(new Set(
        spas.map(s => (s[F.USER_ID] ? String(s[F.USER_ID]) : null)).filter(Boolean)
      ));

      // puxa activities numa janela maior
      const actFrom = shiftIso(ch.dateFrom, -windowMin);
      const actTo   = shiftIso(ch.dateTo, +windowMin);

      const acts = await Activity.getCallActivities(actFrom, actTo, respIds);
      const actIndex = Activity.indexActivities(acts);

      log.info(`Aba 2 • activities=${acts.length}, respIds=${respIds.length}`);

      for (let i = 0; i < spas.length; i++) {
        if (App.state.backfill.canceled) throw new Error("CANCELED");

        const spa = spas[i];
        const spaId = spa.id || spa.ID;
        const phone = spa[F.PHONE_NUMBER] || "";
        const respId = spa[F.USER_ID] || "";
        const dt = spa[F.CALL_START_DT] || "";
        const callStartTs = BX.parseDateToTs(dt);

        const resolved = Activity.resolveByUserPhoneTime({ respId, phone, callStartTs }, actIndex, windowMs);

        if (resolved && resolved.ambiguity) {
          counters.amb++;
          log.warn("Aba 2 • AMBIGUOUS", { spaId, candidates: resolved.candidates || [] });
        }

        if (!resolved || !resolved.activityId) {
          counters.noact++;
          counters.done++;
          continue;
        }

        try {
          const patch = {};
          patch[F.CRM_ACTIVITY_ID] = String(resolved.activityId);

          if (resolved.entityType) patch[F.ENTITY_TYPE] = String(resolved.entityType);
          if (resolved.entityId) patch[F.ENTITY_ID] = String(resolved.entityId);

          if (resolved.dispositionRaw) patch[F.DISPOSITION_RAW] = String(resolved.dispositionRaw).slice(0, 5000);

          // timestamps
          const now = BX.nowIso();
          patch[F.SYNCED_AT] = now;
          patch[F.UPDATED_AT] = now;

          const updId = await SPA.updateSpaActivity(spaId, patch);
          counters.updated++;

          // opcional: carimbar RESULT
          if (resolved.disposition) {
            await Activity.tryWriteDispositionToActivity(resolved.activityId, resolved.disposition);
          }

          log.info("Aba 2 • SPA vinculado", { spaId: updId, activityId: resolved.activityId });

        } catch (e) {
          counters.errors++;
          log.error("Aba 2 • Falha update SPA", { spaId, msg: e?.message || String(e) });
        }

        counters.done++;

        if (i % 10 === 0 || i === spas.length - 1) {
          setStat("st-updated", counters.updated);
          setStat("st-noact", counters.noact);
          setStat("st-amb", counters.amb);
          setStat("st-errors", counters.errors);

          const pct = Math.round((counters.done / Math.max(1, counters.total)) * 100);
          setProgress(pct, `Aba 2 • Processando ${counters.done}/${counters.total}`);
        }
      }
    }
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
      const tab = App.state.ui?.activeTab || "vox";

      if (tab === "vox") {
        await runVoxToSpa(range, chunkDays, counters);
      } else {
        const onlyMissing = !!refs.onlyMissingActivity?.checked;
        await runActivitiesToSpa(range, chunkDays, onlyMissing, counters);
      }

      setProgress(100, "✅ Concluído.");
      log.info("✅ TAREFA CONCLUÍDA", counters);

      alert(
        `✅ Concluído!\n\nItens: ${counters.total}\nCriados: ${counters.created}\nAtualizados: ${counters.updated}\nSem match: ${counters.noact}\nAmbíguos: ${counters.amb}\nErros: ${counters.errors}`
      );

    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (msg === "CANCELED") {
        log.warn("⛔ Tarefa interrompida pelo usuário.");
        setProgress(0, "Interrompido.");
      } else {
        log.error("Erro fatal", msg);
        setProgress(0, "Erro fatal.");
        alert("Erro fatal: " + msg);
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