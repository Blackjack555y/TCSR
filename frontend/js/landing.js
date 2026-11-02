// Carro Sin Rollos · Landing
// Flujo: placa → diálogo (documento del propietario + aviso de privacidad) → consultando → resultado.
// La consulta todavía no está conectada al backend: runQuery() devuelve el estado "demo".

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // ---------------- validación ----------------

  // Formatos aceptados por la fuente: carro AAA000, moto AAA00A, moto antigua AAA00,
  // AAAA00, y remolques R00000 / S00000.
  const PLATE_RE = /^(?:[A-Z]{3}\d{3}|[A-Z]{3}\d{2}[A-Z]?|[A-Z]{4}\d{2}|[RS]\d{5})$/;

  const DOC_RULES = {
    CC: { re: /^\d{3,11}$/, msg: 'La cédula solo lleva números, sin puntos ni espacios.', numeric: true },
    CE: { re: /^\d{3,11}$/, msg: 'La cédula de extranjería solo lleva números.', numeric: true },
    NIT: { re: /^\d{9,10}$/, msg: 'Escribe el NIT sin dígito de verificación, solo números.', numeric: true },
    PA: { re: /^[A-Z0-9]{4,15}$/, msg: 'Revisa el pasaporte: solo letras y números.', numeric: false },
    PPT: { re: /^[A-Z0-9]{4,15}$/, msg: 'Revisa el número del PPT: solo letras y números.', numeric: false }
  };

  const normalizePlate = (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

  function setError(input, errorEl, message) {
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  // ---------------- paso 1: placa ----------------

  const plateForm = $('#plate-form');
  const plateInput = $('#plate');
  const plateBox = $('.plate');
  const plateError = $('#plate-error');
  let currentPlate = '';

  plateInput.addEventListener('input', () => {
    const clean = normalizePlate(plateInput.value).slice(0, 6);
    if (plateInput.value !== clean) plateInput.value = clean;
    if (!plateError.hidden && PLATE_RE.test(clean)) {
      setError(plateInput, plateError, '');
      plateBox.classList.remove('is-invalid');
    }
  });

  plateForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const plate = normalizePlate(plateInput.value);

    if (!plate) {
      setError(plateInput, plateError, 'Escribe la placa del vehículo.');
    } else if (!PLATE_RE.test(plate)) {
      setError(plateInput, plateError, 'Revisa la placa: 3 letras y 3 números para carro (ABC123) o 3 letras, 2 números y una letra para moto (ABC12D).');
    } else {
      setError(plateInput, plateError, '');
      plateBox.classList.remove('is-invalid');
      currentPlate = plate;
      openQueryDialog();
      return;
    }
    plateBox.classList.add('is-invalid');
    plateInput.focus();
  });

  // ---------------- paso 2: diálogo ----------------

  const dialog = $('#query-dialog');
  const ownerForm = $('#owner-form');
  const docType = $('#doc-type');
  const docNumber = $('#doc-number');
  const docError = $('#doc-error');
  const analyzeBtn = $('#analyze-btn');
  const analyzeHint = $('#analyze-hint');
  const consentMsg = $('#consent-msg');
  const steps = $$('.modal-step', dialog);
  let inFlight = false;

  // El texto completo del aviso vive en un solo lugar (#privacy-text) y se reutiliza aquí.
  $('[data-privacy-text]', dialog).innerHTML = $('#privacy-text').innerHTML;

  function showStep(name) {
    steps.forEach((step) => { step.hidden = step.dataset.step !== name; });
  }

  function openQueryDialog() {
    $$('[data-plate-out]', dialog).forEach((el) => { el.textContent = currentPlate; });
    showStep('form');
    dialog.showModal();
    docNumber.focus();
  }

  function consentValue() {
    const checked = $('input[name="consent"]:checked', ownerForm);
    return checked ? checked.value : null;
  }

  function docIsValid() {
    const rule = DOC_RULES[docType.value];
    return rule.re.test(docNumber.value.trim().toUpperCase());
  }

  // El botón solo se habilita con documento válido y autorización aceptada.
  function updateAnalyzeState() {
    const consent = consentValue();
    consentMsg.hidden = consent !== 'no';
    const ready = docIsValid() && consent === 'si';
    analyzeBtn.disabled = !ready || inFlight;
    analyzeHint.hidden = ready;
    analyzeHint.textContent = consent === 'no'
      ? 'Necesitamos tu autorización para hacer la consulta.'
      : 'Completa el documento y acepta el aviso para continuar.';
  }

  docType.addEventListener('change', () => {
    docNumber.inputMode = DOC_RULES[docType.value].numeric ? 'numeric' : 'text';
    setError(docNumber, docError, '');
    updateAnalyzeState();
  });

  docNumber.addEventListener('input', () => {
    if (DOC_RULES[docType.value].numeric) {
      docNumber.value = docNumber.value.replace(/\D/g, '');
    } else {
      docNumber.value = docNumber.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    }
    if (!docError.hidden && docIsValid()) setError(docNumber, docError, '');
    updateAnalyzeState();
  });

  docNumber.addEventListener('blur', () => {
    if (docNumber.value && !docIsValid()) {
      setError(docNumber, docError, DOC_RULES[docType.value].msg);
    }
  });

  $$('input[name="consent"]', ownerForm).forEach((radio) => radio.addEventListener('change', updateAnalyzeState));

  ownerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (inFlight) return; // evita doble envío
    if (!docIsValid()) {
      setError(docNumber, docError, DOC_RULES[docType.value].msg);
      docNumber.focus();
      return;
    }
    if (consentValue() !== 'si') return;

    inFlight = true;
    analyzeBtn.setAttribute('aria-busy', 'true');
    updateAnalyzeState();
    showStep('loading');

    try {
      const result = await runQuery({ placa: currentPlate, docType: docType.value, docNumber: docNumber.value.trim() });
      showSystemState(result.status);
    } catch (err) {
      showSystemState(err && err.name === 'TimeoutError' ? 'timeout' : 'error');
    } finally {
      inFlight = false;
      analyzeBtn.removeAttribute('aria-busy');
      updateAnalyzeState();
    }
  });

  // ---------------- consulta y estados del sistema ----------------

  // Mensajes de los estados del sistema. Son distintos de los estados del dato
  // (sin hallazgos / requiere revisión / no disponible / alerta).
  const SYSTEM_STATES = {
    demo: {
      title: 'Versión de demostración',
      text: 'La consulta todavía no está conectada al servicio de datos. Muy pronto podrás analizar tu vehículo aquí.',
      retry: false
    },
    error: {
      title: 'No pudimos completar la consulta',
      text: 'Algo falló de nuestro lado. No se te cobró nada. Intenta de nuevo en unos minutos.',
      retry: true
    },
    timeout: {
      title: 'La consulta está tardando más de lo normal',
      text: 'Las fuentes no respondieron a tiempo. Puedes intentar de nuevo.',
      retry: true
    },
    owner_mismatch: {
      title: 'El documento no coincide con el propietario',
      text: 'El RUNT no reconoce ese documento como el del propietario actual de este vehículo. Confírmalo con el vendedor: si no es el dueño registrado, tenlo en cuenta antes de comprar.',
      retry: true
    },
    not_found: {
      title: 'No encontramos información suficiente',
      text: 'No hay registros para esta placa en las fuentes consultadas. Revisa que esté bien escrita.',
      retry: true
    },
    source_down: {
      title: 'Una fuente no está disponible en este momento',
      text: 'Uno de los registros que consultamos está caído temporalmente. Intenta de nuevo más tarde.',
      retry: true
    }
  };

  function showSystemState(status) {
    const state = SYSTEM_STATES[status] || SYSTEM_STATES.error;
    $('[data-system-title]', dialog).textContent = state.title;
    $('[data-system-text]', dialog).textContent = state.text;
    $('[data-retry]', dialog).hidden = !state.retry;
    showStep('system');
  }

  // TODO: conectar con el backend (POST /api/consultas). El backend llama a PlacApi;
  // nunca exponer la API key en el frontend.
  function runQuery(/* payload */) {
    return new Promise((resolve) => setTimeout(() => resolve({ status: 'demo' }), 2400));
  }

  $('[data-retry]', dialog).addEventListener('click', () => {
    showStep('form');
    docNumber.focus();
  });

  // ---------------- cierre de diálogos ----------------

  function closeDialog(dlg) {
    if (dlg === dialog && inFlight) return; // no cerrar a mitad de la consulta
    dlg.close();
  }

  $$('dialog.modal').forEach((dlg) => {
    $$('[data-close]', dlg).forEach((btn) => btn.addEventListener('click', () => closeDialog(dlg)));
    // clic en el fondo
    dlg.addEventListener('click', (event) => { if (event.target === dlg) closeDialog(dlg); });
    dlg.addEventListener('cancel', (event) => {
      if (dlg === dialog && inFlight) event.preventDefault();
    });
  });

  dialog.addEventListener('close', () => {
    // el documento del propietario no se conserva al cerrar
    docNumber.value = '';
    setError(docNumber, docError, '');
    updateAnalyzeState();
    plateInput.focus({ preventScroll: true });
  });

  // ---------------- aviso de privacidad ----------------

  const privacyDialog = $('#privacy-dialog');
  $$('[data-open-privacy]').forEach((btn) => btn.addEventListener('click', () => privacyDialog.showModal()));

  // ---------------- CTA final → foco en la placa ----------------

  $$('[data-focus-plate]').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault();
    $('#inicio').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setTimeout(() => plateInput.focus({ preventScroll: true }), 400);
  }));

  updateAnalyzeState();
})();
