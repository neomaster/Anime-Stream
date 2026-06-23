# Anime Stream — Samsung Tizen TV

App nativo para Samsung Smart TV (Tizen) que se conecta ao servidor **Anime Stream** rodando no seu PC na rede local.

## Arquitetura

```
Samsung TV (app Tizen)  ──HTTP──►  PC (Node.js :3456)  ──►  GoAnime / AnimeFire / Jikan
```

O app na TV **não** substitui o servidor — ele é o cliente. O PC continua sendo o motor de streaming.

## Pré-requisitos

### No PC
- Node.js instalado
- GoAnime em `C:\Program Files\GoAnime`
- Servidor na rede local:

```powershell
cd C:\Users\jneom\anime-stream
npm run start:tv
```

Anote o IP exibido (ex: `192.168.1.2:3456`).

### Na Samsung TV
- Modo desenvolvedor ativado
- TV e PC na **mesma rede Wi-Fi**
- [Tizen Studio](https://developer.samsung.com/smarttv/develop/getting-started/quick-start-guide.html) (para instalar o app)

## Ativar modo desenvolvedor na TV

1. Abra o app **Samsung TV** no celular
2. Dispositivos → sua TV → **Desenvolvedor de apps**
3. Ative **Modo desenvolvedor** e anote o IP da TV
4. Na TV: **Apps** → digite `12345` no controle → confirme

## Instalação do app

### Opção A — Tizen Studio (recomendado)

1. Abra **Tizen Studio** → File → Import → Tizen → **Web Project**
2. Selecione a pasta `samsung-tv`
3. Crie um certificado: Tools → Certificate Manager → Samsung TV
4. Clique com o botão direito no projeto → **Run As** → **Tizen Web Application**
5. Selecione sua TV na lista de dispositivos

### Opção B — Linha de comando

```powershell
cd samsung-tv
.\generate-icon.ps1
.\build-wgt.ps1 -ZipOnly

# Com Tizen CLI e certificado:
.\build-wgt.ps1 -CertProfile "SEU_PERFIL_CERTIFICADO"

# Instalar na TV (substitua o IP):
.\install-tv.ps1 -TvIp 192.168.1.50
```

## Primeiro uso na TV

1. Abra **Anime Stream** no menu de apps
2. Na tela de configuração, digite o IP do PC: `192.168.1.2:3456`
3. Pressione **Conectar**
4. Navegue com as **setas** do controle, **OK** para selecionar, **Voltar** para retornar

### Controles durante reprodução

| Tecla | Ação |
|-------|------|
| Play/Pause | Reproduzir / Pausar |
| Rewind | Voltar 10s |
| Fast Forward | Avançar 10s |
| Voltar | Fechar player / Voltar tela |

## Estrutura do projeto

```
samsung-tv/
├── config.xml      # Manifest Tizen
├── index.html      # UI otimizada para 1080p
├── icon.png        # Ícone 117×117
├── css/tv.css      # Estilos TV + foco remoto
├── js/
│   ├── config.js   # IP do servidor (persistido)
│   ├── api.js      # Cliente HTTP para o PC
│   ├── remote.js   # Navegação por controle
│   ├── player.js   # Player de vídeo
│   └── app.js      # Lógica principal
├── build-wgt.ps1   # Empacota .wgt
└── install-tv.ps1  # Instala via sdb
```

## Solução de problemas

| Problema | Solução |
|----------|---------|
| "Servidor não configurado" | Configure o IP na tela inicial |
| "Falha na conexão" | Verifique se `npm run start:tv` está rodando e o firewall liberou a porta 3456 |
| Vídeo não carrega | PC e TV devem estar na mesma rede; teste `http://IP:3456/api/health` no navegador da TV |
| App não instala | Confirme modo desenvolvedor e certificado Samsung válido |
| Legendas não aparecem | Selecione o idioma em **Legenda** abaixo do player |

## Alternativa sem instalar app

Abra o navegador da TV e acesse diretamente:

```
http://192.168.1.2:3456
```

O app Tizen oferece melhor navegação por controle remoto e tela dedicada.