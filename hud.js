// hud.js
window.hud = (function() {
    let sceneRef = null;
    let coordText = null;       // texto fixo inferior esquerdo (já existe no HTML, mas podemos criar um)
    let hoverText = null;
    let healthText = null;
    let defenseText = null;

    function criar(scene) {
        sceneRef = scene;
        const width = scene.cameras.main.width;
        const height = scene.cameras.main.height;

        // Texto de coordenadas (fixo, substitui o do HTML)
        // coordText = scene.add.text(18, 18, '🏰 Castelo central (3x3) | Passe o mouse', {
        //     fontSize: '15px',
        //     fontFamily: 'monospace',
        //     fill: '#FFF7E8',
        //     backgroundColor: '#1e442acc',
        //     padding: { x: 12, y: 6 },
        //     borderRadius: 24
        // }).setDepth(30).setScrollFactor(0);

        healthText = scene.add.text(width - 20, 20, '❤️ 100/100', {
            fontSize: '16px',
            fontFamily: 'monospace',
            fill: '#ffdd99',
            backgroundColor: '#1a2a1acc',
            padding: { x: 10, y: 5 },
            borderRadius: 20
        }).setOrigin(1, 0).setDepth(30);
        atualizarVida(window.gameState.castleHealth, window.gameState.maxHealth);

        defenseText = scene.add.text(width - 20, 48, '', {
            fontSize: '13px',
            fontFamily: 'monospace',
            fill: '#9ae8d4',
            backgroundColor: '#0d2a22cc',
            padding: { x: 10, y: 4 },
            borderRadius: 20
        }).setOrigin(1, 0).setDepth(30);
        atualizarDefesaAura();

        // Hover flutuante
        // hoverText = scene.add.text(width - 20, 90, '', {
        //     fontSize: '12px',
        //     fill: '#FFECB3',
        //     backgroundColor: '#000000aa',
        //     padding: { x: 8, y: 4 },
        //     borderRadius: 20
        // }).setOrigin(1, 0).setDepth(30);
        // hoverText.setVisible(false);
    }

    function atualizarVida(vida, maxVida) {
        if (healthText) healthText.setText(`❤️ ${vida}/${maxVida}`);
    }

    function atualizarDefesaAura() {
        if (!defenseText) return;
        const lm = window.levelManager;
        if (!lm || typeof lm.getCastleHealAuraDefenseInfo !== 'function') {
            defenseText.setVisible(false);
            return;
        }
        const info = lm.getCastleHealAuraDefenseInfo();
        if (!info.active || info.percent <= 0) {
            defenseText.setVisible(false);
            return;
        }
        defenseText.setVisible(true);
        const torres = info.count === 1 ? '1 torre de cura' : `${info.count} torres de cura`;
        defenseText.setText(`🛡️ Aura: −${info.percent}% dano no castelo (${torres})`);
    }

    function atualizarCoordenada(col, row, isCastle) {
        if (coordText) {
            if (isCastle) {
                coordText.setText(`🏰 Área do Castelo (${col}, ${row})`);
            } else {
                coordText.setText(`🗺️ Terreno: (${col}, ${row})`);
            }
        }
    }

    function atualizarHover(col, row, isCastle) {
        if (hoverText) {
            const tipo = isCastle ? "🏰 CASTELO IMPERIAL" : "🍃 TERRENO LIVRE";
            hoverText.setText(`📍 ${col},${row} — ${tipo}`);
            hoverText.setVisible(true);
        }
    }

    function limparHover() {
        if (hoverText) hoverText.setVisible(false);
    }

    function reposicionar(width, height) {
        if (coordText) coordText.setPosition(18, 18);
        if (healthText) healthText.setPosition(width - 20, 20);
        if (defenseText) defenseText.setPosition(width - 20, 48);
        if (hoverText) hoverText.setPosition(width - 20, 90);
        atualizarVida(window.gameState.castleHealth, window.gameState.maxHealth);
        atualizarDefesaAura();
    }

    function mostrarMensagem(msg) {
        if (sceneRef) {
            const tempMsg = sceneRef.add.text(sceneRef.cameras.main.width/2, sceneRef.cameras.main.height - 50, msg, {
                fontSize: '14px',
                fill: '#ffdd99',
                backgroundColor: '#000000aa',
                padding: { x: 8, y: 4 },
                borderRadius: 20
            }).setOrigin(0.5).setDepth(40);
            sceneRef.time.delayedCall(1500, () => tempMsg.destroy());
        }
    }

    return {
        criar,
        atualizarVida,
        atualizarDefesaAura,
        atualizarCoordenada,
        atualizarHover,
        limparHover,
        reposicionar,
        mostrarMensagem
    };
})();