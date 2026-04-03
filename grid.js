// grid.js
window.grid = (function() {
    const GRID_COLS = 50;
    const GRID_ROWS = 50;
    const TILE_W = 72;
    const TILE_H = 36;

    let gridOffsetX = 0, gridOffsetY = 0;
    let sceneRef = null;
    const occupiedTiles = new Map();

    // ========== FUNÇÕES DE CONVERSÃO ==========
    function isoToScreen(col, row, offsetX = gridOffsetX, offsetY = gridOffsetY) {
        const screenX = (col - row) * (TILE_W / 2) + offsetX;
        const screenY = (col + row) * (TILE_H / 2) + offsetY;
        return { x: screenX, y: screenY };
    }

    function screenToIso(screenX, screenY, offsetX = gridOffsetX, offsetY = gridOffsetY) {
        const relX = screenX - offsetX;
        const relY = screenY - offsetY;
        const invTileW2 = 2 / TILE_W;
        const invTileH2 = 2 / TILE_H;
        let col = (relX * invTileW2 + relY * invTileH2) / 2;
        let row = (relY * invTileH2 - relX * invTileW2) / 2;
        col = Math.round(col);
        row = Math.round(row);
        return { col, row };
    }

    function calculateGridOffset(sceneWidth, sceneHeight) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let row = 0; row < GRID_ROWS; row++) {
            for (let col = 0; col < GRID_COLS; col++) {
                const { x, y } = isoToScreen(col, row, 0, 0);
                minX = Math.min(minX, x - TILE_W/2);
                maxX = Math.max(maxX, x + TILE_W/2);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y + TILE_H);
            }
        }
        const gridWidth = maxX - minX;
        const gridHeight = maxY - minY;
        const offsetX = (sceneWidth - gridWidth) / 2 - minX;
        const offsetY = (sceneHeight - gridHeight) / 2 - minY;
        return { offsetX, offsetY };
    }

    function getBasePoint(col, row, tilesWide = 1, tilesHigh = 1) {
        const centerTileCol = col + (tilesWide - 1) / 2;
        const centerTileRow = row + (tilesHigh - 1) / 2;
        const { x: tileTopX, y: tileTopY } = isoToScreen(centerTileCol, centerTileRow);
        return { x: tileTopX, y: tileTopY + TILE_H };
    }

    function tileKey(col, row) {
        return `${col},${row}`;
    }

    function clearOccupancy() {
        occupiedTiles.clear();
    }

    function markElementTiles(elementId, type, col, row, tilesWide, tilesHigh) {
        for (let c = col; c < col + tilesWide; c += 1) {
            for (let r = row; r < row + tilesHigh; r += 1) {
                if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) {
                    continue;
                }
                occupiedTiles.set(tileKey(c, r), {
                    elementId,
                    type,
                    col: c,
                    row: r
                });
            }
        }
    }

    function getTileElement(col, row) {
        return occupiedTiles.get(tileKey(col, row)) || null;
    }

    function isCastleTile(col, row) {
        const tile = getTileElement(col, row);
        return Boolean(tile && tile.type === 'castle');
    }

    // ========== INICIALIZAÇÃO (sem desenho) ==========
    function inicializar(scene, width, height) {
        sceneRef = scene;
        clearOccupancy();

        const { offsetX, offsetY } = calculateGridOffset(width, height);
        gridOffsetX = offsetX;
        gridOffsetY = offsetY;
    }

    function redimensionar(scene, width, height) {
        sceneRef = scene;
        const { offsetX, offsetY } = calculateGridOffset(width, height);
        gridOffsetX = offsetX;
        gridOffsetY = offsetY;
    }

    return {
        GRID_COLS, GRID_ROWS, TILE_W, TILE_H,
        isoToScreen, screenToIso, getBasePoint, isCastleTile,
        getTileElement, markElementTiles, clearOccupancy,
        inicializar, redimensionar
    };
})();