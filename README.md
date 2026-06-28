# Anime Stream Magnet

Fork do [Anime Stream](../anime-stream) com **magnets por episódio** via índice 1337x. Herda todo o stack de streaming HLS, preferência de áudio e clientes web/Android/TV.

| | |
|---|---|
| **Versão** | 2.0.0-magnet |
| **Node** | ≥ 18 |
| **Base** | Anime Stream v1.1.4-cloud |
| **Documentação completa** | [../DOCUMENTACAO-ANIME-STREAM.md](../DOCUMENTACAO-ANIME-STREAM.md) |

---

## O que o fork adiciona

| Recurso | Base | Magnet |
|---------|:----:|:------:|
| Streaming HLS | ✅ | ✅ |
| Preferência legendado/dublado | ✅ | ✅ |
| Índice 1337x | — | ✅ |
| Seletor episódio: Online \| Magnet | — | ✅ |
| Cofre server-side (AES-256-GCM) | — | ✅ |
| Scripts Node (sem .ps1 obrigatório) | Parcial | ✅ |

Ao clicar em um episódio (anime com ID MAL), aparece:

- **▶ Assistir online** — streaming HLS como no projeto base
- **🧲 Abrir magnet** — busca torrent do episódio e abre no cliente torrent

---

## Início rápido

```powershell
cd anime-stream-magnet
npm install
npm start
```

Abra `http://localhost:3456`. **Nenhum arquivo `.ps1` é necessário.**

### Rede local

```powershell
npm run start:tv
```

### Nuvem

```powershell
npm run start:cloud
npm run deploy:cloud
```

---

## Arquitetura magnet

```
Usuário clica episódio N
        │
        ▼
Modal: Assistir online | Abrir magnet
        │
        ▼ (magnet)
POST /api/alt/open { malId, episode: N }
        │
        ▼
x1337.js (scrape índice)
  → torrent-sources.js (ranking + episódio)
  → source-vault.js (cofre AES, refs opacas)
  → resolveMagnet() (scrape página do torrent)
        │
        ▼
{ magnet: "magnet:?xt=..." } → cliente torrent
```

### Módulos novos

| Arquivo | Função |
|---------|--------|
| `services/x1337.js` | Scraping do índice (mirrors configuráveis) |
| `services/source-vault.js` | Cofre criptografado + tickets descartáveis |
| `services/torrent-sources.js` | Mascaramento, ranking, matching por episódio |
| `public/js/alt-sources.js` | Picker de episódio e abertura de magnet |

### Mascaramento (catálogo)

- **Títulos:** `Frieren` → `F█████n`
- **Tamanho:** `1.2 GB` → `~1.x GB`
- **Seeders:** valor exato → faixas (`10+`, `50+`, …)
- **Provider:** tag `x7f`

---

## API — magnets

| Método | Rota | Expõe magnet? |
|--------|------|:-------------:|
| GET | `/api/alt/catalog` | Não |
| GET | `/api/alt/episode?malId=&ep=` | Não |
| POST | `/api/alt/reserve` | Não (ticket opaco) |
| POST | `/api/alt/open` | **Sim** (escolha do usuário) |
| GET | `/client-config.js` | Config dinâmica para clientes |

### `POST /api/alt/open`

```json
{ "malId": 52991, "episode": 5 }
```

Resposta:

```json
{
  "ok": true,
  "magnet": "magnet:?xt=urn:btih:...",
  "label": "F█████n ...",
  "quality": "1080p",
  "provider": "x7f"
}
```

Todas as rotas de streaming do projeto base também estão disponíveis. Ver [documentação completa §6](../DOCUMENTACAO-ANIME-STREAM.md#6-referência-da-api).

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `ALT_SOURCES` | `true` | `false` desativa magnets |
| `X1337_MIRRORS` | `https://www.1377x.to` | Mirrors CSV |
| `VAULT_SECRET` | *(dev)* | Chave do cofre — **obrigatório em produção** |
| `CLOUD_MODE` | auto | Igual ao projeto base |
| `PUBLIC_URL` | — | URL pública para health e client-config |
| `CLOUD_URL` | — | Usado no build do APK |

Copie `.env.example` para `.env` e ajuste.

---

## Scripts npm (Node — cross-platform)

| Comando | Ação |
|---------|------|
| `npm start` | Servidor |
| `npm run start:tv` | Rede local (`scripts/start-lan.js`) |
| `npm run start:cloud` | Modo nuvem (`scripts/start-cloud.js`) |
| `npm run deploy:cloud` | Deploy Railway (`scripts/deploy-cloud.js`) |
| `npm run build:config` | Gera `build-config.js` do APK |
| `npm run build:apk` | Config + Gradle |
| `npm run dev` | Watch mode |

Scripts PowerShell legados (`deploy-cloud.ps1`, `start-tv.ps1`, etc.) existem no repositório mas **não são usados** pelo `package.json`.

---

## Clientes

| Plataforma | Magnet | Notas |
|------------|:------:|-------|
| Navegador (`public/`) | ✅ | Modal ao clicar episódio |
| Android (`android-app/`) | ✅ | Mesmo fluxo via WebView |
| Samsung TV | — | Apenas streaming (sem magnet) |

### APK

```powershell
npm run build:config
npm run build:apk
```

Com URL de nuvem:

```powershell
$env:CLOUD_URL="https://seu-app.railway.app"
npm run build:config
npm run build:apk
```

---

## Segurança

| Dado | Onde fica |
|------|-----------|
| URLs do índice 1337x | Apenas no servidor |
| Magnets no catálogo | Nunca — só refs opacas |
| Magnet na abertura | Retornado só em `/api/alt/open` quando o usuário escolhe |
| Cofre | AES-256-GCM; refs expiram em 2h; reinício limpa memória |
| Filtro NSFW | `BLOCK_RE` no scraper |

> Ofuscação dificulta engenharia reversa casual; não substitui controles legais.

---

## Deploy

| Plataforma | Detalhe |
|------------|---------|
| **GitHub + Render** | Repositório GitHub + Blueprint `render.yaml` (recomendado) |
| Render (hook) | `npm run deploy:render -- --hook=<RENDER_DEPLOY_HOOK_URL>` |
| Docker | Node 20 Alpine, porta 10000 |

1. Faça push para `github.com/neomaster/Anime-Stream`
2. Em [dashboard.render.com/blueprints](https://dashboard.render.com/blueprints), conecte o repositório
3. Após o deploy, atualize a URL: `npm run deploy:cloud -- --url=https://anime-stream-a8nb.onrender.com`

Health: `GET /api/health` → `altSources: true`, `altProvider: "x7f"`

---

## Limitações conhecidas

- **Nuvem:** datacenters podem ser bloqueados pelo índice 1337x — magnets podem falhar em Railway/Render
- **Episódio:** depende de nomes de torrent compatíveis com o título MAL
- **TV:** sem suporte a magnet (apenas streaming via PC na LAN)
- **Vault:** em memória — não persiste entre reinícios do servidor

---

## Documentação adicional

| Documento | Conteúdo |
|-----------|----------|
| [DOCUMENTACAO-ANIME-STREAM.md](../DOCUMENTACAO-ANIME-STREAM.md) | **Documentação completa** (base + fork) |
| [BUILD-LOG.md](../anime-stream/BUILD-LOG.md) | Log algorítmico do projeto base |
| [android-app/README.md](./android-app/README.md) | Build do APK |
| [.env.example](./.env.example) | Variáveis de ambiente |

---

## Origem

Baseado no **Anime Stream v1.1.4** — ver [anime-stream](../anime-stream) e [BUILD-LOG.md](../anime-stream/BUILD-LOG.md).

---

## Licença

Uso educacional/pessoal. O usuário é responsável pelo cumprimento das leis locais sobre conteúdo e torrents.