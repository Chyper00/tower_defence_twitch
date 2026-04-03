/**
 * Twitch IRC no browser (GitHub Pages).
 * - Repositório público: NÃO coloques token real aqui.
 * - Deploy: define Secrets TWITCH_OAUTH_TOKEN, TWITCH_BOT_USERNAME, TWITCH_CHANNEL
 *   → o workflow gera este ficheiro no build (substitui no artefacto apenas).
 * - Local: podes editar com enabled:true (não commits o token) ou usar npm run twitch-bridge.
 */
window.TWITCH_IRC_CONFIG = {
    enabled: false,
    token: '',
    nick: '',
    channel: ''
};
