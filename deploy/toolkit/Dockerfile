# Immagine del toolkit Docs Italia: build dei documenti (MyST e RST), PDF,
# EPUB validato, studio. Usata in CI, dal worker dell'istanza e dal
# compose.yml nei repository dei documenti.
#
#   docker build -f deploy/toolkit/Dockerfile -t docs-italia-toolkit:dev .
#   docker run --rm -v "$PWD:/documento" docs-italia-toolkit:dev build
FROM oven/bun:1.4.4-debian

ARG EPUBCHECK_VERSION=5.2.1

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium fonts-dejavu-core \
      python3 python3-venv \
      default-jre-headless \
      git curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# epubcheck, il validatore ufficiale degli EPUB
RUN curl -fsSL -o /tmp/epubcheck.zip "https://github.com/w3c/epubcheck/releases/download/v${EPUBCHECK_VERSION}/epubcheck-${EPUBCHECK_VERSION}.zip" \
 && unzip -q /tmp/epubcheck.zip -d /opt \
 && mv "/opt/epubcheck-${EPUBCHECK_VERSION}" /opt/epubcheck \
 && rm /tmp/epubcheck.zip \
 && printf '#!/bin/sh\nexec java -jar /opt/epubcheck/epubcheck.jar "$@"\n' > /usr/local/bin/epubcheck \
 && chmod +x /usr/local/bin/epubcheck

WORKDIR /opt/docs-italia
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps ./apps
COPY tests ./tests

# Python con Sphinx e l'estensione di Docs Italia, per i documenti RST
RUN python3 -m venv /opt/docs-italia/packages/sphinx/.venv \
 && /opt/docs-italia/packages/sphinx/.venv/bin/pip install --no-cache-dir ./packages/sphinx

RUN bun install --frozen-lockfile \
 && (cd apps/editor && bun run build) \
 && (cd apps/dashboard && bun run build)

ENV DOCS_ITALIA_CHROME=/usr/bin/chromium \
    DOCS_ITALIA_HOST=0.0.0.0 \
    DOCS_ITALIA_PYTHON=/opt/docs-italia/packages/sphinx/.venv/bin/python

WORKDIR /documento
EXPOSE 4321 4322
ENTRYPOINT ["bun", "/opt/docs-italia/packages/toolkit/bin/docs-italia.ts"]
CMD ["help"]
