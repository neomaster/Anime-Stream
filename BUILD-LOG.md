# Build Log — Anime Stream Magnet v2.0.0

Registro técnico do fork **Anime Stream Magnet**, derivado do Anime Stream v1.1.4-cloud.

**Documentação completa:** [../DOCUMENTACAO-ANIME-STREAM.md](../DOCUMENTACAO-ANIME-STREAM.md)

---

## 1. Objetivo do fork

Adicionar fontes alternativas via índice 1337x com:

- Cofre server-side (refs opacas, magnets resolvidos sob demanda)
- Integração ao fluxo de episódios (não seção separada)
- Scripts Node cross-platform (sem dependência de `.ps1` para operação)
- Hospedagem na nuvem com `ALT_SOURCES=true`

---

## 2. Pipeline magnet

```
Jikan titles
  → buildSearchQueries() + queries por episódio
  → x1337.searchIndex() (mirrors com failover)
  → extractEpisodeNumber() + isBatchPack()
  → scoreRow() + titleSimilarity()
  → source-vault.storePayload({ href, magnet: null })
  → POST /api/alt/open → resolveMagnet() → cliente torrent
```

---

## 3. Módulos novos

| Arquivo | Responsabilidade |
|---------|------------------|
| `services/x1337.js` | Scraping índice, NSFW filter, fetch magnet |
| `services/source-vault.js` | AES-256-GCM, refs 2h, tickets 90s |
| `services/torrent-sources.js` | Catálogo ofuscado, episódio, openForEpisode |
| `public/js/alt-sources.js` | Picker + launchMagnet |
| `scripts/*.js` | start-lan, deploy-cloud, build-apk, write-build-config |

---

## 4. UX — seletor de episódio

- Condição: `altSourcesEnabled` (health) + `malId` presente
- Modal: **Assistir online** | **Abrir magnet** | Cancelar
- Android: mesmo fluxo em `android-app/www/`
- Samsung TV: sem magnet (apenas streaming herdado)

---

## 5. API adicionada

| Rota | Função |
|------|--------|
| `GET /api/alt/catalog` | Catálogo mascarado |
| `GET /api/alt/episode` | Catálogo por episódio |
| `POST /api/alt/reserve` | Ticket opaco (legado) |
| `POST /api/alt/open` | Retorna magnet ao usuário |
| `GET /client-config.js` | BuildConfig dinâmico |

---

## 6. Deploy

- `render.yaml`: `ALT_SOURCES=true`
- `scripts/deploy-cloud.js`: Railway via Node
- `scripts/write-build-config.js`: APK sem PowerShell

---

## 7. Projeto base

Matching, streaming, legendas e proxy: ver [../anime-stream/BUILD-LOG.md](../anime-stream/BUILD-LOG.md).

---

*Gerado em 2026-06-21 — Anime Stream Magnet v2.0.0-magnet*