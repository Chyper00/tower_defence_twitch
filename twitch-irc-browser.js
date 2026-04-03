// twitch-irc-browser.js — liga a wss://irc-ws.chat.twitch.tv no browser (usa twitch-config.js)
(function () {
    const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
    const COMMAND_ALIASES = {
        '!turret_heal': 'turret_heal',
        '!turret_ice': 'turret_ice',
        '!turret_archer': 'turret_archer',
        '!turret_bomb': 'turret_bomb',
        '!turret_fire': 'turret_fire',
        '!warrior': 'warrior'
    };

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

    let ws = null;
    let reconnectTimer = null;
    let attempt = 0;
    const welcomedUserIds = new Set();

    function cfg() {
        return window.TWITCH_IRC_CONFIG || {};
    }

    function normalizeToken(t) {
        const s = String(t || '').trim();
        if (!s) return '';
        return s.startsWith('oauth:') ? s : `oauth:${s}`;
    }

    function ingest(priv) {
        const channel = cfg().channel.replace(/^#/, '').toLowerCase();
        if (!priv || priv.channel !== channel) return;

        const ingestFn = window.twitchGameIntegration && window.twitchGameIntegration.ingestTwitchEvent;
        if (typeof ingestFn !== 'function') return;

        const userId = priv.tags['user-id'] || priv.login;
        const displayName = (priv.tags['display-name'] || priv.login || 'Viewer').trim();

        const cmd = parseChatCommand(priv.body);
        const isNewChatter = Boolean(userId && !welcomedUserIds.has(userId));
        if (isNewChatter) welcomedUserIds.add(userId);

        if (cmd) {
            ingestFn({
                type: 'command',
                command: cmd,
                displayName,
                userId,
                raw: priv.body.slice(0, 200)
            });
        } else if (isNewChatter) {
            ingestFn({
                type: 'first_chat',
                displayName,
                userId
            });
        }
    }

    function onLine(line) {
        const one = line.trimEnd();
        if (one.startsWith('PING')) {
            const tail = one.startsWith('PING ') ? one.slice(5) : '';
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(tail ? `PONG ${tail}` : 'PONG :tmi.twitch.tv');
            }
            return;
        }
        for (const part of one.split('\r\n')) {
            if (!part) continue;
            const priv = parsePrivmsg(part);
            if (priv) ingest(priv);
        }
    }

    function scheduleReconnect() {
        if (!window.startMode || !window.startMode.isUrlActive()) return;
        if (reconnectTimer) return;
        const c = cfg();
        if (!c.enabled || !c.token) return;
        attempt = Math.min(attempt + 1, 10);
        const delay = Math.min(45000, 2000 * attempt);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, delay);
    }

    function connect() {
        if (!window.startMode || !window.startMode.isUrlActive()) return;

        const c = cfg();
        if (!c.enabled) return;
        const token = normalizeToken(c.token);
        const nick = String(c.nick || '').toLowerCase().trim();
        const channel = String(c.channel || '').replace(/^#/, '').toLowerCase().trim();
        if (!token || !nick || !channel) {
            console.warn('[twitch-irc] TWITCH_IRC_CONFIG incompleto (token, nick, channel).');
            return;
        }

        if (ws) {
            try {
                ws.close();
            } catch (e) { /* */ }
            ws = null;
        }

        try {
            ws = new WebSocket(IRC_URL);
        } catch (e) {
            console.warn('[twitch-irc]', e);
            scheduleReconnect();
            return;
        }

        ws.addEventListener('open', () => {
            attempt = 0;
            console.log('[twitch-irc] Ligado à Twitch; canal #' + channel);
            ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
            ws.send(`PASS ${token}`);
            ws.send(`NICK ${nick}`);
            ws.send(`JOIN #${channel}`);
        });

        ws.addEventListener('message', (ev) => {
            onLine(String(ev.data));
        });

        ws.addEventListener('close', () => {
            ws = null;
            scheduleReconnect();
        });

        ws.addEventListener('error', () => {
            try {
                ws && ws.close();
            } catch (e) { /* */ }
        });
    }

    window.twitchIrcBrowser = {
        connect,
        disconnect() {
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            if (ws) {
                try {
                    ws.close();
                } catch (e) { /* */ }
                ws = null;
            }
            welcomedUserIds.clear();
        }
    };
})();
