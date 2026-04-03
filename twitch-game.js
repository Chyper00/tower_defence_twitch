// twitch-game.js — liga ao bridge local (npm run twitch-bridge) no modo /start
(function () {
    const DEFAULT_WS = 'ws://127.0.0.1:8765';
    const MIN_GAP_MS = 900;
    const MAX_QUEUE = 80;

    function bridgeUrl() {
        return window.TWITCH_BRIDGE_WS || DEFAULT_WS;
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

    let socket = null;
    let reconnectTimer = null;
    let attempt = 0;

    function connect() {
        if (!window.startMode || !window.startMode.isUrlActive()) return;
        if (typeof window.add_element !== 'function') return;

        try {
            socket = new WebSocket(bridgeUrl());
        } catch (e) {
            scheduleReconnect();
            return;
        }

        socket.addEventListener('open', () => {
            attempt = 0;
            console.log('[twitch-game] Ligado ao bridge:', bridgeUrl());
        });

        socket.addEventListener('message', (ev) => {
            try {
                const data = JSON.parse(ev.data);
                handleMessage(data);
            } catch (err) {
                /* ignore */
            }
        });

        socket.addEventListener('close', () => {
            socket = null;
            scheduleReconnect();
        });

        socket.addEventListener('error', () => {
            if (socket) {
                try {
                    socket.close();
                } catch (e) { /* */ }
            }
        });
    }

    function scheduleReconnect() {
        if (!window.startMode || !window.startMode.isUrlActive()) return;
        if (reconnectTimer) return;
        attempt = Math.min(attempt + 1, 8);
        const delay = Math.min(30000, 1500 * attempt);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, delay);
    }

    window.twitchGameIntegration = {
        startIfNeeded() {
            if (!window.startMode || !window.startMode.isUrlActive()) return;
            connect();
        },
        getQueueLength() {
            return queue.length;
        }
    };
})();
