# Castelo isométrico

## GitHub Pages

1. Repositório no GitHub → **Settings** → **Pages**
2. **Build and deployment** → **Source**: **GitHub Actions** (não “Deploy from branch”).
3. Faz push para `main` (ou `master`). O workflow **Deploy GitHub Pages** publica o site.
4. URL típica: `https://SEU_USER.github.io/NOME_DO_REPO/`
5. Modo Twitch/start: `https://SEU_USER.github.io/NOME_DO_REPO/start/` ou `…/start.html` (redireciona).

Ficheiro **`.nojekyll`** evita o Jekyll a ignorar paths com `_`.

### Twitch (bridge)

O jogo no Pages **não** pode usar o token Twitch no browser. Corre `npm run twitch-bridge` na tua máquina (com `.env`) e, para testar com o site online, expõe o WebSocket (ex.: túnel) e define no jogo:

`window.TWITCH_BRIDGE_WS = 'wss://…';` antes de carregar `twitch-game.js`, ou usa o build local com o bridge.

### Desenvolvimento local

Servir a pasta do projeto com qualquer servidor estático (ex.: `npx serve .`) para `fetch` e paths relativos funcionarem.
