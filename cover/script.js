let CONFIG = { // Default config, will be overridden by JSON
    canvasWidth: window.innerWidth,
    canvasHeight: window.innerHeight,
    backgroundColor: '#111111',
    waveVisuals: {
        // positiveColorBase and negativeColorBase removed
        maxAmplitude: 1.0,
        gridResolution: 4,
        colormap: [ // Default colormap if config.json fails
            { "pos": 0.0,  "color": [0, 0, 255] },
            { "pos": 0.25, "color": [128, 0, 128] },
            { "pos": 0.5,  "color": [0, 0, 0] },
            { "pos": 0.75, "color": [255, 128, 0] },
            { "pos": 1.0,  "color": [255, 0, 0] }
        ]
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
    },
    debugMode: { // Default debug settings
        enabled: false,
        startPaused: false,
        timeSliderMax: 60
    }
};

const canvas = document.getElementById('waveCanvas');
const ctx = canvas.getContext('2d');

// UI Elements
let uiControlsContainer, pausePlayButton, timeSlider, timeValueDisplay, exportButton;

let allWavesEver = []; // Master list of all waves
let activeWaves = [];  // Waves currently active and to be rendered

let globalTime = 0;
let lastTimestamp = 0;
let isPaused = false;
let animationFrameId = null;

function getDistance(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
}

function setupCanvas() {
    // Use actual window dimensions if specified in config
    CONFIG.canvasWidth = (CONFIG.canvasWidth === "innerWidth" ? window.innerWidth : parseInt(CONFIG.canvasWidth, 10));
    CONFIG.canvasHeight = (CONFIG.canvasHeight === "innerHeight" ? window.innerHeight : parseInt(CONFIG.canvasHeight, 10));

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
    // Limit total waves ever created if necessary, or manage memory another way
    // For now, just add to a potentially growing list.
    if (allWavesEver.length > (CONFIG.interaction.maxWaves * 5) && CONFIG.debugMode.enabled) { // Heuristic limit in debug
        // console.warn("Large number of waves in allWavesEver, consider implications for long debug sessions.");
    }
     if (!CONFIG.debugMode.enabled && allWavesEver.length > CONFIG.interaction.maxWaves * 2) {
        // In non-debug mode, if not clearing allWavesEver periodically, it could grow.
        // A more robust solution might involve periodic cleanup of very old waves from allWavesEver
        // if they are far beyond any possible scrollback time.
        // For now, this example doesn't implement that cleanup.
        allWavesEver.shift(); // Simple FIFO if not in debug mode and list gets too long
    }


    allWavesEver.push({
        id: Date.now().toString(36) + Math.random().toString(36).substr(2), // Unique ID
        x: x,
        y: y,
        creationTime: startTime,
        // fc and sig are static per wave type, store them here
        fc: CONFIG.waveDynamics.carrierFrequency / 100.0,
        sig: CONFIG.waveDynamics.gaussianWidth,
    });
    // If in debug mode and paused, immediately update to show the new wave
    if (CONFIG.debugMode.enabled && isPaused) {
        updateAndFilterWaves();
        draw();
    }
}

function updateAndFilterWaves() {
    const newActiveWaves = [];

    for (const waveData of allWavesEver) {
        const age = globalTime - waveData.creationTime;

        if (age < 0) continue; // Wave hasn't started yet

        const currentWaveState = { ...waveData }; // Base properties
        currentWaveState.age = age;
        currentWaveState.currentTau = age * CONFIG.waveDynamics.waveSpeed;

        // Determine disintegration status for this frame
        currentWaveState.isDisintegrating = false;
        currentWaveState.timeSinceDisintegrationTrigger = 0;
        currentWaveState.disintegrationTransitionProgress = 0;

        if (CONFIG.disintegration.enabled && age > CONFIG.disintegration.startAgeSeconds) {
            currentWaveState.isDisintegrating = true;
            const disintegrationEffectActualStartTime = waveData.creationTime + CONFIG.disintegration.startAgeSeconds;
            currentWaveState.timeSinceDisintegrationTrigger = globalTime - disintegrationEffectActualStartTime;

            if (currentWaveState.timeSinceDisintegrationTrigger >= 0) {
                 currentWaveState.disintegrationTransitionProgress = Math.min(1, currentWaveState.timeSinceDisintegrationTrigger / CONFIG.disintegration.transitionDurationSeconds);
            } else {
                // This case (negative timeSinceDisintegrationTrigger) implies globalTime is before the trigger,
                // so it shouldn't be disintegrating yet. The age > startAgeSeconds check should handle this.
                // For safety, reset disintegration state if somehow triggered prematurely.
                currentWaveState.isDisintegrating = false;
            }
        }

        // Filtering logic: should this wave be kept for rendering?
        let keepThisWave = true;
        if (currentWaveState.isDisintegrating) {
            // Wave is removed once its transition is complete
            if (currentWaveState.timeSinceDisintegrationTrigger >= CONFIG.disintegration.transitionDurationSeconds) {
                keepThisWave = false;
            }
        } else { // Not disintegrating
            const corners = [
                { x: 0, y: 0 }, { x: canvas.width, y: 0 },
                { x: 0, y: canvas.height }, { x: canvas.width, y: canvas.height }
            ];
            let maxDistToCorner = 0;
            corners.forEach(corner => {
                maxDistToCorner = Math.max(maxDistToCorner, getDistance(waveData.x, waveData.y, corner.x, corner.y));
            });
            const innerEdgeLimit = currentWaveState.currentTau - waveData.sig * CONFIG.waveDynamics.waveRemovalEdgeFactor;
            if (innerEdgeLimit > maxDistToCorner) {
                keepThisWave = false;
            }
            if (age >= CONFIG.waveDynamics.waveLifetimeSeconds) {
                keepThisWave = false;
            }
        }

        if (keepThisWave) {
            newActiveWaves.push(currentWaveState);
        }
    }
    activeWaves = newActiveWaves;

    // Sort active waves by creation time if needed, though current rendering doesn't depend on order
    // activeWaves.sort((a, b) => a.creationTime - b.creationTime);
}


function getColorFromColormap(value, colormap) {
    // Ensure colormap is sorted by position
    // const sortedColormap = [...colormap].sort((a, b) => a.pos - b.pos);
    // Assuming colormap from config is already sorted for performance.
    // If not, uncomment and use sortedColormap.

    // Normalize value from -1 to 1 range (relative to maxAmplitude) to 0-1 for colormap lookup
    const normalizedPos = (value + 1) / 2;

    if (normalizedPos <= colormap[0].pos) {
        return colormap[0].color;
    }
    if (normalizedPos >= colormap[colormap.length - 1].pos) {
        return colormap[colormap.length - 1].color;
    }

    for (let i = 0; i < colormap.length - 1; i++) {
        const stop1 = colormap[i];
        const stop2 = colormap[i + 1];

        if (normalizedPos >= stop1.pos && normalizedPos <= stop2.pos) {
            const t = (normalizedPos - stop1.pos) / (stop2.pos - stop1.pos);
            if (isNaN(t) || !isFinite(t)) return stop1.color; // Avoid issues if stop1.pos === stop2.pos

            const r = Math.round(stop1.color[0] * (1 - t) + stop2.color[0] * t);
            const g = Math.round(stop1.color[1] * (1 - t) + stop2.color[1] * t);
            const b = Math.round(stop1.color[2] * (1 - t) + stop2.color[2] * t);
            return [r, g, b];
        }
    }
    return colormap[colormap.length - 1].color; // Should be caught by earlier checks
}


function draw() {
    ctx.fillStyle = CONFIG.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Update time display if in debug mode and elements exist
    if (CONFIG.debugMode.enabled && timeValueDisplay) {
        timeValueDisplay.textContent = `${globalTime.toFixed(2)}s`;
    }
    if (CONFIG.debugMode.enabled && timeSlider && !isPaused) { // Keep slider in sync when playing
        if (globalTime <= parseFloat(timeSlider.max)) {
            timeSlider.value = globalTime;
        }
    }


    const imageData = ctx.createImageData(canvas.width, canvas.height);
    const data = imageData.data;
    const gridRes = CONFIG.waveVisuals.gridResolution;

    // Draw standard wave patterns
    for (let gy = 0; gy < canvas.height; gy += gridRes) {
        for (let gx = 0; gx < canvas.width; gx += gridRes) {
            const pixelX = gx + gridRes / 2;
            const pixelY = gy + gridRes / 2;
            let totalValue = 0;

            activeWaves.forEach(wave => { // Iterate over activeWaves
                let waveAmplitudeFactor = 1.0;
                let corruptionFactor = 0;

                if (wave.isDisintegrating && CONFIG.disintegration.enabled) {
                    if (wave.timeSinceDisintegrationTrigger >= 0 && wave.timeSinceDisintegrationTrigger < CONFIG.disintegration.transitionDurationSeconds) {
                        waveAmplitudeFactor = 1.0 - wave.disintegrationTransitionProgress;
                        corruptionFactor = wave.disintegrationTransitionProgress;
                    } else if (wave.timeSinceDisintegrationTrigger >= CONFIG.disintegration.transitionDurationSeconds) {
                        waveAmplitudeFactor = 0; // Fully faded after transition
                    }
                }

                // Apply corruption by randomly skipping some contributions
                if (corruptionFactor > 0 && Math.random() < corruptionFactor * 0.75) { // 0.75 to make it less aggressive initially
                    // Skip this wave's contribution to this pixel due to corruption
                } else if (waveAmplitudeFactor > 0) {
                    const dx = pixelX - wave.x;
                    const dy = pixelY - wave.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    // currentTau is already on the wave object from updateAndFilterWaves
                    if (Math.abs(distance - wave.currentTau) < wave.sig * CONFIG.waveDynamics.waveRemovalEdgeFactor) {
                        totalValue += pulse(distance, wave.fc, wave.currentTau, wave.sig) * waveAmplitudeFactor;
                    }
                }
            });

            if (totalValue !== 0) {
                const normalizedIntensity = Math.max(-1, Math.min(1, totalValue / CONFIG.waveVisuals.maxAmplitude));
                const alpha = Math.min(1, Math.abs(totalValue) / CONFIG.waveVisuals.maxAmplitude); // Alpha based on magnitude

                const [r, g, b] = getColorFromColormap(normalizedIntensity, CONFIG.waveVisuals.colormap);

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
        activeWaves.forEach(wave => { // Iterate over activeWaves
            if (wave.isDisintegrating && wave.timeSinceDisintegrationTrigger >=0) {
                const timeInEffect = wave.timeSinceDisintegrationTrigger;

                let noiseOverallAlphaFactor = 0;
                let currentBlockSize = CONFIG.disintegration.noiseBlockSizeStart;
                const transitionProgress = wave.disintegrationTransitionProgress; // Already calculated

                if (timeInEffect < CONFIG.disintegration.transitionDurationSeconds) {
                    // Noise alpha fades in and then out during the transition period.
                    // Peaks at transitionProgress = 0.5
                    noiseOverallAlphaFactor = Math.sin(transitionProgress * Math.PI);

                    currentBlockSize = CONFIG.disintegration.noiseBlockSizeStart +
                                     (CONFIG.disintegration.noiseBlockSizeEnd - CONFIG.disintegration.noiseBlockSizeStart) * transitionProgress;
                } else {
                    // After transition duration, noise should be fully faded.
                    noiseOverallAlphaFactor = 0;
                }

                currentBlockSize = Math.max(1, Math.floor(currentBlockSize));

                if (noiseOverallAlphaFactor > 0) {
                    const currentEffectiveRadius = wave.currentTau; // Noise band centers on the wave's current theoretical radius

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

                        const randomVal = Math.random(); // This determines which side of the "zero" point for color
                        // For noise, we can simplify and pick a color based on a random intensity
                        // or tie it to the wave's original positive/negative nature if we stored that.
                        // Here, let's use a simplified approach: pick a random point on the colormap.
                        // Or, more consistently, use a fixed intensity for noise, e.g., slightly positive or negative.
                        // For now, let's use the randomVal to pick a side of the colormap.
                        const noiseIntensityForColor = (randomVal - 0.5) * 2 * 0.5; // e.g., map to -0.5 to 0.5 range

                        const [r,g,b] = getColorFromColormap(noiseIntensityForColor, CONFIG.waveVisuals.colormap);


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
    if (isPaused && CONFIG.debugMode.enabled) {
        return;
    }

    const actualDeltaTime = (timestamp - (lastTimestamp || timestamp)) / 1000;
    lastTimestamp = timestamp;

    if (!(isPaused && CONFIG.debugMode.enabled)) { // Should always be true if we passed the first check
        globalTime += actualDeltaTime;
    }

    updateAndFilterWaves();
    draw();

    animationFrameId = requestAnimationFrame(animationLoop);
}

function togglePause() {
    if (!CONFIG.debugMode.enabled) return;
    isPaused = !isPaused;
    pausePlayButton.textContent = isPaused ? "Play" : "Pause";

    if (!isPaused) {
        lastTimestamp = performance.now();
        animationFrameId = requestAnimationFrame(animationLoop);
    } else {
        cancelAnimationFrame(animationFrameId);
        // Ensure current state is drawn based on current globalTime
        updateAndFilterWaves();
        draw();
    }
}

function handleTimeSlider() {
    if (!CONFIG.debugMode.enabled) return;
    globalTime = parseFloat(timeSlider.value);
    // timeValueDisplay is updated in draw()

    // Manually update and draw since the animation loop might be paused
    // or to show immediate effect even if playing.
    updateAndFilterWaves();
    draw();
}

function exportCanvas() {
    let originalDisplay = null;
    if (CONFIG.debugMode.enabled && uiControlsContainer) {
        originalDisplay = uiControlsContainer.style.display;
        uiControlsContainer.style.display = 'none';
    }

    // Ensure the canvas is up-to-date with the current globalTime
    updateAndFilterWaves();
    draw();

    // Export as PNG
    const dataURL = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `wave_cover_time_${globalTime.toFixed(2)}.png`;
    link.href = dataURL;
    document.body.appendChild(link); // Required for Firefox
    link.click();
    document.body.removeChild(link);

    if (CONFIG.debugMode.enabled && uiControlsContainer && originalDisplay !== null) {
        uiControlsContainer.style.display = originalDisplay;
    }
    console.log(`Canvas exported as PNG for time: ${globalTime.toFixed(2)}s`);
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
        CONFIG.debugMode = {...CONFIG.debugMode, ...userConfig.debugMode}; // Load debugMode config

        console.log("Configuration loaded:", CONFIG);
    } catch (error) {
        console.warn("Could not load config.json, using default configuration.", error);
    }

    // Proceed with initialization using the (potentially updated) CONFIG
    setupCanvas();
    document.body.style.backgroundColor = CONFIG.backgroundColor;

    // Initialize UI Controls if debug mode is enabled
    if (CONFIG.debugMode.enabled) {
        uiControlsContainer = document.getElementById('uiControls');
        pausePlayButton = document.getElementById('pausePlayButton');
        timeSlider = document.getElementById('timeSlider');
        timeValueDisplay = document.getElementById('timeValueDisplay');
        exportButton = document.getElementById('exportButton');

        uiControlsContainer.style.display = 'flex';
        timeSlider.max = CONFIG.debugMode.timeSliderMax || 60;
        timeSlider.value = globalTime; // Initialize slider position
        timeValueDisplay.textContent = `${globalTime.toFixed(2)}s`;

        pausePlayButton.addEventListener('click', togglePause);
        timeSlider.addEventListener('input', handleTimeSlider);
        exportButton.addEventListener('click', exportCanvas);

        if (CONFIG.debugMode.startPaused) {
            isPaused = true;
            pausePlayButton.textContent = "Play";
        }
    }


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
    // If starting paused, do an initial calculation and draw
    if (isPaused && CONFIG.debugMode.enabled) {
        updateAndFilterWaves();
        draw();
    } else { // If not starting paused, start the animation loop
        animationFrameId = requestAnimationFrame(animationLoop);
    }
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    loadConfigAndInitialize();
});

window.addEventListener('resize', () => {
    // Re-evaluate canvas dimensions based on config/window size
    CONFIG.canvasWidth = (CONFIG.canvasWidth === "innerWidth" || typeof CONFIG.canvasWidth === 'number' && CONFIG.canvasWidth === window.innerWidth ? window.innerWidth : parseInt(CONFIG.canvasWidth, 10));
    CONFIG.canvasHeight = (CONFIG.canvasHeight === "innerHeight" || typeof CONFIG.canvasHeight === 'number' && CONFIG.canvasHeight === window.innerHeight ? window.innerHeight : parseInt(CONFIG.canvasHeight, 10));
    setupCanvas();
    // When resizing, if paused, re-filter and redraw the current state
    if (isPaused && CONFIG.debugMode.enabled) {
        updateAndFilterWaves();
        draw();
    }
});
