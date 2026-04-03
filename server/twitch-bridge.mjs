/**
 * Ponte Twitch IRC → WebSocket local para o jogo (modo /start).
 *
 * 1. npm install
 * 2. cp .env.example .env  e preenche
 * 3. npm run twitch-bridge
 * 4. Abre o jogo em /start com o bridge a correr na mesma máquina
 *
 * Token: ver comentários em .env.example (twitchtokengenerator.com ou twitchapps.com/tmi).
 */

import 'dotenv/config';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';

const CHANNEL = String(process.env.TWITCH_CHANNEL || '')
    .replace(/^#/, '')
    .toLowerCase()
    .trim();
const NICK = String(process.env.TWITCH_BOT_USERNAME || '').toLowerCase().trim();
let TOKEN = String(process.env.TWITCH_OAUTH_TOKEN || '').trim();
if (TOKEN && !TOKEN.startsWith('oauth:')) {
    TOKEN = `oauth:${TOKEN}`;
}
const BRIDGE_HOST = process.env.TWITCH_BRIDGE_HOST || '127.0.0.1';
const BRIDGE_PORT = Number(process.env.TWITCH_BRIDGE_PORT) || 8765;

const COMMAND_ALIASES = {
    '!turret_heal': 'turret_heal',
    '!turret_ice': 'turret_ice',
    '!turret_archer': 'turret_archer',
    '!turret_bomb': 'turret_bomb',
    '!turret_fire': 'turret_fire',
    '!warrior': 'warrior'
};

if (!CHANNEL || !NICK || !TOKEN) {
    console.error('[twitch-bridge] Falta TWITCH_CHANNEL, TWITCH_BOT_USERNAME ou TWITCH_OAUTH_TOKEN no .env');
    process.exit(1);
}

function parseTags(tagString) {
    const tags = {};
    if (!tagString) return tags;
    for (const part of tagString.split(';')) {
        const i = part.indexOf('=');
        if (i === -1) continue;
        tags[part.slice(0, i)] = part.slice(i + 1);
    }
    return tags;
}

function parsePrivmsg(line) {
    if (!line.includes(' PRIVMSG ')) return null;
    let tagString = '';
    let rest = line;
    if (line.startsWith('@')) {
        const split = line.indexOf(' :');
        if (split === -1) return null;
        tagString = line.slice(1, split);
        rest = line.slice(split + 2);
    }
    const tags = parseTags(tagString);
    const m = rest.match(/^(\w+)!\S+ PRIVMSG #(\w+) :([\s\S]*)$/);
    if (!m) return null;
    return { tags, login: m[1], channel: m[2].toLowerCase(), body: m[3].trim() };
}

function parseChatCommand(body) {
    const first = body.split(/\s+/)[0].toLowerCase();
    return COMMAND_ALIASES[first] || null;
}

const clients = new Set();
const wss = new WebSocketServer({ host: BRIDGE_HOST, port: BRIDGE_PORT });

wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'hello', message: 'bridge_ok' }));
    ws.on('close', () => clients.delete(ws));
});

function broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const c of clients) {
        if (c.readyState === WebSocket.OPEN) c.send(s);
    }
}

const welcomedUserIds = new Set();

const irc = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

irc.on('open', () => {
    console.log('[twitch-bridge] IRC ligado, a entrar no canal…');
    irc.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    irc.send(`PASS ${TOKEN}`);
    irc.send(`NICK ${NICK}`);
    irc.send(`JOIN #${CHANNEL}`);
});

irc.on('message', (buf) => {
    const line = buf.toString().trimEnd();
    const lines = line.split('\r\n');
    for (const one of lines) {
        if (one.startsWith('PING')) {
            const tail = one.startsWith('PING ') ? one.slice(5) : '';
            irc.send(tail ? `PONG ${tail}` : 'PONG :tmi.twitch.tv');
            continue;
        }
        const priv = parsePrivmsg(one);
        if (!priv || priv.channel !== CHANNEL) continue;

        const userId = priv.tags['user-id'] || priv.login;
        const displayName = (priv.tags['display-name'] || priv.login || 'Viewer').trim();

        const cmd = parseChatCommand(priv.body);
        const isNewChatter = Boolean(userId && !welcomedUserIds.has(userId));
        if (isNewChatter) welcomedUserIds.add(userId);

        if (cmd) {
            broadcast({
                type: 'command',
                command: cmd,
                displayName,
                userId,
                raw: priv.body.slice(0, 200)
            });
        } else if (isNewChatter) {
            broadcast({
                type: 'first_chat',
                displayName,
                userId
            });
        }
    }
});

irc.on('error', (err) => {
    console.error('[twitch-bridge] Erro IRC:', err.message);
});

irc.on('close', () => {
    console.warn('[twitch-bridge] IRC desligado. Reinicia o bridge.');
    process.exitCode = 1;
});

console.log(`[twitch-bridge] Jogo: ws://${BRIDGE_HOST}:${BRIDGE_PORT}  |  Twitch: #${CHANNEL} como ${NICK}`);
