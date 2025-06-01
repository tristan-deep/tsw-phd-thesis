const CONFIG = {
    interactive: true, // Set to false for non-interactive mode with initial random waves
    canvasWidth: window.innerWidth,
    canvasHeight: window.innerHeight,
    backgroundColor: '#111111', // Dark background
    positiveColorBase: [0, 255, 255], // RGB for positive values (cyan)
    negativeColorBase: [255, 0, 255], // RGB for negative values (magenta)
    
    // Wave properties
    carrierFrequency: 5,   // fc: cycles per 100 units of distance
    gaussianWidth: 20,     // sig: width of the Gaussian envelope in units
    waveSpeed: 50,         // speed: units per second for tau increase
    
    maxAmplitude: 1.0,     // Used for scaling color intensity
    gridResolution: 4,     // Size of grid cells for rendering (pixels)
    maxWaves: 20,          // Maximum number of waves on screen
    waveLifetimeSeconds: 15 // How long a wave lives before being removed
};

const canvas = document.getElementById('waveCanvas');
const ctx = canvas.getContext('2d');

let waves = [];
let globalTime = 0;
let lastTimestamp = 0;

function setupCanvas() {
    canvas.width = CONFIG.canvasWidth;
    canvas.height = CONFIG.canvasHeight;
    ctx.fillStyle = CONFIG.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// Gaussian-modulated sinusoidal pulse function
function pulse(d, fc, tau, sig) {
    // d: Radial distance
    // fc: Carrier frequency (actual, scaled)
    // tau: Time delay (pulse offset / current radius)
    // sig: Gaussian width
    if (sig === 0) return 0; // Avoid division by zero
    const envelope = Math.exp(-0.5 * Math.pow((d - tau) / sig, 2));
    const sinusoid = Math.sin(2 * Math.PI * fc * (d - tau));
    return envelope * sinusoid;
}

function addWave(x, y, startTime = globalTime) {
    if (waves.length >= CONFIG.maxWaves) {
        waves.shift(); // Remove the oldest wave if max is reached
    }
    waves.push({
        x: x,
        y: y,
        creationTime: startTime,
        // Scale fc from cycles/100units to cycles/unit
        fc: CONFIG.carrierFrequency / 100.0, 
        sig: CONFIG.gaussianWidth
    });
}

function updateWaves(deltaTime) {
    globalTime += deltaTime;

    waves = waves.filter(wave => {
        const age = globalTime - wave.creationTime;
        const currentTau = age * CONFIG.waveSpeed;
        // Remove wave if it's too old or expanded too far
        return age < CONFIG.waveLifetimeSeconds && currentTau < Math.max(canvas.width, canvas.height) + wave.sig * 5;
    });
}

function draw() {
    // Clear canvas with background color
    ctx.fillStyle = CONFIG.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const imageData = ctx.createImageData(canvas.width, canvas.height);
    const data = imageData.data;

    for (let gy = 0; gy < canvas.height; gy += CONFIG.gridResolution) {
        for (let gx = 0; gx < canvas.width; gx += CONFIG.gridResolution) {
            
            const pixelX = gx + CONFIG.gridResolution / 2;
            const pixelY = gy + CONFIG.gridResolution / 2;
            let totalValue = 0;

            waves.forEach(wave => {
                const dx = pixelX - wave.x;
                const dy = pixelY - wave.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const currentTau = (globalTime - wave.creationTime) * CONFIG.waveSpeed;
                
                // Optimization: only calculate if roughly within the pulse's main area
                if (Math.abs(distance - currentTau) < wave.sig * 4) { // Check within ~4 sigma
                    totalValue += pulse(distance, wave.fc, currentTau, wave.sig);
                }
            });

            if (totalValue !== 0) {
                const alpha = Math.min(1, Math.abs(totalValue) / CONFIG.maxAmplitude);
                let r, g, b;

                if (totalValue > 0) {
                    [r, g, b] = CONFIG.positiveColorBase;
                } else {
                    [r, g, b] = CONFIG.negativeColorBase;
                }

                // Fill a grid cell
                for (let offsetY = 0; offsetY < CONFIG.gridResolution; offsetY++) {
                    for (let offsetX = 0; offsetX < CONFIG.gridResolution; offsetX++) {
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
}

function animationLoop(timestamp) {
    const deltaTime = (timestamp - (lastTimestamp || timestamp)) / 1000; // seconds
    lastTimestamp = timestamp;

    updateWaves(deltaTime);
    draw();

    requestAnimationFrame(animationLoop);
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    setupCanvas();
    document.body.style.backgroundColor = CONFIG.backgroundColor; // Ensure body bg matches

    if (CONFIG.interactive) {
        canvas.addEventListener('click', (event) => {
            const rect = canvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            addWave(x, y);
        });
    } else {
        // Add two initial random waves if not interactive
        addWave(canvas.width * 0.3, canvas.height * 0.5, 0);
        addWave(canvas.width * 0.7, canvas.height * 0.5, 0.5); // Slightly offset start time
    }
    
    lastTimestamp = performance.now();
    requestAnimationFrame(animationLoop);
});

window.addEventListener('resize', () => {
    CONFIG.canvasWidth = window.innerWidth;
    CONFIG.canvasHeight = window.innerHeight;
    setupCanvas();
});
