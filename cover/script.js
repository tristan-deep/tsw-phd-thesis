let CONFIG = { // Default config, will be overridden by JSON
    canvasWidth: window.innerWidth,
    canvasHeight: window.innerHeight,
    backgroundColor: '#111111',
    waveVisuals: {
        positiveColorBase: [0, 255, 255],
        negativeColorBase: [255, 0, 255],
        maxAmplitude: 1.0,
        gridResolution: 4,
    },
    waveDynamics: {
        carrierFrequency: 5,
        gaussianWidth: 20,
        waveSpeed: 50,
        waveLifetimeSeconds: 25,
        waveRemovalEdgeFactor: 4,
    },
    interaction: {
        interactive: true,
        maxWaves: 10,
        numInitialWaves: 2,
    },
    disintegration: {
        enabled: true,
        startAgeSeconds: 8,
        transitionDurationSeconds: 5,
        noisePersistenceDurationSeconds: 3,
        noiseBlockSizeStart: 5, // Renamed from noiseBlockSize
        noiseBlockSizeEnd: 15,  // New: for gradual block size increase
        numNoiseBlocksPerWave: 250,
        noiseMaxBlockAlpha: 0.6,
        noiseSpreadFactor: 2.5,
    }
};

const canvas = document.getElementById('waveCanvas');
const ctx = canvas.getContext('2d');

let waves = [];
let globalTime = 0;
let lastTimestamp = 0;

function getDistance(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
}

function setupCanvas() {
    // Use actual window dimensions if specified in config
    CONFIG.canvasWidth = (CONFIG.canvasWidth === "innerWidth" ? window.innerWidth : CONFIG.canvasWidth);
    CONFIG.canvasHeight = (CONFIG.canvasHeight === "innerHeight" ? window.innerHeight : CONFIG.canvasHeight);

    canvas.width = CONFIG.canvasWidth;
    canvas.height = CONFIG.canvasHeight;
    ctx.fillStyle = CONFIG.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// Gaussian-modulated sinusoidal pulse function
function pulse(d, fc, tau, sig) {
    if (sig === 0) return 0;
    const envelope = Math.exp(-0.5 * Math.pow((d - tau) / sig, 2));
    const sinusoid = Math.sin(2 * Math.PI * fc * (d - tau));
    return envelope * sinusoid;
}

function addWave(x, y, startTime = globalTime) {
    if (waves.length >= CONFIG.interaction.maxWaves) {
        waves.shift();
    }
    waves.push({
        x: x,
        y: y,
        creationTime: startTime,
        fc: CONFIG.waveDynamics.carrierFrequency / 100.0,
        sig: CONFIG.waveDynamics.gaussianWidth,
        isDisintegrating: false,
        disintegrationEffectStartTime: 0,
        tauAtDisintegration: 0,
    });
}

function updateWaves(deltaTime) {
    globalTime += deltaTime;

    waves = waves.filter(wave => {
        const age = globalTime - wave.creationTime;
        const currentTau = age * CONFIG.waveDynamics.waveSpeed;

        if (CONFIG.disintegration.enabled && !wave.isDisintegrating && age > CONFIG.disintegration.startAgeSeconds) {
            wave.isDisintegrating = true;
            wave.disintegrationEffectStartTime = globalTime;
            wave.tauAtDisintegration = currentTau; // Capture tau when disintegration starts
        }

        if (wave.isDisintegrating) {
            // Remove after wave has transitioned and noise has persisted and faded
            const timeSinceDisintegrationStart = globalTime - wave.disintegrationEffectStartTime;
            const totalDisintegrationEffectDuration = CONFIG.disintegration.transitionDurationSeconds + CONFIG.disintegration.noisePersistenceDurationSeconds;
            return timeSinceDisintegrationStart < totalDisintegrationEffectDuration;
        } else {
            // Original removal logic for non-disintegrating waves
            const corners = [
                { x: 0, y: 0 }, { x: canvas.width, y: 0 },
                { x: 0, y: canvas.height }, { x: canvas.width, y: canvas.height }
            ];
            let maxDistToCorner = 0;
            corners.forEach(corner => {
                maxDistToCorner = Math.max(maxDistToCorner, getDistance(wave.x, wave.y, corner.x, corner.y));
            });

            const innerEdgeLimit = currentTau - wave.sig * CONFIG.waveDynamics.waveRemovalEdgeFactor;
            if (innerEdgeLimit > maxDistToCorner) {
                return false;
            }
            return age < CONFIG.waveDynamics.waveLifetimeSeconds;
        }
    });
}

function draw() {
    ctx.fillStyle = CONFIG.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const imageData = ctx.createImageData(canvas.width, canvas.height);
    const data = imageData.data;
    const gridRes = CONFIG.waveVisuals.gridResolution;

    // Draw standard wave patterns
    for (let gy = 0; gy < canvas.height; gy += gridRes) {
        for (let gx = 0; gx < canvas.width; gx += gridRes) {
            const pixelX = gx + gridRes / 2;
            const pixelY = gy + gridRes / 2;
            let totalValue = 0;

            waves.forEach(wave => {
                let waveAmplitudeFactor = 1.0;
                if (wave.isDisintegrating && CONFIG.disintegration.enabled) {
                    const timeSinceDisintegrationStart = globalTime - wave.disintegrationEffectStartTime;
                    waveAmplitudeFactor = 1.0 - Math.min(1, timeSinceDisintegrationStart / CONFIG.disintegration.transitionDurationSeconds);
                }

                if (waveAmplitudeFactor > 0) { // Only calculate if wave still has presence
                    const dx = pixelX - wave.x;
                    const dy = pixelY - wave.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const currentTau = (globalTime - wave.creationTime) * CONFIG.waveDynamics.waveSpeed;

                    if (Math.abs(distance - currentTau) < wave.sig * CONFIG.waveDynamics.waveRemovalEdgeFactor) {
                        totalValue += pulse(distance, wave.fc, currentTau, wave.sig) * waveAmplitudeFactor;
                    }
                }
            });

            if (totalValue !== 0) {
                const alpha = Math.min(1, Math.abs(totalValue) / CONFIG.waveVisuals.maxAmplitude);
                let r, g, b;

                if (totalValue > 0) [r, g, b] = CONFIG.waveVisuals.positiveColorBase;
                else [r, g, b] = CONFIG.waveVisuals.negativeColorBase;

                for (let offsetY = 0; offsetY < gridRes; offsetY++) {
                    for (let offsetX = 0; offsetX < gridRes; offsetX++) {
                        const canvasX = gx + offsetX;
                        const canvasY = gy + offsetY;
                        if (canvasX < canvas.width && canvasY < canvas.height) {
                            const index = (canvasY * canvas.width + canvasX) * 4;
                            data[index] = r;
                            data[index + 1] = g;
                            data[index + 2] = b;
                            data[index + 3] = Math.floor(alpha * 255);
                        }
                    }
                }
            }
        }
    }
    ctx.putImageData(imageData, 0, 0);

    // Draw disintegrating wave noise on top
    if (CONFIG.disintegration.enabled) {
        waves.forEach(wave => {
            if (wave.isDisintegrating) {
                const timeSinceDisintegrationStart = globalTime - wave.disintegrationEffectStartTime;

                let noiseOverallAlphaFactor = 0;
                let currentBlockSize = CONFIG.disintegration.noiseBlockSizeStart;
                const transitionProgress = Math.min(1, timeSinceDisintegrationStart / CONFIG.disintegration.transitionDurationSeconds);

                // Fade-in phase (during wave transition)
                if (timeSinceDisintegrationStart < CONFIG.disintegration.transitionDurationSeconds) {
                    noiseOverallAlphaFactor = transitionProgress;
                    currentBlockSize = CONFIG.disintegration.noiseBlockSizeStart +
                                     (CONFIG.disintegration.noiseBlockSizeEnd - CONFIG.disintegration.noiseBlockSizeStart) * transitionProgress;
                }
                // Persistence and fade-out phase (after wave has transitioned)
                else if (timeSinceDisintegrationStart < CONFIG.disintegration.transitionDurationSeconds + CONFIG.disintegration.noisePersistenceDurationSeconds) {
                    const timeIntoNoisePersistence = timeSinceDisintegrationStart - CONFIG.disintegration.transitionDurationSeconds;
                    noiseOverallAlphaFactor = 1.0 - (timeIntoNoisePersistence / CONFIG.disintegration.noisePersistenceDurationSeconds);
                    currentBlockSize = CONFIG.disintegration.noiseBlockSizeEnd; // Keep end block size during persistence
                }

                currentBlockSize = Math.max(1, Math.floor(currentBlockSize)); // Ensure block size is at least 1 and an integer

                if (noiseOverallAlphaFactor > 0) {
                    const waveCurrentTau = (globalTime - wave.creationTime) * CONFIG.waveDynamics.waveSpeed;
                    const currentEffectiveRadius = waveCurrentTau;

                    const bandHalfWidth = (wave.sig * CONFIG.disintegration.noiseSpreadFactor) / 2;

                    for (let i = 0; i < CONFIG.disintegration.numNoiseBlocksPerWave; i++) {
                        const angle = Math.random() * 2 * Math.PI;
                        const dist = currentEffectiveRadius + (Math.random() - 0.5) * 2 * bandHalfWidth;

                        const nx = wave.x + Math.cos(angle) * dist;
                        const ny = wave.y + Math.sin(angle) * dist;

                        // Use currentBlockSize for snapping and drawing
                        const blockX = Math.floor(nx / currentBlockSize) * currentBlockSize;
                        const blockY = Math.floor(ny / currentBlockSize) * currentBlockSize;

                        if (blockX < 0 || blockX + currentBlockSize > canvas.width || blockY < 0 || blockY + currentBlockSize > canvas.height) continue;

                        const randomVal = Math.random();
                        let r, g, b;
                        if (randomVal > 0.5) [r,g,b] = CONFIG.waveVisuals.positiveColorBase;
                        else [r,g,b] = CONFIG.waveVisuals.negativeColorBase;

                        const radialEnvelope = Math.exp(-0.5 * Math.pow((dist - currentEffectiveRadius) / bandHalfWidth, 2));
                        const finalAlpha = noiseOverallAlphaFactor * radialEnvelope * CONFIG.disintegration.noiseMaxBlockAlpha * (0.5 + randomVal * 0.5);

                        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(1, finalAlpha)})`;
                        ctx.fillRect(blockX, blockY, currentBlockSize, currentBlockSize);
                    }
                }
            }
        });
    }
}

function animationLoop(timestamp) {
    const deltaTime = (timestamp - (lastTimestamp || timestamp)) / 1000; // seconds
    lastTimestamp = timestamp;

    updateWaves(deltaTime);
    draw();

    requestAnimationFrame(animationLoop);
}

// Configuration loading and initialization
async function loadConfigAndInitialize() {
    try {
        const response = await fetch('config.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const userConfig = await response.json();
        // Deep merge userConfig into CONFIG (simple version, for more complex use a library or a proper deep merge)
        CONFIG = {...CONFIG, ...userConfig};
        CONFIG.waveVisuals = {...CONFIG.waveVisuals, ...userConfig.waveVisuals};
        CONFIG.waveDynamics = {...CONFIG.waveDynamics, ...userConfig.waveDynamics};
        CONFIG.interaction = {...CONFIG.interaction, ...userConfig.interaction};
        CONFIG.disintegration = {...CONFIG.disintegration, ...userConfig.disintegration};

        console.log("Configuration loaded:", CONFIG);
    } catch (error) {
        console.warn("Could not load config.json, using default configuration.", error);
    }

    // Proceed with initialization using the (potentially updated) CONFIG
    setupCanvas();
    document.body.style.backgroundColor = CONFIG.backgroundColor;

    if (CONFIG.interaction.interactive) {
        canvas.addEventListener('click', (event) => {
            const rect = canvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            addWave(x, y);
        });
    } else {
        for (let i = 0; i < CONFIG.interaction.numInitialWaves; i++) {
            const randX = Math.random() * (CONFIG.canvasWidth || window.innerWidth);
            const randY = Math.random() * (CONFIG.canvasHeight || window.innerHeight);
            const startTimeOffset = (i / CONFIG.interaction.numInitialWaves) * 2.0;
            addWave(randX, randY, startTimeOffset);
        }
    }

    lastTimestamp = performance.now();
    requestAnimationFrame(animationLoop);
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    loadConfigAndInitialize();
});

window.addEventListener('resize', () => {
    // Re-evaluate canvas dimensions based on config/window size
    CONFIG.canvasWidth = (CONFIG.canvasWidth === "innerWidth" || CONFIG.canvasWidth === window.innerWidth ? window.innerWidth : parseInt(CONFIG.canvasWidth, 10));
    CONFIG.canvasHeight = (CONFIG.canvasHeight === "innerHeight" || CONFIG.canvasHeight === window.innerHeight ? window.innerHeight : parseInt(CONFIG.canvasHeight, 10));
    setupCanvas();
});
