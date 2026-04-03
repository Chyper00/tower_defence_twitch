// game.js
window.gameState = {
    castleHealth: 100,
    maxHealth: 100,
    level: 1
};

window.alterarVida = function(delta) {
    let novaVida = gameState.castleHealth + delta;
    novaVida = Math.min(gameState.maxHealth, Math.max(0, novaVida));
    gameState.castleHealth = novaVida;

    if (window.hud && typeof window.hud.atualizarVida === 'function') {
        window.hud.atualizarVida(novaVida, gameState.maxHealth);
    }

    if (novaVida <= 0 && window.castle && typeof window.castle.destruir === 'function') {
        window.castle.destruir();
    } else if (window.castle && typeof window.castle.aplicarDanoVisual === 'function') {
        window.castle.aplicarDanoVisual(delta < 0);
    }
    return novaVida;
};

class MainScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MainScene' });
    }

    preload() {
        this.load.image('background', 'assets/bg-6.png');
        this.load.json('castleConfig', 'castle.json');
        this.load.json('levelConfig', 'level-1.json');

        let loadingText = this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2, '🏰 Carregando...', {
            fontSize: '26px',
            fill: '#f7e5b3',
            backgroundColor: '#1a3a1acc',
            padding: { x: 18, y: 10 },
            borderRadius: 40
        }).setOrigin(0.5);
        this.load.on('complete', () => loadingText.destroy());
    }

    create() {
        window.currentScene = this;

        const bg = this.add.image(this.cameras.main.width/2, this.cameras.main.height/2, 'background');
        bg.setDepth(-3);

        window.grid.inicializar(this, this.cameras.main.width, this.cameras.main.height);

        const castleConfig = this.cache.json.get('castleConfig') || {};
        const levelConfig = this.cache.json.get('levelConfig') || { elements: [] };
        gameState.castleHealth = castleConfig.stats?.initialHealth ?? 100;
        gameState.maxHealth = castleConfig.stats?.maxHealth ?? gameState.castleHealth;
        gameState.level = castleConfig.level ?? 1;

        if (window.hud && typeof window.hud.criar === 'function') {
            window.hud.criar(this);
            window.hud.atualizarVida(gameState.castleHealth, gameState.maxHealth);
        }

        if (window.levelManager && typeof window.levelManager.create === 'function') {
            window.levelManager.create(this, levelConfig).then(() => {
                const castleSprite = window.castle ? window.castle.sprite : null;
                if (castleSprite) {
                    castleSprite.setAlpha(0);
                    this.tweens.add({
                        targets: castleSprite,
                        alpha: 1,
                        duration: 900,
                        ease: 'Quadratic.InOut'
                    });
                }
                if (window.startMode && typeof window.startMode.runIfPathMatches === 'function') {
                    window.startMode.runIfPathMatches();
                }
                if (window.twitchGameIntegration && typeof window.twitchGameIntegration.startIfNeeded === 'function') {
                    window.twitchGameIntegration.startIfNeeded();
                }
            }).catch((error) => {
                console.error(error);
                if (window.hud && typeof window.hud.mostrarMensagem === 'function') {
                    window.hud.mostrarMensagem('Erro ao carregar elementos do level.');
                }
            });
        }

        this.input.on('pointerdown', (pointer) => {
            const { col, row } = window.grid.screenToIso(pointer.worldX, pointer.worldY);
            if (col >= 0 && col < window.grid.GRID_COLS && row >= 0 && row < window.grid.GRID_ROWS) {
                const tileElement = window.grid.getTileElement(col, row);
                const isCastleArea = Boolean(tileElement && tileElement.type === 'castle');
                if (isCastleArea) {
                    window.alterarVida(-5);
                    if (window.hud && typeof window.hud.mostrarMensagem === 'function') {
                        window.hud.mostrarMensagem('⚔️ Castelo sofreu 5 de dano!');
                    }
                } else {
                    if (window.hud && typeof window.hud.atualizarCoordenada === 'function') {
                        window.hud.atualizarCoordenada(col, row, false);
                    }
                }
            }
        });

        this.input.on('pointermove', (pointer) => {
            const { col, row } = window.grid.screenToIso(pointer.worldX, pointer.worldY);
            if (col >= 0 && col < window.grid.GRID_COLS && row >= 0 && row < window.grid.GRID_ROWS) {
                const isCastleTile = window.grid.isCastleTile(col, row);
                if (window.hud && typeof window.hud.atualizarHover === 'function') {
                    window.hud.atualizarHover(col, row, isCastleTile);
                }
            } else if (window.hud && typeof window.hud.limparHover === 'function') {
                window.hud.limparHover();
            }
        });

        this.scale.on('resize', (gameSize) => {
            window.grid.redimensionar(this, gameSize.width, gameSize.height);
            if (window.levelManager && typeof window.levelManager.repositionAll === 'function') {
                window.levelManager.repositionAll();
            }
            if (window.hud && typeof window.hud.reposicionar === 'function') window.hud.reposicionar(gameSize.width, gameSize.height);
        });
    }

    update(time, delta) {
        if (window.levelManager && typeof window.levelManager.update === 'function') {
            window.levelManager.update(delta / 1000);
        }
        if (window.hud && typeof window.hud.atualizarDefesaAura === 'function') {
            window.hud.atualizarDefesaAura();
        }
    }
}

window.MainScene = MainScene;