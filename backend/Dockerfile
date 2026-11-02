# Imagen oficial de Playwright: trae Chromium y sus dependencias del sistema.
# La versión debe coincidir con "playwright" en package.json.
FROM mcr.microsoft.com/playwright:v1.64.1-noble AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.64.1-noble
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY assets ./assets
COPY fixtures ./fixtures
# Carpeta de PDFs del almacenamiento local, escribible por el usuario sin privilegios.
RUN mkdir -p /app/data/pdfs && chown -R pwuser:pwuser /app/data
USER pwuser
EXPOSE 3000
CMD ["node", "dist/server.js"]
