// main.js
window.addEventListener('load', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const config = {
        type: Phaser.AUTO,
        width: w,
        height: h,
        resolution: dpr,
        parent: 'game-container',
        backgroundColor: '#20442a',
        scale: {
            mode: Phaser.Scale.RESIZE,
            autoRound: true,
            width: w,
            height: h
        },
        render: {
            antialias: true,
            powerPreference: 'high-performance'
        },
        scene: window.MainScene
    };
    const game = new Phaser.Game(config);
    window.gameInstance = game;

    window.addEventListener('resize', () => {
        const nw = window.innerWidth;
        const nh = window.innerHeight;
        game.scale.resize(nw, nh);
    });
});