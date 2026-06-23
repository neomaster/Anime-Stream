# Anime Stream — Android APK

Cliente Android que se conecta ao servidor **Anime Stream** no PC (mesma rede Wi-Fi).

## Arquitetura

```
Celular/TV Box (APK)  ──HTTP──►  PC (Node.js :3456)  ──►  GoAnime / Jikan
```

## Compilar o APK

### Requisitos
- Java 17+ (JDK)
- Conexao com internet (primeira compilacao baixa SDK ~500 MB)

### Build automatico

```powershell
cd android-app
.\build-apk.ps1
```

APK gerado em: `android-app/dist/AnimeStream.apk`

### Via npm (raiz do projeto)

```powershell
npm run build:apk
```

## Instalar no celular

1. No PC: `npm run start:tv`
2. Transfira `AnimeStream.apk` para o celular (USB, Drive, etc.)
3. Ative **Fontes desconhecidas** nas configuracoes
4. Instale o APK
5. Abra o app e informe o IP do PC (ex: `192.168.1.2:3456`)

### Via ADB (opcional)

```powershell
adb install -r dist\AnimeStream.apk
```

## Estrutura

```
android-app/
├── www/              # Cliente web (WebView)
├── app/              # Projeto Android Gradle
├── build-apk.ps1     # Script de compilacao
└── dist/             # APK gerado
```

## Solucao de problemas

| Problema | Solucao |
|----------|---------|
| Build falha sem SDK | Execute `build-apk.ps1` novamente (baixa SDK automaticamente) |
| App nao conecta | PC e celular na mesma rede; firewall liberado (`npm run start:tv`) |
| Video nao carrega | Use IP com porta: `192.168.1.2:3456` |
| HTTP bloqueado | App ja permite cleartext para rede local |