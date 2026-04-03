# Castelo isométrico

## GitHub Pages

1. Repositório no GitHub → **Settings** → **Pages**
2. **Build and deployment** → **Source**: **GitHub Actions** (não “Deploy from branch”).
3. Faz push para `main` (ou `master`). O workflow **Deploy GitHub Pages** publica o site.
4. URL típica: `https://SEU_USER.github.io/NOME_DO_REPO/`
5. Modo Twitch/start: `https://SEU_USER.github.io/NOME_DO_REPO/start/` ou `…/start.html` (redireciona).

Ficheiro **`.nojekyll`** evita o Jekyll a ignorar paths com `_`.

### Twitch no GitHub Pages (IRC no browser)

No modo **`/start`**, o jogo pode ligar **diretamente** a `wss://irc-ws.chat.twitch.tv` usando `twitch-irc-browser.js` e `twitch-config.js`.

**Aviso de segurança:** o token OAuth acaba **dentro do ficheiro `twitch-config.js` publicado** — qualquer pessoa pode abrir `https://…/twitch-config.js` e ver o token. Usa uma **conta bot** só para isto, scope mínimo (`chat:read`), e **renova o token** se vazar.

**Configuração no GitHub:**

1. **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
2. Cria três secrets (nomes exatos):
   - `TWITCH_OAUTH_TOKEN` — access token (com ou sem prefixo `oauth:`)
   - `TWITCH_BOT_USERNAME` — login da conta em **minúsculas**
   - `TWITCH_CHANNEL` — nome do canal **sem** `#`, minúsculas

No deploy, o workflow **substitui** `twitch-config.js` no artefacto com `enabled: true`. Se faltar algum secret, mantém-se o `twitch-config.js` do repo (**IRC desligado**).

### Bridge local (opcional)

`npm run twitch-bridge` + `.env` — útil em **localhost**: o jogo tenta `ws://127.0.0.1:8765` só em `localhost` / `127.0.0.1`, ou se definires `window.TWITCH_BRIDGE_WS`. No **github.io** não tenta o bridge por defeito; usa IRC se `TWITCH_IRC_CONFIG.enabled`.

### Desenvolvimento local

Servir a pasta com um servidor estático (ex.: `npx serve .`). Para testar IRC no browser sem Actions, edita **`twitch-config.js`** com `enabled: true` e dados reais — **não commits** o token num repo público.
