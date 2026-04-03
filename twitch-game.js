// twitch-game.js — fila de spawns; origem: bridge local OU Twitch IRC no browser (twitch-irc-browser.js)
(function () {
    const DEFAULT_BRIDGE_WS = 'ws://127.0.0.1:8765';
    const MIN_GAP_MS = 900;
    const MAX_QUEUE = 80;

    function bridgeUrl() {
        return window.TWITCH_BRIDGE_WS || DEFAULT_BRIDGE_WS;
    }

    function isLocalDevHost() {
        try {
            const h = location.hostname;
            return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
        } catch (e) {
            return false;
        }
    }

    /** Bridge Node só em dev local, salvo override explícito. */
    function shouldTryLocalBridge() {
        if (window.TWITCH_FORCE_LOCAL_BRIDGE === true) return true;
        if (typeof window.TWITCH_BRIDGE_WS === 'string' && window.TWITCH_BRIDGE_WS.length > 0) return true;
        return isLocalDevHost();
    }

    function ircDirectReady() {
        const c = window.TWITCH_IRC_CONFIG;
        return Boolean(
            c && c.enabled
            && String(c.token || '').trim()
            && String(c.nick || '').trim()
            && String(c.channel || '').trim()
        );
    }

    function safeDisplayName(name) {
        const s = String(name || 'Viewer').trim().slice(0, 28);
        return s || 'Viewer';
    }

    function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }

    const queue = [];
    let draining = false;

    async function drainQueue() {
        if (draining) return;
        draining = true;
        while (queue.length > 0) {
            const job = queue.shift();
            try {
                await job();
            } catch (e) {
                console.warn('[twitch-game]', e);
            }
            await sleep(MIN_GAP_MS);
        }
        draining = false;
    }

    function enqueue(job) {
        while (queue.length >= MAX_QUEUE) queue.shift();
        queue.push(job);
        drainQueue();
    }

    function spawnWarriorNamed(displayName) {
        const sm = window.startMode;
        const pos = sm && typeof sm.getNearCastlePosition === 'function'
            ? sm.getNearCastlePosition(3)
            : { col: 10, row: 10 };
        const name = safeDisplayName(displayName);
        return window.add_element('warrior', name, pos).catch(() => {});
    }

    function spawnEntity(typeKey) {
        const sm = window.startMode;
        const pos = sm && typeof sm.getNearCastlePosition === 'function'
            ? sm.getNearCastlePosition(4)
            : { col: 10, row: 10 };
        return window.add_element(typeKey, pos).catch(() => {});
    }

    function handleMessage(data) {
        if (!data || typeof data !== 'object') return;

        if (data.type === 'first_chat') {
            enqueue(() => spawnWarriorNamed(data.displayName));
            return;
        }

        if (data.type === 'command') {
            const cmd = String(data.command || '').toLowerCase().replace(/-/g, '_');
            if (cmd === 'warrior') {
                enqueue(() => spawnWarriorNamed(data.displayName));
                return;
            }
            const allowed = new Set([
                'turret_heal',
                'turret_ice',
                'turret_archer',
                'turret_bomb',
                'turret_fire'
            ]);
            if (allowed.has(cmd)) {
                enqueue(() => spawnEntity(cmd));
            }
        }
    }

    let bridgeSocket = null;
    let reconnectTimer = null;
    let attempt = 0;

    function connectLocalBridge() {
        if (!window.startMode || !window.startMode.isUrlActive()) return;
        if (typeof window.add_element !== 'function') return;
        if (!shouldTryLocalBridge()) return;

        try {
            bridgeSocket = new WebSocket(bridgeUrl());
        } catch (e) {
            scheduleBridgeReconnect();
            return;
        }

        bridgeSocket.addEventListener('open', () => {
            attempt = 0;
            console.log('[twitch-game] Bridge local:', bridgeUrl());
        });

        bridgeSocket.addEventListener('message', (ev) => {
            try {
                const data = JSON.parse(ev.data);
                if (data.type === 'hello') return;
                handleMessage(data);
            } catch (err) {
                /* ignore */
            }
        });

        bridgeSocket.addEventListener('close', () => {
            bridgeSocket = null;
            scheduleBridgeReconnect();
        });

        bridgeSocket.addEventListener('error', () => {
            if (bridgeSocket) {
                try {
                    bridgeSocket.close();
                } catch (e) { /* */ }
            }
        });
    }

    function scheduleBridgeReconnect() {
        if (!window.startMode || !window.startMode.isUrlActive()) return;
        if (!shouldTryLocalBridge()) return;
        if (ircDirectReady()) return;
        if (reconnectTimer) return;
        attempt = Math.min(attempt + 1, 8);
        const delay = Math.min(30000, 1500 * attempt);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connectLocalBridge();
        }, delay);
    }

    window.twitchGameIntegration = {
        ingestTwitchEvent: handleMessage,

        startIfNeeded() {
            if (!window.startMode || !window.startMode.isUrlActive()) return;
            if (typeof window.add_element !== 'function') return;

            if (ircDirectReady()) {
                if (window.twitchIrcBrowser && typeof window.twitchIrcBrowser.connect === 'function') {
                    window.twitchIrcBrowser.connect();
                }
                return;
            }

            if (shouldTryLocalBridge()) {
                connectLocalBridge();
            }
        },

        getQueueLength() {
            return queue.length;
        }
    };
})();
