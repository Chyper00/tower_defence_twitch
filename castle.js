// castle.js
window.levelManager = (function() {
    const ELEMENT_CACHE = {};
    let catalogCache = null;
    let catalogLoadPromise = null;

    async function fetchCatalog() {
        if (catalogCache !== null) {
            return catalogCache;
        }
        if (!catalogLoadPromise) {
            catalogLoadPromise = fetch('catalog.json')
                .then((response) => {
                    if (!response.ok) {
                        throw new Error(String(response.status));
                    }
                    return response.json();
                })
                .then((data) => {
                    catalogCache = data && typeof data === 'object' ? data : {};
                    return catalogCache;
                })
                .catch((error) => {
                    console.warn('catalog.json nao carregado; use caminhos .json completos ou adicione o ficheiro.', error);
                    catalogCache = {};
                    return catalogCache;
                });
        }
        return catalogLoadPromise;
    }

    async function resolveToConfigPath(keyOrFile) {
        const s = String(keyOrFile || '');
        if (s.endsWith('.json')) {
            return s;
        }
        const cat = await fetchCatalog();
        if (cat[s]) {
            return cat[s];
        }
        return `${s}.json`;
    }

    async function resolveLevelElementPath(elementDef) {
        if (elementDef.ref != null) {
            const key = String(elementDef.ref);
            const cat = await fetchCatalog();
            const path = cat[key];
            if (!path) {
                throw new Error(`catalog.json: ref desconhecida "${key}". Adiciona a entrada em catalog.json.`);
            }
            return path;
        }
        if (elementDef.config != null) {
            return resolveToConfigPath(elementDef.config);
        }
        throw new Error('Elemento do nivel precisa de "ref" (catalogo) ou "config" (ficheiro ou chave).');
    }
    const PERF = {
        aiTickMs: 80,
        maxFloatingTexts: 35,
        maxEnemies: 90,
        textPerTargetCooldownMs: 140
    };
    let sceneRef = null;
    let elements = [];
    let castleElement = null;
    let uniqueId = 0;
    let aiAccumulatorMs = 0;
    let floatingTextCount = 0;
    const FIREBOMB_FRAME_COUNT = 12;
    const FIREBOMB_ANIM_KEY = 'fx_firebomb_explode_12';
    const ICE_HIT_FRAME_COUNT = 5;
    const ICE_HIT_ANIM_KEY = 'fx_ice_hit_5';

    function normalizePosition(position) {
        if (Array.isArray(position) && position.length >= 2) {
            return { col: Number(position[0]), row: Number(position[1]) };
        }
        if (position && typeof position === 'object') {
            return { col: Number(position.col), row: Number(position.row) };
        }
        return null;
    }

    function isInsideGrid(col, row, tilesWide, tilesHigh) {
        return col >= 0 && row >= 0 && (col + tilesWide) <= window.grid.GRID_COLS && (row + tilesHigh) <= window.grid.GRID_ROWS;
    }

    function isValidNumber(value) {
        return Number.isFinite(value);
    }

    function getAttackRadius(rangeTiles) {
        const r = Math.max(0, Number(rangeTiles) || 0);
        if (r <= 0) return 0;
        // Corpo a corpo (1): vizinhos Chebyshev 1 (célula ao lado). Com a formula antiga floor((1-1)/2)=0
        // só contava a mesma célula — inimigos nunca batiam em torres/castelo 1x1.
        if (r === 1) return 1;
        return Math.max(1, Math.floor((r - 1) / 2));
    }

    function tileDistance(a, b) {
        return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
    }

    async function fetchJson(configPath) {
        if (!ELEMENT_CACHE[configPath]) {
            const response = await fetch(configPath);
            if (!response.ok) {
                throw new Error(`Nao foi possivel ler ${configPath}`);
            }
            ELEMENT_CACHE[configPath] = await response.json();
        }
        return ELEMENT_CACHE[configPath];
    }

    function ensureTexture(scene, key, imagePath) {
        return new Promise((resolve, reject) => {
            if (scene.textures.exists(key)) {
                resolve();
                return;
            }

            scene.load.image(key, imagePath);
            scene.load.once('complete', () => resolve());
            scene.load.once('loaderror', (file) => reject(new Error(`Falha ao carregar textura: ${file.src || imagePath}`)));
            scene.load.start();
        });
    }

    function ensureSpriteSheet(scene, key, imagePath, frameWidth, frameHeight) {
        return new Promise((resolve, reject) => {
            if (scene.textures.exists(key)) {
                resolve();
                return;
            }

            scene.load.spritesheet(key, imagePath, { frameWidth, frameHeight });
            scene.load.once('complete', () => resolve());
            scene.load.once('loaderror', (file) => reject(new Error(`Falha ao carregar spritesheet: ${file.src || imagePath}`)));
            scene.load.start();
        });
    }

    function ensureFireBombExplosion(scene) {
        return new Promise((resolve, reject) => {
            if (scene.anims.exists(FIREBOMB_ANIM_KEY)) {
                resolve();
                return;
            }
            let needLoad = 0;
            for (let i = 1; i <= FIREBOMB_FRAME_COUNT; i += 1) {
                const key = `fx_expl_b_${i}`;
                if (!scene.textures.exists(key)) {
                    scene.load.image(key, `assets/fx/FireBomb/explosion-b${i}.png`);
                    needLoad += 1;
                }
            }
            const finish = () => {
                if (!scene.anims.exists(FIREBOMB_ANIM_KEY)) {
                    scene.anims.create({
                        key: FIREBOMB_ANIM_KEY,
                        frames: Array.from({ length: FIREBOMB_FRAME_COUNT }, (_, idx) => ({ key: `fx_expl_b_${idx + 1}`, frame: 0 })),
                        frameRate: 20,
                        repeat: 0
                    });
                }
                resolve();
            };
            if (needLoad === 0) {
                finish();
                return;
            }
            scene.load.once('complete', finish);
            scene.load.once('loaderror', (file) => reject(new Error(`FX FireBomb: ${file?.src || 'load'}`)));
            scene.load.start();
        });
    }

    function playFireBombExplosion(x, y, scale = 1) {
        if (!sceneRef || !sceneRef.anims.exists(FIREBOMB_ANIM_KEY)) return;
        const spr = sceneRef.add.sprite(x, y, 'fx_expl_b_1');
        spr.setOrigin(0.5, 0.85);
        spr.setScale(scale);
        spr.setDepth(85);
        spr.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
            if (spr && spr.scene) spr.destroy();
        });
        spr.play(FIREBOMB_ANIM_KEY);
    }

    function ensureIceHitExplosion(scene) {
        return new Promise((resolve, reject) => {
            if (scene.anims.exists(ICE_HIT_ANIM_KEY)) {
                resolve();
                return;
            }
            let needLoad = 0;
            for (let i = 1; i <= ICE_HIT_FRAME_COUNT; i += 1) {
                const key = `fx_ice_hit_${i}`;
                if (!scene.textures.exists(key)) {
                    scene.load.image(key, `assets/fx/ice/hits-3-${i}.png`);
                    needLoad += 1;
                }
            }
            const finish = () => {
                if (!scene.anims.exists(ICE_HIT_ANIM_KEY)) {
                    scene.anims.create({
                        key: ICE_HIT_ANIM_KEY,
                        frames: Array.from({ length: ICE_HIT_FRAME_COUNT }, (_, idx) => ({ key: `fx_ice_hit_${idx + 1}`, frame: 0 })),
                        frameRate: 18,
                        repeat: 0
                    });
                }
                resolve();
            };
            if (needLoad === 0) {
                finish();
                return;
            }
            scene.load.once('complete', finish);
            scene.load.once('loaderror', (file) => reject(new Error(`FX Ice: ${file?.src || 'load'}`)));
            scene.load.start();
        });
    }

    function playIceHitExplosion(x, y, scale = 1) {
        if (!sceneRef || !sceneRef.anims.exists(ICE_HIT_ANIM_KEY)) return;
        const spr = sceneRef.add.sprite(x, y, 'fx_ice_hit_1');
        spr.setOrigin(0.5, 0.75);
        spr.setScale(scale);
        spr.setDepth(84);
        spr.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
            if (spr && spr.scene) spr.destroy();
        });
        spr.play(ICE_HIT_ANIM_KEY);
    }

    function applyBombKnockback(enemy, impactPx, impactPy, knockCfg = {}) {
        if (!sceneRef || !enemy || !enemy.sprite || !enemy.sprite.scene) return;
        if (enemy.isDead || enemy.isDying) return;
        const distance = knockCfg.distance ?? 22;
        const duration = knockCfg.durationMs ?? 160;
        if (distance <= 0) return;

        const ex = enemy.sprite.x;
        const ey = enemy.sprite.y - 18;
        const dx = ex - impactPx;
        const dy = ey - impactPy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = (dx / len) * distance;
        const ny = (dy / len) * distance;

        sceneRef.tweens.add({
            targets: enemy.sprite,
            x: enemy.sprite.x + nx,
            y: enemy.sprite.y + ny,
            duration,
            ease: 'Cubic.Out',
            onComplete: () => {
                if (!enemy.sprite || !enemy.sprite.scene) return;
                const iso = window.grid.screenToIso(enemy.sprite.x, enemy.sprite.y);
                enemy.col = Phaser.Math.Clamp(iso.col, 0, window.grid.GRID_COLS - 1);
                enemy.row = Phaser.Math.Clamp(iso.row, 0, window.grid.GRID_ROWS - 1);
                enemy.sprite.setDepth(enemy.sprite.y + (enemy.config?.zIndex ?? 0));
            }
        });
    }

    function applyBombAoeDamage(impactCol, impactRow, radiusTiles, damage, impactPx, impactPy, knockCfg = {}) {
        const impactCenter = { col: impactCol, row: impactRow };
        const enemies = getElementsByCategory('enemy');
        enemies.forEach((enemy) => {
            const ec = getElementTileCenter(enemy);
            if (tileDistance(ec, impactCenter) > radiusTiles) return;
            enemy.health = Math.max(0, enemy.health - damage);
            const bombText = formatDamageText(damage);
            if (bombText) showCombatText(enemy, bombText, '#ff9a9a');
            if (enemy.health <= 0) {
                triggerDeath(enemy, enemy.lastDirection || 'front');
            } else {
                applyBombKnockback(enemy, impactPx, impactPy, knockCfg);
            }
        });
    }

    async function launchAimedBombProjectile(turret, aimCol, aimRow, damage, radiusTiles) {
        if (!sceneRef || !turret || !turret.sprite) return;
        try {
            await ensureFireBombExplosion(sceneRef);
        } catch (e) {
            console.warn(e);
        }

        const projectileConfig = turret.config.projectile || {};
        const color = projectileConfig.color || 0xff6600;
        const speed = projectileConfig.speed || 200;
        const arcHeight = projectileConfig.arcHeight ?? 100;
        const hitRadiusPx = projectileConfig.directHitRadiusPx ?? 30;

        const attackerPos = { x: turret.sprite.x, y: turret.sprite.y - 24 };
        const groundPoint = window.grid.getBasePoint(aimCol, aimRow, 1, 1);
        const targetPos = { x: groundPoint.x, y: groundPoint.y - (projectileConfig.groundOffsetY || 4) };

        let projectile = null;
        if (projectileConfig.texture && sceneRef.textures.exists(projectileConfig.texture)) {
            projectile = sceneRef.add.sprite(attackerPos.x, attackerPos.y, projectileConfig.texture);
            projectile.setScale(projectileConfig.scale || 0.35);
        } else {
            projectile = sceneRef.add.rectangle(attackerPos.x, attackerPos.y, 10, 10, color);
        }
        projectile.setDepth(42);

        const distance = Phaser.Math.Distance.Between(attackerPos.x, attackerPos.y, targetPos.x, targetPos.y);
        const duration = Math.max(200, (distance / speed) * 1000);

        let finished = false;
        const explodeAt = (col, row, px, py) => {
            if (finished) return;
            finished = true;
            if (projectile && projectile.scene) projectile.destroy();
            playFireBombExplosion(px, py, projectileConfig.explosionScale ?? 1.1);
            applyBombAoeDamage(col, row, radiusTiles, damage, px, py, projectileConfig.knockback || {});
        };

        const prog = { t: 0 };
        const tween = sceneRef.tweens.add({
            targets: prog,
            t: 1,
            duration,
            ease: 'Linear',
            onUpdate: () => {
                if (finished || !projectile || !projectile.scene) return;
                const t = prog.t;
                projectile.x = Phaser.Math.Linear(attackerPos.x, targetPos.x, t);
                projectile.y = Phaser.Math.Linear(attackerPos.y, targetPos.y, t) - arcHeight * Math.sin(Math.PI * t);

                const enemies = getElementsByCategory('enemy');
                for (let i = 0; i < enemies.length; i += 1) {
                    const e = enemies[i];
                    if (!e.sprite) continue;
                    const d = Phaser.Math.Distance.Between(projectile.x, projectile.y, e.sprite.x, e.sprite.y - 18);
                    if (d < hitRadiusPx) {
                        const iso = window.grid.screenToIso(projectile.x, projectile.y);
                        const col = Phaser.Math.Clamp(iso.col, 0, window.grid.GRID_COLS - 1);
                        const row = Phaser.Math.Clamp(iso.row, 0, window.grid.GRID_ROWS - 1);
                        tween.stop();
                        explodeAt(col, row, projectile.x, projectile.y);
                        return;
                    }
                }
            },
            onComplete: () => {
                if (finished) return;
                explodeAt(aimCol, aimRow, targetPos.x, targetPos.y);
            }
        });
    }

    function pickRandomSprite(config) {
        const sprites = Array.isArray(config.sprites) ? config.sprites : [];
        if (sprites.length === 0) {
            return null;
        }
        const selected = sprites[Math.floor(Math.random() * sprites.length)];
        if (typeof selected === 'string') {
            return { image: selected };
        }
        if (selected && typeof selected === 'object') {
            return selected;
        }
        return null;
    }

    function pickRandomVariant(config) {
        const variants = Array.isArray(config.variants) ? config.variants : [];
        if (variants.length === 0) return null;
        return variants[Math.floor(Math.random() * variants.length)];
    }

    async function setupDirectionalAnimations(resolvedConfig) {
        const variant = pickRandomVariant(resolvedConfig);
        if (!variant || !variant.animations) {
            return null;
        }

        const walk = variant.animations.walk;
        const attack = variant.animations.attack;
        const death = variant.animations.death;
        if (!walk || !attack) {
            return null;
        }

        const walkSheetKey = `${resolvedConfig.type}_${variant.id}_walk_sheet`;
        const attackSheetKey = `${resolvedConfig.type}_${variant.id}_attack_sheet`;
        const deathSheetKey = `${resolvedConfig.type}_${variant.id}_death_sheet`;
        const walkAnimKey = `${resolvedConfig.type}_${variant.id}_walk_anim`;
        const attackAnimKey = `${resolvedConfig.type}_${variant.id}_attack_anim`;
        const deathAnimKey = `${resolvedConfig.type}_${variant.id}_death_anim`;

        await ensureSpriteSheet(sceneRef, walkSheetKey, walk.image, walk.frameWidth, walk.frameHeight);
        await ensureSpriteSheet(sceneRef, attackSheetKey, attack.image, attack.frameWidth, attack.frameHeight);
        if (death) {
            await ensureSpriteSheet(sceneRef, deathSheetKey, death.image, death.frameWidth, death.frameHeight);
        }

        function resolveGrid(sheetKey, frameWidth, frameHeight, fallbackRows, fallbackCols) {
            const texture = sceneRef.textures.get(sheetKey);
            const image = texture ? texture.getSourceImage() : null;
            if (!image || !image.width || !image.height) {
                return { rows: fallbackRows, cols: fallbackCols };
            }
            const cols = Math.max(1, Math.floor(image.width / frameWidth));
            const rows = Math.max(1, Math.floor(image.height / frameHeight));
            return { rows, cols };
        }

        const walkGrid = resolveGrid(walkSheetKey, walk.frameWidth, walk.frameHeight, walk.rows, walk.cols);
        const attackGrid = resolveGrid(attackSheetKey, attack.frameWidth, attack.frameHeight, attack.rows, attack.cols);
        const deathGrid = death
            ? resolveGrid(deathSheetKey, death.frameWidth, death.frameHeight, death.rows, death.cols)
            : null;

        const EIGHT_DIR_ORDER = ['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se'];
        const FOUR_WALK_ORDER = ['front', 'back', 'left', 'right'];
        const FOUR_DEATH_ORDER = ['front', 'back', 'right', 'left'];
        const globalDirCount = variant.directionCount ?? walk.directionCount ?? 4;

        const walkRowOrder = walk.directionRowOrder || variant.directionRowOrder
            || (globalDirCount >= 8 ? EIGHT_DIR_ORDER : FOUR_WALK_ORDER);
        const attackRowOrder = attack.directionRowOrder || variant.directionRowOrder
            || (globalDirCount >= 8 ? EIGHT_DIR_ORDER : FOUR_WALK_ORDER);
        const deathRowOrder = death
            ? (death.directionRowOrder || variant.directionRowOrder
                || (globalDirCount >= 8 ? EIGHT_DIR_ORDER : FOUR_DEATH_ORDER))
            : [];

        function addDirectedStrip(sheetKey, cols, rows, baseKey, fps, repeat, rowOrder) {
            const map = {};
            const maxRow = Math.min(rows, rowOrder.length);
            for (let rowIndex = 0; rowIndex < maxRow; rowIndex += 1) {
                const direction = rowOrder[rowIndex];
                if (!direction) continue;
                const start = rowIndex * cols;
                const end = start + cols - 1;
                const directionalKey = `${baseKey}_${direction}`;
                if (!sceneRef.anims.exists(directionalKey)) {
                    sceneRef.anims.create({
                        key: directionalKey,
                        frames: sceneRef.anims.generateFrameNumbers(sheetKey, { start, end }),
                        frameRate: fps,
                        repeat
                    });
                }
                map[direction] = directionalKey;
            }
            return map;
        }

        if (!sceneRef.anims.exists(walkAnimKey)) {
            sceneRef.anims.create({
                key: walkAnimKey,
                frames: sceneRef.anims.generateFrameNumbers(walkSheetKey, { start: 0, end: (walkGrid.rows * walkGrid.cols) - 1 }),
                frameRate: walk.fps || 12,
                repeat: -1
            });
        }
        const walkByDirection = addDirectedStrip(
            walkSheetKey, walkGrid.cols, walkGrid.rows, walkAnimKey, walk.fps || 12, -1, walkRowOrder
        );

        if (!sceneRef.anims.exists(attackAnimKey)) {
            sceneRef.anims.create({
                key: attackAnimKey,
                frames: sceneRef.anims.generateFrameNumbers(attackSheetKey, { start: 0, end: (attackGrid.rows * attackGrid.cols) - 1 }),
                frameRate: attack.fps || 14,
                repeat: 0
            });
        }
        const attackByDirection = addDirectedStrip(
            attackSheetKey, attackGrid.cols, attackGrid.rows, attackAnimKey, attack.fps || 14, 0, attackRowOrder
        );

        const deathByDirection = {};
        if (death) {
            if (!sceneRef.anims.exists(deathAnimKey)) {
                sceneRef.anims.create({
                    key: deathAnimKey,
                    frames: sceneRef.anims.generateFrameNumbers(deathSheetKey, { start: 0, end: (deathGrid.rows * deathGrid.cols) - 1 }),
                    frameRate: death.fps || 14,
                    repeat: 0
                });
            }
            Object.assign(deathByDirection, addDirectedStrip(
                deathSheetKey, deathGrid.cols, deathGrid.rows, deathAnimKey, death.fps || 14, 0, deathRowOrder
            ));
        }

        const directionRowOrderForMovement = variant.directionRowOrder || walk.directionRowOrder
            || (globalDirCount >= 8 ? [...EIGHT_DIR_ORDER] : [...FOUR_WALK_ORDER]);

        const invertDirectionX = Boolean(
            variant.invertDirectionX ?? walk.invertDirectionX ?? attack.invertDirectionX ?? false
        );

        return {
            variantId: variant.id,
            walkSheetKey,
            attackSheetKey,
            deathSheetKey,
            walkAnimKey,
            attackAnimKey,
            deathAnimKey,
            walkByDirection,
            attackByDirection,
            deathByDirection,
            directionCount: globalDirCount,
            directionRowOrder: directionRowOrderForMovement,
            invertDirectionX
        };
    }

    function createFallbackSprite(config) {
        const width = 64;
        const height = 64;
        const isEnemy = config.category === 'enemy';
        const isTurret = typeof config.type === 'string' && /^turret[_-]/.test(config.type);
        const isHero = config.category === 'hero';
        const color = isEnemy ? 0x66dd66 : (isTurret ? 0x9999cc : (isHero ? 0x6aa3ff : 0xaa8866));
        return sceneRef.add.rectangle(0, 0, width, height, color).setStrokeStyle(2, 0x111111, 0.8);
    }

    function getElementTileCenter(element) {
        return {
            col: element.col + (element.tilesWide - 1) / 2,
            row: element.row + (element.tilesHigh - 1) / 2
        };
    }

    function getElementByType(type) {
        return elements.find((item) => item.type === type) || null;
    }

    function isHeroEntity(el) {
        if (!el) return false;
        if (el.category === 'hero') return true;
        const t = String(el.type || '');
        return /^hero[_-]/i.test(t);
    }

    function getSpriteTopYForOverlays(sprite) {
        if (!sprite) return 0;
        const dh = sprite.displayHeight || Math.abs((sprite.height || 0) * Math.abs(sprite.scaleY || 1));
        return sprite.y - Math.max(dh, 28);
    }

    function layoutElement(element) {
        const { col, row, tilesWide, tilesHigh, config, sprite } = element;
        const basePoint = window.grid.getBasePoint(col, row, tilesWide, tilesHigh);
        const desiredWidth = tilesWide * window.grid.TILE_W;
        const desiredHeight = tilesHigh * window.grid.TILE_H * (config.size?.heightMultiplier || 1);
        const sw = Math.max(1, sprite.width || 1);
        const sh = Math.max(1, sprite.height || 1);
        const scaleX = desiredWidth / sw;
        const scaleY = desiredHeight / sh;
        let scale = Math.min(scaleX, scaleY);
        if (!Number.isFinite(scale) || scale <= 0) {
            scale = 1;
        }

        const isStructureFootprint = element.type === 'castle' || element.category === 'structure';
        if (isStructureFootprint && config.size?.pixelPerfectScale !== false) {
            const dw = sw * scale;
            const dh = sh * scale;
            const snappedW = Math.max(1, Math.round(dw));
            const snappedH = Math.max(1, Math.round(dh));
            scale = Math.min(snappedW / sw, snappedH / sh);
        }

        sprite.setOrigin(0.5, 1);
        sprite.setPosition(basePoint.x, basePoint.y - (config.position?.offsetY || 0));
        sprite.setScale(scale);
        if (isStructureFootprint && typeof sprite.setRoundPixels === 'function') {
            sprite.setRoundPixels(true);
        }
        if (element.type === 'castle') {
            element._castleLayoutScale = scale;
        }
        if (typeof element.type === 'string' && /^turret[_-]/.test(element.type)) {
            element._structureLayoutScale = scale;
        }
        // Depth dinamico para ordenacao isometrica consistente.
        sprite.setDepth(sprite.y + (config.zIndex ?? 0));
        if (isHeroEntity(element) || (typeof element.type === 'string' && /^turret[_-]/.test(element.type))) {
            layoutUnitOverlays(element);
        }
        if (element.type === 'castle') {
            positionCastleHealShield(element);
        }
    }

    function getElementsByCategory(category) {
        return elements.filter((element) => !element.isDead && !element.isDying && element.category === category);
    }

    function getDirectionFromVector(dx, dy) {
        if (Math.abs(dx) >= Math.abs(dy)) {
            return dx >= 0 ? 'right' : 'left';
        }
        return dy >= 0 ? 'front' : 'back';
    }

    /** Sector index 0..7 always means s, sw, w, nw, n, ne, e, se (clockwise from down on screen). */
    const EIGHT_WAY_SECTOR_KEYS = ['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se'];

    function getDirection8FromVector(dx, dy, invertDirectionX = false) {
        if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
            return 's';
        }
        const ax = invertDirectionX ? -dx : dx;
        let a = Math.atan2(dy, ax);
        if (a < 0) {
            a += Math.PI * 2;
        }
        const b = (a - Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
        let idx = Math.floor((b + Math.PI / 8) / (Math.PI / 4));
        if (idx >= 8) {
            idx = 7;
        }
        return EIGHT_WAY_SECTOR_KEYS[idx];
    }

    function resolveDirectionFromVector(unit, dx, dy) {
        if (unit?.animations?.directionCount >= 8 && Array.isArray(unit.animations.directionRowOrder)) {
            return getDirection8FromVector(dx, dy, Boolean(unit.animations.invertDirectionX));
        }
        return getDirectionFromVector(dx, dy);
    }

    function getDirectionToTarget(source, target, fallback = 'front') {
        if (!source || !source.sprite || !target || !target.sprite) {
            return fallback;
        }
        const dx = target.sprite.x - source.sprite.x;
        const dy = target.sprite.y - source.sprite.y;
        return resolveDirectionFromVector(source, dx, dy) || fallback;
    }

    function setUnitAnimationState(unit, state, direction) {
        if (!unit || unit.isDying || !unit.animations || !unit.sprite || !unit.sprite.anims) return;
        let nextKey = null;
        if (state === 'attack') {
            const attackByDirection = unit.animations.attackByDirection || {};
            nextKey = attackByDirection[direction] || unit.animations.attackAnimKey;
        } else {
            const walkByDirection = unit.animations.walkByDirection || {};
            nextKey = walkByDirection[direction] || unit.animations.walkAnimKey;
        }
        if (!nextKey) return;

        if (state === 'attack') {
            if (unit.currentAnimationKey === nextKey && unit.sprite.anims.isPlaying) {
                return;
            }
            unit.sprite.play(nextKey);
            unit.currentAnimationKey = nextKey;
            return;
        }

        if (unit.currentAnimationKey === nextKey) {
            if (!unit.sprite.anims.isPlaying) {
                unit.sprite.play(nextKey, true);
            }
            return;
        }
        unit.sprite.play(nextKey, true);
        unit.currentAnimationKey = nextKey;
    }

    function rebuildGridOccupancy() {
        window.grid.clearOccupancy();
        elements.forEach((element) => {
            if (element.isDead || element.isDying) return;
            if (element.category !== 'structure') return;
            window.grid.markElementTiles(element.id, element.type, element.col, element.row, element.tilesWide, element.tilesHigh);
        });
    }

    function triggerDeath(target, direction = 'front') {
        if (!target || target.isDead || target.isDying) return;
        target.isDying = true;
        target.combat = { power: 0, dps: 0, rangeTiles: 0 };
        teardownUnitWorldUi(target);

        const deathByDirection = target.animations?.deathByDirection || {};
        const deathKey = deathByDirection[direction] || target.animations?.deathAnimKey;
        if (target.sprite && deathKey && target.sprite.anims) {
            target.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
                target.isDead = true;
                if (target.sprite) {
                    target.sprite.destroy();
                }
            });
            target.sprite.play(deathKey, true);
            target.currentAnimationKey = deathKey;
            return;
        }

        target.isDead = true;
        if (target.sprite) {
            target.sprite.destroy();
        }
    }

    function showCombatText(target, text, color = '#ffffff') {
        if (!sceneRef || !target || !target.sprite) return;
        if (floatingTextCount >= PERF.maxFloatingTexts) return;
        const now = sceneRef.time.now;
        target.uiState = target.uiState || {};
        if (target.uiState.nextCombatTextAt && now < target.uiState.nextCombatTextAt) return;
        target.uiState.nextCombatTextAt = now + PERF.textPerTargetCooldownMs;

        floatingTextCount += 1;
        const label = sceneRef.add.text(target.sprite.x, target.sprite.y - 40, text, {
            fontSize: '14px',
            fontFamily: 'monospace',
            color,
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5).setDepth(90);
        sceneRef.tweens.add({
            targets: label,
            y: label.y - 22,
            alpha: 0,
            duration: 520,
            ease: 'Quad.Out',
            onComplete: () => {
                floatingTextCount = Math.max(0, floatingTextCount - 1);
                label.destroy();
            }
        });
    }

    function formatDamageText(value) {
        const absValue = Math.abs(value);
        if (absValue < 0.5) return null;
        return `-${Math.max(1, Math.round(absValue))}`;
    }

    function dealDamage(attacker, target, deltaSeconds) {
        const dps = attacker.combat.dps || 0;
        const power = attacker.combat.power || 0;
        if (dps <= 0 && power <= 0) return;

        let damage = (dps * deltaSeconds) + power;
        if (target.type === 'castle') {
            const auraDef = getCastleHealAuraDefenseInfo();
            if (auraDef.active && auraDef.percent > 0) {
                damage *= Math.max(0, 1 - auraDef.percent / 100);
            }
            window.alterarVida(-damage);
            if (attacker && attacker.sprite) {
                const castleText = formatDamageText(damage);
                if (castleText) showCombatText(attacker, castleText, '#ff9a9a');
            }
            return;
        }

        if (!isValidNumber(target.health)) {
            target.health = target.maxHealth || 1;
        }
        target.health = Math.max(0, target.health - damage);
        updateUnitHealthBar(target);
        const damageText = formatDamageText(damage);
        if (damageText) showCombatText(target, damageText, '#ff9a9a');
        if (target.health <= 0) {
            const deathDirection = target.lastDirection || resolveDirectionFromVector(
                target,
                (attacker?.sprite?.x || 0) - (target?.sprite?.x || 0),
                (attacker?.sprite?.y || 0) - (target?.sprite?.y || 0)
            );
            triggerDeath(target, deathDirection);
        }
    }

    function applyStatusEffect(target, effect) {
        if (!target || !effect || target.isDead || target.isDying) return;
        const now = sceneRef.time.now;
        target.statusEffects = target.statusEffects || {};

        if (effect.type === 'slow') {
            const slowMultiplier = Phaser.Math.Clamp(effect.multiplier ?? 0.5, 0.1, 1);
            target.statusEffects.slowMultiplier = Math.min(target.statusEffects.slowMultiplier ?? 1, slowMultiplier);
            target.statusEffects.slowUntil = Math.max(target.statusEffects.slowUntil ?? 0, now + ((effect.durationSec || 1) * 1000));
            target.statusEffects.statusTextUntil = Math.max(target.statusEffects.statusTextUntil || 0, now + 450);
            showCombatText(target, 'SLOW', '#9ad7ff');
        }

        if (effect.type === 'burn') {
            target.statusEffects.burnDps = Math.max(target.statusEffects.burnDps ?? 0, effect.dps || 0);
            target.statusEffects.burnUntil = Math.max(target.statusEffects.burnUntil ?? 0, now + ((effect.durationSec || 1) * 1000));
            target.statusEffects.statusTextUntil = Math.max(target.statusEffects.statusTextUntil || 0, now + 450);
            showCombatText(target, 'BURN', '#ffb36b');
        }
    }

    function updateStatusEffects(deltaSeconds) {
        const now = sceneRef.time.now;
        elements.forEach((unit) => {
            if (!unit || unit.isDead || unit.isDying || !unit.statusEffects) return;
            const effects = unit.statusEffects;

            if (effects.slowUntil && now > effects.slowUntil) {
                effects.slowUntil = 0;
                effects.slowMultiplier = 1;
            }

            if (effects.burnUntil && now <= effects.burnUntil && effects.burnDps > 0) {
                const burnDamage = effects.burnDps * deltaSeconds;
                unit.health = Math.max(0, unit.health - burnDamage);
                updateUnitHealthBar(unit);
                effects.nextBurnTextAt = effects.nextBurnTextAt || 0;
                if (now >= effects.nextBurnTextAt) {
                    const burnText = formatDamageText(burnDamage);
                    if (burnText) showCombatText(unit, burnText, '#ff8f66');
                    effects.nextBurnTextAt = now + 350;
                }
                if (unit.health <= 0) {
                    triggerDeath(unit, unit.lastDirection || 'front');
                }
            } else if (effects.burnUntil && now > effects.burnUntil) {
                effects.burnUntil = 0;
                effects.burnDps = 0;
                effects.nextBurnTextAt = 0;
            }

            const slowActive = effects.slowUntil && now <= effects.slowUntil;
            const burnActive = effects.burnUntil && now <= effects.burnUntil;
            if (unit.sprite) {
                if (burnActive && slowActive) {
                    unit.sprite.setTint(0xb98cff);
                } else if (burnActive) {
                    unit.sprite.setTint(0xff8a66);
                } else if (slowActive) {
                    unit.sprite.setTint(0x7ecbff);
                } else if (!unit.attackAnimActive) {
                    unit.sprite.clearTint();
                }
            }
        });
    }

    function playTurretAttackAnimation(turret) {
        if (!turret || !turret.sprite || !turret.sprite.scene || !sceneRef) return;
        if (turret.attackAnimActive) return;
        const sp = turret.sprite;
        const base = Number.isFinite(turret._structureLayoutScale) ? turret._structureLayoutScale : sp.scaleX;
        sceneRef.tweens.killTweensOf(sp);
        sp.setScale(base, base);
        turret.attackAnimActive = true;
        sp.setTint(turret.config.animations?.attackTint || 0xffd699);
        sceneRef.tweens.add({
            targets: sp,
            scaleX: base * 1.05,
            scaleY: base * 1.05,
            duration: turret.config.animations?.attackPulseMs || 120,
            yoyo: true,
            ease: 'Quad.Out',
            onComplete: () => {
                turret.attackAnimActive = false;
                if (turret.sprite) {
                    turret.sprite.clearTint();
                    if (Number.isFinite(turret._structureLayoutScale)) {
                        turret.sprite.setScale(turret._structureLayoutScale, turret._structureLayoutScale);
                    }
                }
            }
        });
    }

    function teardownUnitWorldUi(unit) {
        if (!unit) return;
        if (unit.idleTween) {
            unit.idleTween.stop();
            unit.idleTween = null;
        }
        if (unit.unitNameText && unit.unitNameText.scene) {
            unit.unitNameText.destroy();
            unit.unitNameText = null;
        }
        if (unit.unitHealthGraphics && unit.unitHealthGraphics.scene) {
            unit.unitHealthGraphics.destroy();
            unit.unitHealthGraphics = null;
        }
        if (unit.turretAmmoGraphics && unit.turretAmmoGraphics.scene) {
            unit.turretAmmoGraphics.destroy();
            unit.turretAmmoGraphics = null;
        }
    }

    function updateUnitHealthBar(unit) {
        if (!unit || !unit.unitHealthGraphics || !unit.sprite || !unit.sprite.scene) return;
        const maxHealth = Number(unit.maxHealth) || 1;
        const hp = Math.max(0, Math.min(maxHealth, Number(unit.health) || 0));
        const frac = maxHealth > 0 ? (hp / maxHealth) : 0;
        const g = unit.unitHealthGraphics;
        const sp = unit.sprite;
        const w = 42;
        const h = 5;
        const top = getSpriteTopYForOverlays(sp);
        const by = top - (unit.unitNameText ? 22 : 12);
        const bx = sp.x - w / 2;
        g.clear();
        g.fillStyle(0x1a1a1a, 0.92);
        g.fillRect(bx, by, w, h);
        g.fillStyle(0x67d367, 1);
        g.fillRect(bx, by, w * frac, h);
        g.lineStyle(1, 0x000000, 0.45);
        g.strokeRect(bx - 0.5, by - 0.5, w + 1, h + 1);
        g.setDepth(sp.depth + 8);
    }

    function updateTurretAmmoBar(turret) {
        if (!turret.turretAmmoGraphics || !Number.isFinite(turret.maxShots) || turret.maxShots <= 0) return;
        const sp = turret.sprite;
        if (!sp || !sp.scene) return;
        const g = turret.turretAmmoGraphics;
        g.clear();
        const w = 42;
        const h = 5;
        const top = getSpriteTopYForOverlays(sp);
        const hasName = Boolean(turret.unitNameText);
        const by = top - (hasName ? 30 : 20);
        const bx = sp.x - w / 2;
        g.fillStyle(0x1a1a1a, 0.92);
        g.fillRect(bx, by, w, h);
        const frac = Math.max(0, Math.min(1, (turret.shotsRemaining ?? 0) / turret.maxShots));
        g.fillStyle(0xc9a227, 1);
        g.fillRect(bx, by, w * frac, h);
        g.lineStyle(1, 0x000000, 0.45);
        g.strokeRect(bx - 0.5, by - 0.5, w + 1, h + 1);
        g.setDepth(sp.depth + 8);
    }

    function layoutUnitOverlays(unit) {
        if (!unit || !unit.sprite || !unit.sprite.scene) return;
        const sp = unit.sprite;
        const top = getSpriteTopYForOverlays(sp);
        const d = sp.depth + 9;
        if (unit.unitNameText) {
            unit.unitNameText.setPosition(sp.x, top - 22);
            unit.unitNameText.setDepth(d + 1);
        }
        updateUnitHealthBar(unit);
        if (typeof unit.type === 'string' && /^turret[_-]/.test(unit.type)) {
            updateTurretAmmoBar(unit);
        }
    }

    function setupUnitWorldUi(unit, displayName) {
        if (!unit || !sceneRef || !unit.sprite) return;
        const label = typeof displayName === 'string' ? displayName.trim() : '';
        if (label) {
            unit.unitNameText = sceneRef.add.text(0, 0, label, {
                fontSize: '11px',
                fontFamily: 'monospace',
                color: '#f5ecd7',
                backgroundColor: '#0d0d0dcc',
                padding: { x: 5, y: 2 }
            }).setOrigin(0.5, 1);
        }
        if (isHeroEntity(unit) || (typeof unit.type === 'string' && /^turret[_-]/.test(unit.type))) {
            unit.unitHealthGraphics = sceneRef.add.graphics();
        }
        const ms = unit.combat?.maxShots;
        unit.maxShots = (Number.isFinite(ms) && ms > 0) ? ms : null;
        if (typeof unit.type === 'string' && /^turret[_-]/.test(unit.type) && unit.maxShots) {
            unit.turretAmmoGraphics = sceneRef.add.graphics();
            unit.shotsRemaining = unit.maxShots;
        }
        layoutUnitOverlays(unit);
    }

    function removeUnitFromGame(unit) {
        if (!unit || unit.isDead) return;
        unit.isDead = true;
        teardownUnitWorldUi(unit);
        if (unit.attackAnimActive) {
            unit.attackAnimActive = false;
        }
        if (unit.sprite && unit.sprite.scene) {
            unit.sprite.destroy();
        }
        unit.sprite = null;
        elements = elements.filter((e) => e.id !== unit.id);
        rebuildGridOccupancy();
    }

    function removeTurretFromGame(turret) {
        if (!turret) return;
        removeUnitFromGame(turret);
    }

    function setupTurretWorldUi(turret, displayName) {
        if (!turret || !sceneRef || !turret.sprite) return;
        if (Number.isFinite(turret.maxShots) && turret.maxShots > 0) {
            // keep as compatibility path for old calls
        }
        setupUnitWorldUi(turret, displayName);
    }

    function consumeTurretShot(turret) {
        if (!turret || !Number.isFinite(turret.maxShots) || turret.maxShots <= 0) {
            return true;
        }
        const left = (turret.shotsRemaining ?? turret.maxShots) - 1;
        turret.shotsRemaining = left;
        updateTurretAmmoBar(turret);
        if (left <= 0) {
            const delayMs = 200;
            const tid = turret.id;
            sceneRef.time.delayedCall(delayMs, () => {
                const t = elements.find((e) => e.id === tid);
                if (t) removeTurretFromGame(t);
            });
            return false;
        }
        return true;
    }

    function isTurretIdleAnimationEnabled(cfg) {
        if (typeof cfg.idleAnimation === 'boolean') {
            return cfg.idleAnimation;
        }
        const nested = cfg.animations?.idle?.enabled;
        if (typeof nested === 'boolean') {
            return nested;
        }
        return false;
    }

    function ensureTurretIdleAnimation(turret) {
        if (!turret || !turret.sprite || turret.idleTween || !sceneRef) return;
        if (!isTurretIdleAnimationEnabled(turret.config)) return;
        const idleCfg = turret.config.animations?.idle || {};
        turret.idleTween = sceneRef.tweens.add({
            targets: turret.sprite,
            y: turret.sprite.y - (idleCfg.floatPx || 2),
            duration: idleCfg.durationMs || 900,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut'
        });
    }

    function firePlaceholderProjectile(attacker, target, deltaSeconds, forceFire = false) {
        attacker.projectileCooldown -= deltaSeconds;
        if (!forceFire && attacker.projectileCooldown > 0) return;

        const projectileConfig = attacker.config.projectile || {};
        attacker.projectileCooldown = projectileConfig.interval || 0.2;
        const color = projectileConfig.color || 0xffcc66;
        const speed = projectileConfig.speed || 500;
        const attackerPos = { x: attacker.sprite.x, y: attacker.sprite.y - 24 };
        const targetPos = { x: target.sprite.x, y: target.sprite.y - 24 };
        const attackerType = String(attacker.type || '').replace(/-/g, '_');
        const isIce = attackerType === 'turret_ice';
        const iceHitScale = projectileConfig.iceHitScale ?? 0.95;

        const spawnAndTween = () => {
            let projectile = null;
            if (projectileConfig.texture && sceneRef.textures.exists(projectileConfig.texture)) {
                projectile = sceneRef.add.sprite(attackerPos.x, attackerPos.y, projectileConfig.texture);
                projectile.setScale(projectileConfig.scale || 0.3);
            } else {
                projectile = sceneRef.add.rectangle(attackerPos.x, attackerPos.y, 8, 8, color);
            }
            projectile.setDepth(40);

            const distance = Phaser.Math.Distance.Between(attackerPos.x, attackerPos.y, targetPos.x, targetPos.y);
            const duration = Math.max(80, (distance / speed) * 1000);
            const useParabola = projectileConfig.parabola === true || attackerType === 'turret_bomb';
            const arcHeight = projectileConfig.arcHeight ?? 72;

            const onImpact = () => {
                if (isIce) {
                    playIceHitExplosion(targetPos.x, targetPos.y, iceHitScale);
                }
                if (projectile && projectile.scene) {
                    projectile.destroy();
                }
            };

            if (useParabola) {
                const prog = { t: 0 };
                sceneRef.tweens.add({
                    targets: prog,
                    t: 1,
                    duration,
                    ease: 'Linear',
                    onUpdate: () => {
                        const t = prog.t;
                        projectile.x = Phaser.Math.Linear(attackerPos.x, targetPos.x, t);
                        projectile.y = Phaser.Math.Linear(attackerPos.y, targetPos.y, t) - arcHeight * Math.sin(Math.PI * t);
                    },
                    onComplete: onImpact
                });
            } else {
                sceneRef.tweens.add({
                    targets: projectile,
                    x: targetPos.x,
                    y: targetPos.y,
                    duration,
                    ease: 'Linear',
                    onComplete: onImpact
                });
            }
        };

        if (isIce) {
            ensureIceHitExplosion(sceneRef).then(spawnAndTween).catch(() => spawnAndTween());
        } else {
            spawnAndTween();
        }
    }

    function getNearestTarget(source, candidates) {
        if (candidates.length === 0) return null;
        const sourceCenter = getElementTileCenter(source);
        let winner = null;
        let minDistance = Infinity;

        candidates.forEach((candidate) => {
            const candidateCenter = getElementTileCenter(candidate);
            const distance = tileDistance(sourceCenter, candidateCenter);
            if (distance < minDistance) {
                minDistance = distance;
                winner = candidate;
            }
        });
        return winner;
    }

    /** Ponto no ecra usado para alcance melee inimigo (alinha com canEnemyMeleeHitTarget). */
    function getEnemyFootScreenPoint(unit) {
        if (!unit?.sprite) return null;
        const sp = unit.sprite;
        return {
            x: sp.x,
            y: sp.y - Math.min(26, Math.max(12, sp.displayHeight * 0.32))
        };
    }

    /**
     * Retangulo para distancia de contato melee / escolha de alvo.
     * Texturas quadradas com alpha: getBounds() inclui transparencia e parece barreira invisivel / ataque longe do desenho.
     * Para castelo e estruturas: caixa menor, ancorada na base do sprite (pes no chao).
     * Ajuste por JSON: size.hitBoundsScale (0.4–1), ex. 0.62 se a arte tiver muita margem vazia.
     */
    const DEFAULT_STRUCTURE_HIT_BOUNDS_SCALE = 0.68;

    function getElementProximityRect(element) {
        if (!element?.sprite) return null;
        const b = element.sprite.getBounds();
        const isStruct = element.type === 'castle' || element.category === 'structure';
        if (!isStruct) {
            return { x: b.x, y: b.y, width: b.width, height: b.height };
        }
        const raw = element.config?.size?.hitBoundsScale;
        const s = Phaser.Math.Clamp(
            Number.isFinite(Number(raw)) ? Number(raw) : DEFAULT_STRUCTURE_HIT_BOUNDS_SCALE,
            0.4,
            1
        );
        const nw = b.width * s;
        const nh = b.height * s;
        const cx = b.x + b.width * 0.5;
        const bottom = b.y + b.height;
        return {
            x: cx - nw * 0.5,
            y: bottom - nh,
            width: nw,
            height: nh
        };
    }

    function distancePointToRect(px, py, r) {
        const cx = Phaser.Math.Clamp(px, r.x, r.x + r.width);
        const cy = Phaser.Math.Clamp(py, r.y, r.y + r.height);
        return Phaser.Math.Distance.Between(px, py, cx, cy);
    }

    /** Distancia do inimigo ao alvo em pixels (ate ao retangulo de contato visual), para escolher quem atacar primeiro. */
    function screenDistanceEnemyToTarget(unit, target) {
        const p = getEnemyFootScreenPoint(unit);
        if (!p) return Infinity;
        const r = getElementProximityRect(target);
        if (!r) return Infinity;
        return distancePointToRect(p.x, p.y, r);
    }

    /**
     * Um unico alvo mais proximo entre herois, torres e castelo — evita ir "atraves" do castelo
     * para uma torre que em tiles parece perto mas fica do outro lado.
     */
    function pickNearestEnemyAttackTarget(enemy, aliveHeroes, aliveTurrets, castle) {
        const candidates = [];
        aliveHeroes.forEach((h) => candidates.push(h));
        aliveTurrets.forEach((t) => candidates.push(t));
        if (castle && !castle.isDead) candidates.push(castle);
        if (candidates.length === 0) return null;
        let best = candidates[0];
        let bestD = screenDistanceEnemyToTarget(enemy, best);
        for (let i = 1; i < candidates.length; i += 1) {
            const c = candidates[i];
            const d = screenDistanceEnemyToTarget(enemy, c);
            if (d < bestD) {
                bestD = d;
                best = c;
            }
        }
        return best;
    }

    function isInRange(source, target, rangeTiles) {
        const radius = getAttackRadius(rangeTiles);
        const sourceCenter = getElementTileCenter(source);
        const minCol = target.col;
        const maxCol = target.col + target.tilesWide - 1;
        const minRow = target.row;
        const maxRow = target.row + target.tilesHigh - 1;

        const distanceCol = sourceCenter.col < minCol
            ? (minCol - sourceCenter.col)
            : (sourceCenter.col > maxCol ? (sourceCenter.col - maxCol) : 0);
        const distanceRow = sourceCenter.row < minRow
            ? (minRow - sourceCenter.row)
            : (sourceCenter.row > maxRow ? (sourceCenter.row - maxRow) : 0);

        return Math.max(distanceCol, distanceRow) <= radius;
    }

    /** Alcance melee inimigo -> castelo/torre em pixels (fracao de TILE_W). */
    const ENEMY_MELEE_STRUCTURE_PIXEL_TIGHT = 0.22;
    const ENEMY_MELEE_STRUCTURE_PIXEL_LOOSE = 0.34;

    /**
     * Corpo-a-corpo: herois usam so tiles. Castelo/torres exigem perto do sprite em pixels
     * (senao isInRange em diagonal parecia alcance longe demais). Loose + isInRange evita soft-lock por iso.
     */
    function canEnemyMeleeHitTarget(attacker, target) {
        const rangeTiles = attacker.combat?.rangeTiles ?? 1;
        if (!attacker?.sprite || !target?.sprite) return false;
        if (rangeTiles > 1) return false;

        const isStructure = target.type === 'castle' || target.category === 'structure';
        if (!isStructure) {
            return isInRange(attacker, target, rangeTiles);
        }

        const p = getEnemyFootScreenPoint(attacker);
        if (!p) return false;
        const r = getElementProximityRect(target);
        if (!r) return false;
        const d = distancePointToRect(p.x, p.y, r);
        const tw = window.grid.TILE_W;
        if (d <= tw * ENEMY_MELEE_STRUCTURE_PIXEL_TIGHT) return true;
        return isInRange(attacker, target, rangeTiles) && d <= tw * ENEMY_MELEE_STRUCTURE_PIXEL_LOOSE;
    }

    const HERO_MELEE_ENEMY_PIXEL = 0.44;

    /** Heroi corpo-a-corpo vs inimigo: mesmo problema de iso + estruturas ao lado que nos inimigos. */
    function canHeroMeleeHitTarget(hero, target) {
        const rangeTiles = hero.combat?.rangeTiles ?? 1;
        if (!hero?.sprite || !target?.sprite) return false;
        if (rangeTiles > 1) {
            return isInRange(hero, target, rangeTiles);
        }
        if (target.category !== 'enemy') {
            return isInRange(hero, target, rangeTiles);
        }
        if (isInRange(hero, target, rangeTiles)) return true;
        const p = getEnemyFootScreenPoint(hero);
        if (!p) return false;
        const r = getElementProximityRect(target);
        if (!r) return false;
        const d = distancePointToRect(p.x, p.y, r);
        return d <= window.grid.TILE_W * HERO_MELEE_ENEMY_PIXEL;
    }

    function isTileBlockedByStructure(col, row) {
        for (let i = 0; i < elements.length; i += 1) {
            const e = elements[i];
            if (e.isDead || e.isDying) continue;
            if (e.category !== 'structure') continue;
            if (col >= e.col && col < e.col + e.tilesWide && row >= e.row && row < e.row + e.tilesHigh) {
                return true;
            }
        }
        return false;
    }

    function tryMoveUnitToScreenPos(unit, nx, ny) {
        const iso = window.grid.screenToIso(nx, ny);
        const col = Phaser.Math.Clamp(iso.col, 0, window.grid.GRID_COLS - 1);
        const row = Phaser.Math.Clamp(iso.row, 0, window.grid.GRID_ROWS - 1);
        if (isTileBlockedByStructure(col, row)) {
            return false;
        }
        unit.sprite.x = nx;
        unit.sprite.y = ny;
        unit.sprite.setDepth(unit.sprite.y + (unit.config?.zIndex ?? 0));
        unit.col = col;
        unit.row = row;
        return true;
    }

    function moveUnitTowardsTarget(unit, target, deltaSeconds) {
        if (!unit.sprite || !target || !target.sprite) return;
        const slowMul = (unit.statusEffects && unit.statusEffects.slowUntil > sceneRef.time.now)
            ? (unit.statusEffects.slowMultiplier || 1)
            : 1;
        const speedTiles = (unit.movement.speedTilesPerSecond || 1) * slowMul;
        const speedPixels = speedTiles * window.grid.TILE_W * 0.5;
        const targetX = target.sprite.x;
        const targetY = target.sprite.y;
        const distanceToTarget = Phaser.Math.Distance.Between(unit.sprite.x, unit.sprite.y, targetX, targetY);
        const haltMicro = distanceToTarget < 0.65
            && ((isHeroEntity(unit) && target.category === 'enemy' && canHeroMeleeHitTarget(unit, target))
                || (unit.category === 'enemy' && canEnemyMeleeHitTarget(unit, target))
                || distanceToTarget < 0.14);
        if (haltMicro) {
            return;
        }
        const direction = resolveDirectionFromVector(unit, targetX - unit.sprite.x, targetY - unit.sprite.y);
        setUnitAnimationState(unit, 'walk', direction);
        unit.lastDirection = direction;
        const angle = Phaser.Math.Angle.Between(unit.sprite.x, unit.sprite.y, targetX, targetY);
        const moveDistance = speedPixels * deltaSeconds;
        const dx = Math.cos(angle) * moveDistance;
        const dy = Math.sin(angle) * moveDistance;
        const ox = unit.sprite.x;
        const oy = unit.sprite.y;
        let moved = false;
        if (tryMoveUnitToScreenPos(unit, ox + dx, oy + dy)) {
            moved = true;
        } else if (tryMoveUnitToScreenPos(unit, ox + dx, oy)) {
            moved = true;
        } else if (tryMoveUnitToScreenPos(unit, ox, oy + dy)) {
            moved = true;
        } else if (Math.abs(dx) > 1e-5 && Math.abs(dy) > 1e-5) {
            const len = Math.sqrt(dx * dx + dy * dy);
            const px = (-dy / len) * moveDistance;
            const py = (dx / len) * moveDistance;
            if (tryMoveUnitToScreenPos(unit, ox + px, oy + py)) {
                moved = true;
            } else if (tryMoveUnitToScreenPos(unit, ox - px, oy - py)) {
                moved = true;
            }
        }
        if (moved && (unit.unitHealthGraphics || unit.unitNameText || unit.turretAmmoGraphics)) {
            layoutUnitOverlays(unit);
        }
    }

    function processHeroAttack(hero, target) {
        const damagePerAttack = hero.combat.damagePerAttack || hero.combat.power || 10;
        if (!isValidNumber(target.health)) {
            target.health = target.maxHealth || 1;
        }
        target.health = Math.max(0, target.health - damagePerAttack);
        const heroDamageText = formatDamageText(damagePerAttack);
        if (heroDamageText) showCombatText(target, heroDamageText, '#ff9a9a');
        if (target.health <= 0) {
            triggerDeath(target, target.lastDirection || 'front');
        }

        hero.attackCount += 1;
        const selfDamage = hero.combat.selfDamagePerAttack || 0;
        if (selfDamage > 0) {
            hero.health = Math.max(0, hero.health - selfDamage);
            updateUnitHealthBar(hero);
            const selfDamageText = formatDamageText(selfDamage);
            if (selfDamageText) showCombatText(hero, selfDamageText, '#ffd37a');
            if (hero.health <= 0) {
                triggerDeath(hero, hero.lastDirection || 'front');
            }
        }
        if (hero.combat.maxAttacks > 0 && hero.attackCount >= hero.combat.maxAttacks) {
            triggerDeath(hero, hero.lastDirection || 'front');
        }
    }

    function getTurrets() {
        return elements.filter((item) => !item.isDead && !item.isDying && typeof item.type === 'string' && /^turret[_-]/.test(item.type));
    }

    function countAliveHealTurrets() {
        return getTurrets().filter((t) => String(t.type || '').replace(/-/g, '_') === 'turret_heal').length;
    }

    function getAliveHealTurrets() {
        return getTurrets().filter((t) => String(t.type || '').replace(/-/g, '_') === 'turret_heal');
    }

    /**
     * Aura de cura: reducao de dano ao castelo (soma por torre, limitada por cap do JSON).
     * Retorno para HUD e para dealDamage.
     */
    function getCastleHealAuraDefenseInfo() {
        const healTurrets = getAliveHealTurrets();
        const count = healTurrets.length;
        if (count === 0) {
            return { active: false, percent: 0, count: 0 };
        }
        let sum = 0;
        let cap = 50;
        healTurrets.forEach((t) => {
            const c = t.combat || {};
            const per = Number(c.damageReductionPercent);
            sum += Phaser.Math.Clamp(Number.isFinite(per) ? per : 12, 0, 99);
            const cCap = c.auraDamageReductionCap;
            if (Number.isFinite(cCap) && cCap > 0) {
                cap = Math.min(cap, cCap);
            }
        });
        const percent = Math.min(sum, cap);
        return { active: true, percent, count };
    }

    function getCastleElementRef() {
        return castleElement || getElementByType('castle');
    }

    function destroyCastleHealShield() {
        const c = getCastleElementRef();
        if (!c) return;
        if (c.healShieldAura && sceneRef?.tweens) {
            sceneRef.tweens.killTweensOf(c.healShieldAura);
            if (Array.isArray(c.healShieldAuraLayers)) {
                c.healShieldAuraLayers.forEach((layer) => sceneRef.tweens.killTweensOf(layer));
            }
        }
        c.healShieldAuraLayers = null;
        if (c.healShieldAura && c.healShieldAura.scene) {
            c.healShieldAura.destroy(true);
            c.healShieldAura = null;
        }
    }

    function positionCastleHealShield(castle) {
        const c = castle || getCastleElementRef();
        if (!c?.sprite?.scene || !c.healShieldAura) return;
        const sp = c.sprite;
        const lift = Math.max(24, sp.displayHeight * 0.42);
        c.healShieldAura.setPosition(sp.x, sp.y - lift * 0.75);
        c.healShieldAura.setDepth(sp.depth + 3);
    }

    function ensureCastleHealShield() {
        const c = getCastleElementRef();
        if (!c?.sprite?.scene || c.healShieldAura) return;
        const sp = c.sprite;
        const bw = Math.max(80, sp.displayWidth * 1.52);
        const bh = Math.max(56, sp.displayHeight * 0.98);
        const container = sceneRef.add.container(sp.x, sp.y);
        const layers = [];

        function pushFill(scale, color, fillAlpha, blendAdd) {
            const g = sceneRef.add.graphics();
            if (blendAdd) {
                g.setBlendMode(Phaser.BlendModes.ADD);
            }
            g.fillStyle(color, fillAlpha);
            g.fillEllipse(0, 0, bw * scale, bh * scale);
            container.add(g);
            layers.push(g);
        }

        pushFill(1.48, 0x4ad4c4, 0.055, true);
        pushFill(1.28, 0x7ae8d8, 0.065, false);
        pushFill(1.1, 0xaef8ee, 0.06, true);
        pushFill(0.94, 0xe8fffb, 0.045, true);

        c.healShieldAura = container;
        c.healShieldAuraLayers = layers;
        positionCastleHealShield(c);
        container.setScale(1);

        layers.forEach((g, i) => g.setAlpha(0.38 + i * 0.06));

        sceneRef.tweens.add({
            targets: container,
            scaleX: 1.022,
            scaleY: 1.022,
            duration: 3600,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut'
        });

        sceneRef.tweens.add({
            targets: layers,
            alpha: { from: 0.32, to: 0.78 },
            duration: 2000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut',
            stagger: { each: 280 }
        });
    }

    /** Aura unica (nao cumulativa) enquanto existir pelo menos uma torre de cura viva. */
    function syncCastleHealShieldState() {
        const castle = getCastleElementRef();
        if (!castle?.sprite?.scene) {
            destroyCastleHealShield();
            return;
        }
        if (countAliveHealTurrets() <= 0) {
            destroyCastleHealShield();
            return;
        }
        if (!castle.healShieldAura) {
            ensureCastleHealShield();
        } else {
            positionCastleHealShield(castle);
        }
    }

    function applyTurretBehavior(turret, enemiesInRange, deltaSeconds) {
        const turretType = String(turret.type || '').replace(/-/g, '_');
        turret.attackCooldown -= deltaSeconds;
        if (turretType === 'turret_heal') {
            if (turret.attackCooldown > 0) return;
            turret.attackCooldown = turret.combat.attackIntervalSec || 1;
            const healAmount = turret.combat.healPerTick || 8;
            window.alterarVida(healAmount);
            showCombatText(turret, `+${Math.round(healAmount)}`, '#9aff9f');
            playTurretAttackAnimation(turret);
            consumeTurretShot(turret);
            return;
        }

        const target = getNearestTarget(turret, enemiesInRange);
        if (!target) return;
        if (turret.attackCooldown > 0) return;
        turret.attackCooldown = turret.combat.attackIntervalSec || 0.6;

        if (turretType === 'turret_bomb') {
            const radius = turret.combat.aoeRadiusTiles ?? 1;
            const bombDamage = turret.combat.damagePerAttack || 25;
            const aimCol = target.col;
            const aimRow = target.row;
            launchAimedBombProjectile(turret, aimCol, aimRow, bombDamage, radius).catch((err) => console.warn(err));
        } else if (turretType === 'turret_ice') {
            const iceDamage = turret.combat.damagePerAttack || 10;
            target.health = Math.max(0, target.health - iceDamage);
            const iceText = formatDamageText(iceDamage);
            if (iceText) showCombatText(target, iceText, '#b2e8ff');
            if (target.health <= 0) {
                triggerDeath(target, target.lastDirection || 'front');
            } else {
                applyStatusEffect(target, {
                    type: 'slow',
                    multiplier: turret.combat.slowMultiplier || 0.5,
                    durationSec: turret.combat.slowDurationSec || 1.8
                });
            }
        } else if (turretType === 'turret_fire') {
            const fireHitDamage = turret.combat.damagePerAttack || 8;
            target.health = Math.max(0, target.health - fireHitDamage);
            const fireText = formatDamageText(fireHitDamage);
            if (fireText) showCombatText(target, fireText, '#ffbf7d');
            if (target.health <= 0) {
                triggerDeath(target, target.lastDirection || 'front');
            } else {
                applyStatusEffect(target, {
                    type: 'burn',
                    dps: turret.combat.burnDps || 12,
                    durationSec: turret.combat.burnDurationSec || 2.2
                });
            }
        } else {
            dealDamage(turret, target, deltaSeconds);
        }

        if (turretType !== 'turret_bomb') {
            firePlaceholderProjectile(turret, target, deltaSeconds, true);
        }
        playTurretAttackAnimation(turret);
        consumeTurretShot(turret);
    }

    function updateCombat(deltaSeconds) {
        updateStatusEffects(deltaSeconds);
        const aliveEnemies = getElementsByCategory('enemy');
        const aliveHeroes = getElementsByCategory('hero');
        const aliveStructures = getElementsByCategory('structure');
        const aliveTurrets = aliveStructures.filter((item) => typeof item.type === 'string' && /^turret[_-]/.test(item.type));

        const castleForEnemies = getElementByType('castle');

        aliveEnemies.forEach((enemy) => {
            const target = pickNearestEnemyAttackTarget(enemy, aliveHeroes, aliveTurrets, castleForEnemies);

            if (!target) return;

            if (canEnemyMeleeHitTarget(enemy, target)) {
                const direction = getDirectionToTarget(enemy, target, enemy.lastDirection || 'front');
                setUnitAnimationState(enemy, 'attack', direction);
                enemy.lastDirection = direction;
                dealDamage(enemy, target, deltaSeconds);
            } else {
                moveUnitTowardsTarget(enemy, target, deltaSeconds);
            }
        });

        aliveHeroes.forEach((hero) => {
            const target = getNearestTarget(hero, aliveEnemies);
            if (!target) return;

            if (canHeroMeleeHitTarget(hero, target)) {
                const direction = getDirectionToTarget(hero, target, hero.lastDirection || 'front');
                setUnitAnimationState(hero, 'attack', direction);
                hero.lastDirection = direction;
                hero.attackCooldown -= deltaSeconds;
                if (hero.attackCooldown <= 0) {
                    processHeroAttack(hero, target);
                    hero.attackCooldown = hero.combat.attackIntervalSec || 0.7;
                }
            } else {
                moveUnitTowardsTarget(hero, target, deltaSeconds);
            }
        });

        const turrets = getTurrets();
        turrets.forEach((turret) => {
            const possibleTargets = aliveEnemies.filter((enemy) => isInRange(turret, enemy, turret.combat.rangeTiles));
            applyTurretBehavior(turret, possibleTargets, deltaSeconds);
        });

        const hadDeaths = elements.some((element) => element.isDead);
        if (hadDeaths) {
            elements = elements.filter((element) => !element.isDead);
            rebuildGridOccupancy();
        }

        syncCastleHealShieldState();
    }

    async function createElementFromConfig(config, position, options = {}) {
        if (!sceneRef) {
            throw new Error('Cena nao inicializada');
        }
        const resolvedConfig = { ...config };
        if (resolvedConfig.spriteConfig) {
            resolvedConfig.sprite = await fetchJson(resolvedConfig.spriteConfig);
            if (!resolvedConfig.image && resolvedConfig.sprite.image) {
                resolvedConfig.image = resolvedConfig.sprite.image;
            }
        }

        if (!resolvedConfig.image) {
            const spriteVariant = pickRandomSprite(resolvedConfig);
            if (spriteVariant && spriteVariant.image) {
                resolvedConfig.image = spriteVariant.image;
                resolvedConfig.variantKey = spriteVariant.key || spriteVariant.image;
            }
        }
        const directionalAnimationConfig = (Array.isArray(resolvedConfig.variants) && resolvedConfig.variants.length > 0)
            ? await setupDirectionalAnimations(resolvedConfig)
            : null;
        if (directionalAnimationConfig) {
            resolvedConfig.variantKey = `${resolvedConfig.key}_${directionalAnimationConfig.variantId}`;
        }

        const baseKey = resolvedConfig.variantKey || resolvedConfig.key || resolvedConfig.type || 'dynamic';
        const key = `${baseKey}_${uniqueId}`;
        const tilesWide = resolvedConfig.size?.tilesWide || 1;
        const tilesHigh = resolvedConfig.size?.tilesHigh || 1;
        const type = resolvedConfig.type || resolvedConfig.key || 'element';

        const projectileConfig = resolvedConfig.projectile;
        if (projectileConfig?.image && projectileConfig?.texture && !sceneRef.textures.exists(projectileConfig.texture)) {
            try {
                await ensureTexture(sceneRef, projectileConfig.texture, projectileConfig.image);
            } catch (error) {
                console.warn('Falha ao carregar textura do projetil:', projectileConfig.image, error);
            }
        }

        const normalizedPosition = normalizePosition(position);
        if (!normalizedPosition) {
            throw new Error('Coordenadas invalidas. Use { col, row } ou [col, row].');
        }
        if (!isInsideGrid(normalizedPosition.col, normalizedPosition.row, tilesWide, tilesHigh)) {
            throw new Error('Elemento fora dos limites do grid.');
        }

        let sprite = null;
        if (directionalAnimationConfig) {
            sprite = sceneRef.add.sprite(0, 0, directionalAnimationConfig.walkSheetKey, 0);
            sprite.play(directionalAnimationConfig.walkAnimKey);
        } else if (resolvedConfig.image) {
            const imagePath = String(resolvedConfig.image).trim();
            try {
                await ensureTexture(sceneRef, key, imagePath);
                if (!sceneRef.textures.exists(key)) {
                    throw new Error(`Textura nao registada: ${key}`);
                }
                sprite = sceneRef.add.sprite(0, 0, key);
            } catch (error) {
                sprite = createFallbackSprite(resolvedConfig);
            }
        } else {
            sprite = createFallbackSprite(resolvedConfig);
        }

        const element = {
            id: `${type}_${uniqueId++}`,
            type,
            category: resolvedConfig.category || (type.startsWith('enemy_') ? 'enemy' : 'structure'),
            config: resolvedConfig,
            sprite,
            col: normalizedPosition.col,
            row: normalizedPosition.row,
            tilesWide,
            tilesHigh,
            maxHealth: resolvedConfig.stats?.maxHealth ?? resolvedConfig.stats?.health ?? (type === 'castle' ? window.gameState.maxHealth : 100),
            health: resolvedConfig.stats?.health ?? resolvedConfig.stats?.maxHealth ?? (type === 'castle' ? window.gameState.castleHealth : 100),
            movement: {
                speedTilesPerSecond: resolvedConfig.movement?.speedTilesPerSecond ?? 1
            },
            combat: {
                power: resolvedConfig.combat?.power ?? 0,
                dps: resolvedConfig.combat?.dps ?? 0,
                rangeTiles: resolvedConfig.combat?.rangeTiles ?? 1,
                damagePerAttack: resolvedConfig.combat?.damagePerAttack ?? 0,
                selfDamagePerAttack: resolvedConfig.combat?.selfDamagePerAttack ?? 0,
                maxAttacks: resolvedConfig.combat?.maxAttacks ?? 0,
                attackIntervalSec: resolvedConfig.combat?.attackIntervalSec ?? 0.7,
                aoeRadiusTiles: resolvedConfig.combat?.aoeRadiusTiles ?? 1,
                slowMultiplier: resolvedConfig.combat?.slowMultiplier ?? 0.5,
                slowDurationSec: resolvedConfig.combat?.slowDurationSec ?? 1.8,
                burnDps: resolvedConfig.combat?.burnDps ?? 0,
                burnDurationSec: resolvedConfig.combat?.burnDurationSec ?? 0,
                healPerTick: resolvedConfig.combat?.healPerTick ?? 0,
                maxShots: resolvedConfig.combat?.maxShots,
                damageReductionPercent: resolvedConfig.combat?.damageReductionPercent ?? 0,
                auraDamageReductionCap: resolvedConfig.combat?.auraDamageReductionCap
            },
            attackCooldown: 0,
            attackCount: 0,
            projectileCooldown: 0,
            isDead: false,
            isDying: false,
            lastDirection: (directionalAnimationConfig?.directionRowOrder && directionalAnimationConfig.directionRowOrder[0]) || 'front',
            statusEffects: {
                slowUntil: 0,
                slowMultiplier: 1,
                burnUntil: 0,
                burnDps: 0,
                nextBurnTextAt: 0,
                statusTextUntil: 0
            },
            animations: directionalAnimationConfig,
            currentAnimationKey: directionalAnimationConfig ? directionalAnimationConfig.walkAnimKey : null
        };

        layoutElement(element);
        if (isHeroEntity(element) || (typeof element.type === 'string' && /^turret[_-]/.test(element.type))) {
            const nameOpt = options.displayName ?? options.name ?? resolvedConfig.displayName ?? resolvedConfig.name;
            setupUnitWorldUi(element, nameOpt);
        }
        if (typeof element.type === 'string' && /^turret[_-]/.test(element.type)) {
            ensureTurretIdleAnimation(element);
        }

        elements.push(element);
        window.grid.markElementTiles(element.id, element.type, element.col, element.row, element.tilesWide, element.tilesHigh);

        if (element.type === 'castle') {
            castleElement = element;
        }

        return element;
    }

    async function addElement(configPath, position, spawnOptions = {}) {
        const config = await fetchJson(configPath);
        const type = String(config?.type || '');
        if (type.startsWith('enemy_')) {
            const aliveEnemyCount = elements.filter((item) => !item.isDead && !item.isDying && item.category === 'enemy').length;
            if (aliveEnemyCount >= PERF.maxEnemies) {
                return null;
            }
        }
        return createElementFromConfig(config, position, spawnOptions);
    }

    function repositionAll() {
        window.grid.clearOccupancy();
        elements.forEach((element) => {
            layoutElement(element);
            window.grid.markElementTiles(element.id, element.type, element.col, element.row, element.tilesWide, element.tilesHigh);
        });
    }

    function flashCastle() {
        if (!castleElement?.sprite?.scene) return;
        const sp = castleElement.sprite;
        const base = Number.isFinite(castleElement._castleLayoutScale)
            ? castleElement._castleLayoutScale
            : sp.scaleX;
        const active = sceneRef.tweens.getTweensOf(sp);
        if (active && active.length > 0) {
            return;
        }
        sp.setScale(base, base);
        sceneRef.tweens.add({
            targets: sp,
            scaleX: base * 1.0045,
            scaleY: base * 1.0045,
            duration: 260,
            yoyo: true,
            ease: 'Sine.InOut',
            onComplete: () => {
                if (castleElement?.sprite === sp && Number.isFinite(castleElement._castleLayoutScale)) {
                    sp.setScale(castleElement._castleLayoutScale, castleElement._castleLayoutScale);
                }
            }
        });
    }

    function destroyCastle() {
        if (!castleElement || !castleElement.sprite) return;
        destroyCastleHealShield();
        sceneRef.tweens.add({
            targets: castleElement.sprite,
            alpha: 0,
            scale: 0,
            duration: 500,
            onComplete: () => {
                if (castleElement && castleElement.sprite) castleElement.sprite.destroy();
            }
        });
    }

    async function create(scene, levelData) {
        sceneRef = scene;
        destroyCastleHealShield();
        elements = [];
        castleElement = null;
        window.grid.clearOccupancy();
        aiAccumulatorMs = 0;
        floatingTextCount = 0;

        const tasks = levelData.elements.map(async (elementDef) => {
            const configPath = await resolveLevelElementPath(elementDef);
            return addElement(configPath, elementDef.position || elementDef.coords, {
                displayName: elementDef.name ?? elementDef.displayName
            });
        });
        await Promise.all(tasks);
    }

    function update(deltaSeconds) {
        if (!sceneRef || !Array.isArray(elements) || elements.length === 0) return;
        aiAccumulatorMs += deltaSeconds * 1000;
        if (aiAccumulatorMs < PERF.aiTickMs) {
            return;
        }
        const stepSeconds = aiAccumulatorMs / 1000;
        aiAccumulatorMs = 0;
        updateCombat(stepSeconds);
    }

    function getCastle() {
        return getElementByType('castle');
    }

    return {
        create,
        addElement,
        resolveConfigPath: resolveToConfigPath,
        update,
        repositionAll,
        flashCastle,
        destroyCastle,
        getCastle,
        getCastleHealAuraDefenseInfo
    };
})();

window.add_element = async function(filePath, nameOrPosition, maybePosition) {
    if (!window.levelManager) throw new Error('levelManager indisponivel');
    const resolved = await window.levelManager.resolveConfigPath(filePath);
    let position;
    let spawnOptions = {};
    if (maybePosition !== undefined && typeof nameOrPosition === 'string') {
        const n = nameOrPosition.trim();
        if (n) spawnOptions.displayName = n;
        position = maybePosition;
    } else {
        position = nameOrPosition;
    }
    return window.levelManager.addElement(resolved, position, spawnOptions);
};

// Alias para testes no console com typo comum.
window.add_elemet = window.add_element;

window.castle = {
    aplicarDanoVisual(sofreuDano) {
        if (sofreuDano && window.levelManager) {
            window.levelManager.flashCastle();
        }
    },
    destruir() {
        if (window.levelManager) {
            window.levelManager.destroyCastle();
        }
    },
    get sprite() {
        const castle = window.levelManager ? window.levelManager.getCastle() : null;
        return castle ? castle.sprite : null;
    }
};