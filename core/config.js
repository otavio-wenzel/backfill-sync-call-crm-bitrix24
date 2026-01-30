(function (global) {
  const App = global.App = global.App || {};

  App.config.ENTITY_TYPE_ID = 1068;

  App.config.FIELD_CODES = {
    TELEPHONY_CALL_ID: "ufCrm12_1769103594",
    CRM_ACTIVITY_ID:   "ufCrm12_1769103691",
    DEDUP_KEY:         "ufCrm12_1769103795",
    USER_ID:           "ufCrm12_1769103861",
    USER_NAME:         "ufCrm12_1769103932",
    CALL_DIRECTION:    "ufCrm12_1769103994",
    PHONE_NUMBER:      "ufCrm12_1769104069",
    CALL_STATUS_CODE:  "ufCrm12_1769104141",
    CALL_START_DT:     "ufCrm12_1769104245",
    CALL_DURATION:     "ufCrm12_1769104293",
    ANSWERED:          "ufCrm12_1769104391",
    DISPOSITION:       "ufCrm12_1769104508",
    DISPOSITION_RAW:   "ufCrm12_1769104556",
    ENTITY_TYPE:       "ufCrm12_1769104880",
    ENTITY_ID:         "ufCrm12_1769104915",
    CREATED_AT:        "ufCrm12_1769104953",
    UPDATED_AT:        "ufCrm12_1769104996",
    SYNCED_AT:         "ufCrm12_1769105024"
  };

  // Debug
  App.config.DEBUG_VERIFY_SAVE = true;

  // ⚠️ Janela FIXA (não editável pelo usuário)
  // Use o mesmo padrão da app antiga: poucos minutos, constante.
  App.config.MATCH_WINDOW_MIN = 3; // ajuste aqui se quiser 2

  // Opcional (mantive)
  App.config.WRITE_DISPOSITION_TO_ACTIVITY = true;
  App.config.ACTIVITY_RESULT_PREFIX = "[DISPOSITION]";
  App.config.ACTIVITY_PREPEND_TO_DESCRIPTION = false;

  App.config.DISPOSITIONS = [
    "REUNIÃO AGENDADA",
    "FALEI COM SECRETÁRIA",
    "FOLLOW-UP",
    "RETORNO POR E-MAIL",
    "NÃO TEM INTERESSE",
    "NÃO FAZ LOCAÇÃO",
    "CAIXA POSTAL",
    "CHAMADA OCUPADA",
    "DESLIGOU",
    "CHAMADA PERDIDA",
    "NÚMERO INCORRETO"
  ];
})(window);