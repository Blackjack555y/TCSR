(function () {
  var overlay = document.getElementById('overlay');
  var confirmBtn = document.getElementById('confirm-consent');
  var choices = document.querySelectorAll('.choice');
  var radios = document.querySelectorAll('input[name="consent"]');
  var qrCard = document.getElementById('qr-card');
  var qrStatus = document.getElementById('qr-status');
  var reopenBtn = document.getElementById('reopen-privacy');

  function getStoredConsent() {
    try {
      return localStorage.getItem('csr-consent');
    } catch (e) {
      return null;
    }
  }

  function storeConsent(value) {
    try {
      localStorage.setItem('csr-consent', value);
    } catch (e) {
      /* si el almacenamiento no esta disponible, seguimos sin persistir */
    }
  }

  function applyConsent(value) {
    if (value === 'si') {
      qrCard.classList.remove('locked');
      qrStatus.classList.remove('show');
    } else {
      qrCard.classList.add('locked');
      qrStatus.classList.add('show');
      qrStatus.textContent = value === 'no'
        ? 'No podemos mostrarte la encuesta sin tu aceptación del aviso de privacidad.'
        : 'Acepta el aviso de privacidad para escanear el código.';
    }
  }

  function openModal() {
    overlay.classList.add('open');
  }

  function closeModal() {
    overlay.classList.remove('open');
  }

  choices.forEach(function (choice) {
    choice.addEventListener('click', function () {
      var radio = choice.querySelector('input');
      radio.checked = true;
      choices.forEach(function (c) { c.classList.remove('selected'); });
      choice.classList.add('selected');
      confirmBtn.disabled = false;
    });
  });

  confirmBtn.addEventListener('click', function () {
    var selected = document.querySelector('input[name="consent"]:checked');
    if (!selected) return;
    storeConsent(selected.value);
    applyConsent(selected.value);
    closeModal();
  });

  reopenBtn.addEventListener('click', function () {
    var stored = getStoredConsent();
    if (stored) {
      radios.forEach(function (r) {
        var choiceEl = r.closest('.choice');
        if (r.value === stored) {
          r.checked = true;
          choiceEl.classList.add('selected');
        } else {
          r.checked = false;
          choiceEl.classList.remove('selected');
        }
      });
      confirmBtn.disabled = false;
    }
    openModal();
  });

  document.getElementById('policy-link').addEventListener('click', function (e) {
    e.preventDefault();
  });

  var existing = getStoredConsent();
  if (existing) {
    applyConsent(existing);
  } else {
    applyConsent('pendiente');
    openModal();
  }
})();