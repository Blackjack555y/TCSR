import { chromium, type Browser } from 'playwright';
import { logger } from '../logger.js';

/**
 * Genera PDFs a partir de HTML con Chromium. Mantiene un solo navegador abierto
 * entre informes (arrancarlo cuesta 1–2 s) y abre una página nueva por informe.
 */
export class RenderizadorPdf {
  private navegador: Promise<Browser> | null = null;
  private cerrando = false;

  constructor(private readonly chromePath?: string) {}

  private obtenerNavegador(): Promise<Browser> {
    this.navegador ??= chromium
      .launch({ executablePath: this.chromePath || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
      .then((b) => {
        b.on('disconnected', () => {
          if (!this.cerrando) logger.warn('pdf: el navegador se cerró, se reabrirá en el próximo informe');
          this.navegador = null;
        });
        return b;
      })
      .catch((err) => {
        this.navegador = null;
        throw err;
      });
    return this.navegador;
  }

  async renderizar(html: string): Promise<Buffer> {
    const navegador = await this.obtenerNavegador();
    const contexto = await navegador.newContext();
    try {
      const pagina = await contexto.newPage();
      // El HTML no trae scripts ni carga nada externo: bloquear la red evita sorpresas.
      await pagina.route('**/*', (r) => r.abort());
      await pagina.setContent(html, { waitUntil: 'load' });
      await pagina.evaluate(() => document.fonts.ready);
      await pagina.emulateMedia({ media: 'print' });
      return await pagina.pdf({ preferCSSPageSize: true, printBackground: true });
    } finally {
      await contexto.close();
    }
  }

  async cerrar(): Promise<void> {
    if (!this.navegador) return;
    this.cerrando = true;
    const b = await this.navegador.catch(() => null);
    this.navegador = null;
    await b?.close();
    this.cerrando = false;
  }
}
