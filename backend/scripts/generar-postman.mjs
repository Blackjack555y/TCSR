// Genera la colección de Postman de la API. Uso: node scripts/generar-postman.mjs
import { writeFileSync } from 'node:fs';

const js = (f) => f.toString().split('\n').slice(1, -1).map((l) => l.replace(/^ {4}/, ''));
const pruebas = (f) => [{ listen: 'test', script: { type: 'text/javascript', exec: js(f) } }];
const previo = (f) => [{ listen: 'prerequest', script: { type: 'text/javascript', exec: js(f) } }];
const url = (ruta, query) => ({
  raw: `{{base_url}}${ruta}${query ? `?${query.map((q) => `${q.key}=${q.value}`).join('&')}` : ''}`,
  host: ['{{base_url}}'], path: ruta.replace(/^\//, '').split('/'), ...(query && { query })
});
const auth = { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] };
const sinAuth = { type: 'noauth' };
const cuerpo = (o) => ({ mode: 'raw', raw: JSON.stringify(o, null, 2), options: { raw: { language: 'json' } } });

function peticion(nombre, metodo, ruta, { descripcion, body, query, eventos = [], conAuth = true } = {}) {
  return {
    name: nombre,
    event: eventos,
    request: {
      method: metodo, url: url(ruta, query), description: descripcion,
      auth: conAuth ? auth : sinAuth,
      header: body ? [{ key: 'Content-Type', value: 'application/json' }] : [],
      ...(body && { body: cuerpo(body) })
    }
  };
}

const coleccion = {
  info: {
    name: 'Carro Sin Rollos API',
    description: [
      'API del backend de Carro Sin Rollos. Documentación completa en backend/README.md.',
      '',
      'Para correrla en orden contra el backend en modo de desarrollo (PlacApi simulado, sin Supabase):',
      '1. Arranca el backend: `npm run dev` en backend/.',
      '2. Ejecuta la colección completa (Runner) con el entorno "Carro Sin Rollos · local".',
      '',
      'En desarrollo la sesión es un token `dev-<uuid>`: la colección lo genera sola si `token` está vacío.',
      'Con Supabase, pon en `token` el access_token de una sesión real.',
      '',
      'Documentos que simulan errores en modo simulado: 0000000409 (no coincide), 0000000404 (sin resultados), 0000000502 (fuente caída).'
    ].join('\n'),
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
  },
  event: previo(() => {
    // Genera un usuario de desarrollo si no hay token.
    if (!pm.environment.get('token')) {
      pm.environment.set('token', 'dev-' + require('uuid').v4());
    }
  }),
  item: [
    { name: 'Sistema', item: [
      peticion('Salud', 'GET', '/api/salud', { conAuth: false, eventos: pruebas(() => {
        pm.test('responde ok', () => pm.expect(pm.response.json().ok).to.eql(true));
      }) })
    ] },
    { name: 'Precios', item: [
      peticion('Tabla de precios', 'GET', '/api/precios', { conAuth: false, eventos: pruebas(() => {
        pm.test('trae los 4 rangos', () => pm.expect(pm.response.json().rangos).to.have.length(4));
      }) }),
      peticion('Cotizar', 'GET', '/api/precios/cotizar', { conAuth: false, query: [{ key: 'tipo', value: 'full' }, { key: 'cantidad', value: '5' }],
        descripcion: 'Total de una compra. Si comprar más sale más barato, trae `mejorOpcion`.', eventos: pruebas(() => {
          const c = pm.response.json();
          pm.test('5 Full cuestan 225.000', () => pm.expect(c.total).to.eql(225000));
          pm.test('sugiere 6 por menos', () => pm.expect(c.mejorOpcion.cantidad).to.eql(6));
        }) })
    ] },
    { name: 'Compras', item: [
      peticion('Crear compra', 'POST', '/api/compras', { body: { tipo: 'full', cantidad: 2 },
        descripcion: 'Crea la compra pendiente y devuelve los datos para abrir el widget de Wompi. El precio lo calcula el servidor.',
        eventos: pruebas(() => {
          pm.test('201', () => pm.response.to.have.status(201));
          const r = pm.response.json();
          pm.environment.set('compra_id', r.compra.id);
          pm.environment.set('compra_referencia', r.widget.reference);
          pm.environment.set('compra_centavos', r.widget.amountInCents);
          pm.test('firma de integridad', () => pm.expect(r.widget.signatureIntegrity).to.have.length(64));
        }) }),
      peticion('Webhook de Wompi (pago aprobado)', 'POST', '/api/webhooks/wompi', { conAuth: false,
        descripcion: 'Simula el evento transaction.updated de Wompi, firmado con `wompi_secreto_eventos`. Enviarlo dos veces acredita una sola vez.',
        body: { event: 'transaction.updated', data: { transaction: { id: '{{tx_id}}', status: 'APPROVED', reference: '{{compra_referencia}}', amount_in_cents: '{{compra_centavos}}', payment_method_type: 'PSE' } }, timestamp: '{{tx_timestamp}}', signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum: '{{tx_checksum}}' } },
        eventos: [
          ...previo(() => {
            const tx = 'TX-' + Date.now();
            const ts = Math.floor(Date.now() / 1000);
            const monto = pm.environment.get('compra_centavos');
            pm.variables.set('tx_id', tx);
            pm.variables.set('tx_timestamp', ts);
            pm.variables.set('tx_checksum', CryptoJS.SHA256(tx + 'APPROVED' + monto + ts + pm.environment.get('wompi_secreto_eventos')).toString());
            // El monto debe ir como número en el cuerpo.
            pm.request.body.raw = pm.request.body.raw.replace('"{{compra_centavos}}"', monto).replace('"{{tx_timestamp}}"', ts);
          }),
          ...pruebas(() => {
            pm.test('Wompi recibe 200', () => pm.response.to.have.status(200));
          })
        ] }),
      peticion('Saldo', 'GET', '/api/saldo', { eventos: pruebas(() => {
        pm.test('la compra quedó acreditada', () => pm.expect(pm.response.json().saldos.full).to.be.at.least(2));
      }) }),
      peticion('Historial de compras', 'GET', '/api/compras', { eventos: pruebas(() => {
        pm.test('la compra está aprobada', () => pm.expect(pm.response.json().compras[0].estado).to.eql('aprobada'));
      }) }),
      peticion('Verificar compra con Wompi', 'POST', '/api/compras/{{compra_id}}/verificar', { body: { transaccionId: 'TX-123' },
        descripcion: 'El frontend envía el id de transacción que devolvió Wompi y el servidor la confirma con la llave privada. Sin llave privada (desarrollo) solo devuelve el estado actual.',
        eventos: pruebas(() => {
          pm.test('200', () => pm.response.to.have.status(200));
        }) }),
      peticion('Aprobar compra sin pagar (solo desarrollo)', 'POST', '/api/dev/compras/{{compra_id}}/aprobar', {
        descripcion: 'Solo existe con PlacApi simulado y fuera de producción.' })
    ] },
    { name: 'Consultas', item: [
      peticion('Crear consulta Full', 'POST', '/api/consultas', { body: { tipo: 'full', placa: 'ABC123', docType: 'CC', docNumber: '1020304050', consentimiento: { aceptado: true, version: '2026-11' } },
        descripcion: 'Otros tipos: `{ "tipo": "basico", "placa": "ABC123" }` o `{ "tipo": "vin", "vin": "9FLA37CZ0EA000001" }`. Responde 402 sin saldo y 429 después de 5 fallidas por datos en 24 h.',
        eventos: pruebas(() => {
          pm.test('202 o 200 (reutilizada)', () => pm.expect(pm.response.code).to.be.oneOf([200, 202]));
          pm.environment.set('consulta_id', pm.response.json().id);
          pm.environment.set('intentos', 0);
        }) }),
      peticion('Estado de la consulta', 'GET', '/api/consultas/{{consulta_id}}', {
        descripcion: 'Repite cada 2–3 segundos hasta que el estado sea `completada` o `error`. En el Runner se repite sola.',
        eventos: [
          ...previo(() => {
            if (Number(pm.environment.get('intentos')) > 0) setTimeout(() => {}, 1500);
          }),
          ...pruebas(() => {
            const c = pm.response.json();
            const n = Number(pm.environment.get('intentos')) + 1;
            pm.environment.set('intentos', n);
            if (['en_curso', 'generando_pdf'].includes(c.estado) && n < 30) {
              pm.execution.setNextRequest(pm.info.requestName);
              return;
            }
            pm.test('completada', () => pm.expect(c.estado).to.eql('completada'));
            pm.test('trae la conclusión', () => pm.expect(c.resultado.conclusion.titulo).to.be.a('string'));
          })
        ] }),
      peticion('PDF (vista previa)', 'GET', '/api/consultas/{{consulta_id}}/pdf', { eventos: pruebas(() => {
        pm.test('es un PDF', () => pm.expect(pm.response.headers.get('Content-Type')).to.eql('application/pdf'));
        pm.test('inline', () => pm.expect(pm.response.headers.get('Content-Disposition')).to.match(/^inline/));
      }) }),
      peticion('PDF (descarga)', 'GET', '/api/consultas/{{consulta_id}}/pdf', { query: [{ key: 'descargar', value: '1' }], eventos: pruebas(() => {
        pm.test('como archivo', () => pm.expect(pm.response.headers.get('Content-Disposition')).to.match(/^attachment/));
      }) }),
      peticion('Historial de consultas', 'GET', '/api/consultas', { eventos: pruebas(() => {
        pm.test('incluye la consulta', () => pm.expect(pm.response.json().consultas.map((c) => c.id)).to.include(pm.environment.get('consulta_id')));
      }) })
    ] },
    { name: 'Errores esperados', item: [
      peticion('Sin sesión → 401', 'GET', '/api/saldo', { conAuth: false, eventos: pruebas(() => {
        pm.test('401', () => pm.response.to.have.status(401));
      }) }),
      peticion('Placa inválida → 400', 'POST', '/api/consultas', { body: { tipo: 'basico', placa: 'AB1', consentimiento: { aceptado: true, version: '2026-11' } }, eventos: pruebas(() => {
        pm.test('400 con el campo', () => {
          pm.response.to.have.status(400);
          pm.expect(pm.response.json().error.campos[0].campo).to.eql('placa');
        });
      }) }),
      peticion('Sin aceptar el aviso → 400', 'POST', '/api/consultas', { body: { tipo: 'basico', placa: 'ABC123', consentimiento: { aceptado: false, version: '2026-11' } }, eventos: pruebas(() => {
        pm.test('400', () => pm.response.to.have.status(400));
      }) }),
      peticion('Sin saldo → 402', 'POST', '/api/consultas', { body: { tipo: 'vin', vin: '9FLA37CZ0EA000001', consentimiento: { aceptado: true, version: '2026-11' } }, eventos: pruebas(() => {
        pm.test('402 sin_saldo', () => {
          pm.response.to.have.status(402);
          pm.expect(pm.response.json().error.codigo).to.eql('sin_saldo');
        });
      }) }),
      peticion('Consulta inexistente → 404', 'GET', '/api/consultas/00000000-0000-4000-8000-000000000000', { eventos: pruebas(() => {
        pm.test('404', () => pm.response.to.have.status(404));
      }) })
    ] }
  ]
};

const entorno = {
  name: 'Carro Sin Rollos · local',
  values: [
    { key: 'base_url', value: 'http://localhost:3000', enabled: true },
    { key: 'token', value: '', enabled: true },
    { key: 'wompi_secreto_eventos', value: 'solo-para-desarrollo-eventos', enabled: true }
  ]
};

writeFileSync(new URL('../postman/carro-sin-rollos.postman_collection.json', import.meta.url), JSON.stringify(coleccion, null, 2) + '\n');
writeFileSync(new URL('../postman/local.postman_environment.json', import.meta.url), JSON.stringify(entorno, null, 2) + '\n');
console.log('Colección y entorno generados en backend/postman/');
