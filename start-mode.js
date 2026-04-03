// start-mode.js — spawns caóticos quando a URL tem o segmento /start (ex.: /start ou /jogo/start)
(function () {
    const SLIME_TYPES = [
        'enemy_slime',
        'enemy_slime-blue',
        'enemy_slime-fire',
        'enemy_orc'
    ];

    const TURRET_TYPES = [
        'turret_bomb',
        'turret_ice',
        'turret_fire',
        'turret_heal'
    ];

    function rand(max) {
        return Math.floor(Math.random() * max);
    }

    function clampCell(col, row) {
        const g = window.grid;
        if (!g) return { col: 0, row: 0 };
        const maxC = g.GRID_COLS - 1;
        const maxR = g.GRID_ROWS - 1;
        return {
            col: Math.max(0, Math.min(maxC, col)),
            row: Math.max(0, Math.min(maxR, row))
        };
    }

    function getRandomEdgePosition() {
        const maxCol = window.grid.GRID_COLS - 1;
        const maxRow = window.grid.GRID_ROWS - 1;
        const side = rand(4);
        let col;
        let row;
        switch (side) {
            case 0:
                col = rand(maxCol + 1);
                row = 0;
                break;
            case 1:
                col = rand(maxCol + 1);
                row = maxRow;
                break;
            case 2:
                col = 0;
                row = rand(maxRow + 1);
                break;
            default:
                col = maxCol;
                row = rand(maxRow + 1);
                break;
        }
        return clampCell(col, row);
    }

    function getNearCastlePosition(range) {
        const r = Number(range) || 5;
        const centerCol = Math.floor(window.grid.GRID_COLS / 2);
        const centerRow = Math.floor(window.grid.GRID_ROWS / 2);
        const col = centerCol + rand(r * 2) - r;
        const row = centerRow + rand(r * 2) - r;
        return clampCell(col, row);
    }

    function spawnEnemy() {
        const slime = SLIME_TYPES[rand(SLIME_TYPES.length)];
        const pos = getRandomEdgePosition();
        window.add_element(slime, pos).catch(() => {});
    }

    function spawnTurret() {
        const turret = TURRET_TYPES[rand(TURRET_TYPES.length)];
        const pos = getNearCastlePosition(4);
        window.add_element(turret, pos).catch(() => {});
    }

    function spawnWarrior() {
        const pos = getNearCastlePosition(3);
        window.add_element('warrior', pos).catch(() => {});
    }

    function enemyLoop() {
        spawnEnemy();
        const next = 300 + Math.random() * 1200;
        setTimeout(enemyLoop, next);
    }

    function turretLoop() {
        if (Math.random() < 0.3) {
            spawnTurret();
        }
        const next = 5000 + Math.random() * 5000;
        setTimeout(turretLoop, next);
    }

    function warriorLoop() {
        if (Math.random() < 0.4) {
            spawnWarrior();
        }
        const next = 8000 + Math.random() * 7000;
        setTimeout(warriorLoop, next);
    }

    function pathnameHasStartSegment() {
        const raw = (window.location.pathname || '').replace(/\/+$/, '');
        if (/(^|\/)start$/.test(raw)) {
            return true;
        }
        const q = new URLSearchParams(window.location.search || '');
        const v = q.get('start');
        if (v === null) return false;
        return v === '' || v === '1' || v === 'true';
    }

    let running = false;

    window.startMode = {
        isUrlActive() {
            return pathnameHasStartSegment();
        },
        run() {
            if (running) return;
            running = true;
            enemyLoop();
            turretLoop();
            warriorLoop();
        },
        runIfPathMatches() {
            if (!this.isUrlActive()) return;
            if (!window.grid || typeof window.add_element !== 'function') return;
            this.run();
        },
        getNearCastlePosition(range) {
            return getNearCastlePosition(range);
        }
    };
})();
