const app = {
    state: {
        originalImage: null, gridSize: 128, colorCount: 32, brightness: 100, contrast: 100,
        pixelData: [], palette: [], mode: 'color',
        zoom: { scale: 1, x: 0, y: 0, isDragging: false, dragStartX: 0, dragStartY: 0 }
    },

    init() { this.bindEvents(); this.bindZoomEvents(); },

    navigate(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${viewId}`).classList.add('active');
    },

    bindEvents() {
        document.getElementById('image-upload').addEventListener('change', (e) => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => { this.state.originalImage = img; document.getElementById('original-preview').src = ev.target.result; document.getElementById('preview-container').classList.remove('hidden'); };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        });

        // Sliders & Inputs
        ['brightness', 'contrast'].forEach(id => {
            document.getElementById(id).addEventListener('input', (e) => { document.getElementById(`val-${id}`).innerText = `${e.target.value}%`; this.state[id] = parseInt(e.target.value); });
        });
        document.getElementById('grid-size').addEventListener('change', (e) => { let v = Math.max(8, Math.min(256, parseInt(e.target.value) || 128)); e.target.value = v; this.state.gridSize = v; });
        document.getElementById('color-count').addEventListener('change', (e) => { let v = Math.max(2, Math.min(256, parseInt(e.target.value) || 32)); e.target.value = v; this.state.colorCount = v; });
    },

    async startProcessing() {
        if (!this.state.originalImage) return;
        this.navigate('process'); await this.sleep(300);
        this.processImage(); // Resize & Adjust
        this.quantizeColorsMaster(); // K-Means (Dynamic)
        this.renderCanvasMaster(); // High Res Render
        this.generateLegend();
        this.resetZoom();
        this.navigate('preview');
    },

    processImage() {
        const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
        const size = this.state.gridSize; canvas.width = size; canvas.height = size;
        ctx.filter = `brightness(${this.state.brightness}%) contrast(${this.state.contrast}%)`;
        ctx.drawImage(this.state.originalImage, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        this.state.pixelData = [];
        for (let i = 0; i < data.length; i += 4) { this.state.pixelData.push({ r: data[i], g: data[i+1], b: data[i+2] }); }
    },

    // --- High Accuracy K-Means Color Quantization ---
    quantizeColorsMaster() {
        let clusters = [];
        const uniqueColors = this.getUniqueColors(this.state.pixelData);
        
        // Initialize clusters (randomly pick from unique colors)
        const step = Math.max(1, Math.floor(uniqueColors.length / this.state.colorCount));
        for(let i=0; i<this.state.colorCount && i*step < uniqueColors.length; i++){
            clusters.push({...uniqueColors[i*step], points: []});
        }

        // Iterative K-Means (limited to 5 runs for perf vs accuracy balance)
        for (let iter = 0; iter < 5; iter++) {
            clusters.forEach(c => c.points = []);
            // Assign points to nearest cluster
            this.state.pixelData.forEach(p => {
                let minDst = Infinity; let target = clusters[0];
                clusters.forEach(c => {
                    let d = Math.pow(p.r-c.r,2)+Math.pow(p.g-c.g,2)+Math.pow(p.b-c.b,2);
                    if(d < minDst){ minDst = d; target = c; }
                });
                target.points.push(p);
            });
            // Update cluster centroids
            clusters.forEach(c => {
                if(c.points.length === 0) return;
                let r=0,g=0,b=0; c.points.forEach(p=>{r+=p.r;g+=p.g;b+=p.b;});
                c.r=Math.round(r/c.points.length);c.g=Math.round(g/c.points.length);c.b=Math.round(b/c.points.length);
            });
        }

        // Final Palette
        this.state.palette = clusters.filter(c=>c.points.length > 0).map((c, i) => ({
            id: i + 1, r: c.r, g: c.g, b: c.b, hex: this.rgbToHex(c.r, c.g, c.b), count: c.points.length
        }));

        // Map Pixels
        this.state.pixelData = this.state.pixelData.map(p => {
            let minDst = Infinity; let nearest = this.state.palette[0];
            this.state.palette.forEach(pal => {
                let d = Math.pow(p.r-pal.r,2)+Math.pow(p.g-pal.g,2)+Math.pow(p.b-pal.b,2);
                if(d < minDst){ minDst=d; nearest=pal; }
            });
            return nearest;
        });
        this.state.palette.sort((a,b)=>b.count-a.count).forEach((p,i)=>p.id=i+1);
    },

    // --- Master Rendering (High Quality) ---
    renderCanvasMaster() {
        const canvas = document.getElementById('art-canvas'); const ctx = canvas.getContext('2d');
        const size = this.state.gridSize; 
        const cellSize = 16; // Fixed large cell size for quality
        
        canvas.width = size * cellSize; canvas.height = size * cellSize;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 0.5; ctx.strokeStyle = 'rgba(0,0,0,0.15)'; // Light grid

        const showNumbers = (this.state.mode === 'number');

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const pixel = this.state.pixelData[y * size + x];
                const cx = x * cellSize; const cy = y * cellSize;
                
                if (!showNumbers) {
                    ctx.fillStyle = pixel.hex; ctx.fillRect(cx, cy, cellSize, cellSize);
                } else {
                    ctx.fillStyle = '#ffffff'; ctx.fillRect(cx, cy, cellSize, cellSize);
                    ctx.fillStyle = '#000000';
                    // Adaptive font size based on ID length
                    let fontSize = (pixel.id > 99) ? 7 : 9;
                    ctx.font = `${fontSize}px sans-serif`;
                    ctx.fillText(pixel.id, cx + (cellSize/2), cy + (cellSize/2));
                }
                ctx.strokeRect(cx, cy, cellSize, cellSize); // Draw grid
            }
        }
    },

    generateLegend() {
        const tbody = document.querySelector('#legend-table tbody'); tbody.innerHTML = '';
        this.state.palette.forEach(c => {
            tbody.innerHTML += `<tr><td><strong>${c.id}</strong></td><td><span class="color-swatch" style="background-color:${c.hex}"></span></td><td>${c.hex.toUpperCase()}</td></tr>`;
        });
    },

    toggleMode(m) { this.state.mode = m; document.getElementById('btn-color-mode').classList.toggle('active',m==='color'); document.getElementById('btn-number-mode').classList.toggle('active',m==='number'); this.renderCanvasMaster(); },

    // --- BESPOKE PAN & ZOOM ENGINE ---
    bindZoomEvents() {
        const container = document.getElementById('canvas-container');
        
        // Mouse Wheel Zoom
        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            this.zoomCanvas(delta, e.offsetX, e.offsetY);
        }, { passive: false });

        // Mouse Drag Panning
        container.addEventListener('mousedown', (e) => {
            this.state.zoom.isDragging = true;
            this.state.zoom.dragStartX = e.clientX - this.state.zoom.x;
            this.state.zoom.dragStartY = e.clientY - this.state.zoom.y;
            container.classList.add('grabbing');
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.state.zoom.isDragging) return;
            this.state.zoom.x = e.clientX - this.state.zoom.dragStartX;
            this.state.zoom.y = e.clientY - this.state.zoom.dragStartY;
            this.updateZoomTransform();
        });

        window.addEventListener('mouseup', () => {
            this.state.zoom.isDragging = false;
            container.classList.remove('grabbing');
        });
        
        // Basic Touch Panning (No pinch implemented in vanilla for brevity, but pan works)
        container.addEventListener('touchstart', (e) => {
            if(e.touches.length === 1) {
                this.state.zoom.isDragging = true;
                this.state.zoom.dragStartX = e.touches[0].clientX - this.state.zoom.x;
                this.state.zoom.dragStartY = e.touches[0].clientY - this.state.zoom.y;
            }
        });
        container.addEventListener('touchmove', (e) => {
            if(!this.state.zoom.isDragging || e.touches.length !== 1) return;
            this.state.zoom.x = e.touches[0].clientX - this.state.zoom.dragStartX;
            this.state.zoom.y = e.touches[0].clientY - this.state.zoom.dragStartY;
            this.updateZoomTransform();
        });
        container.addEventListener('touchend', () => this.state.zoom.isDragging = false);
    },

    zoomCanvas(delta, centerX, centerY) {
        const container = document.getElementById('canvas-container');
        if(centerX === undefined) centerX = container.offsetWidth / 2;
        if(centerY === undefined) centerY = container.offsetHeight / 2;

        const oldScale = this.state.zoom.scale;
        let newScale = oldScale + delta;
        newScale = Math.max(0.1, Math.min(4, newScale)); // Min 10%, Max 400%

        // Adjust focal point
        this.state.zoom.x = centerX - (centerX - this.state.zoom.x) * (newScale / oldScale);
        this.state.zoom.y = centerY - (centerY - this.state.zoom.y) * (newScale / oldScale);
        this.state.zoom.scale = newScale;
        
        this.updateZoomTransform();
    },

    resetZoom() {
        this.state.zoom = { scale: 1, x: 0, y: 0, isDragging: false, dragStartX: 0, dragStartY: 0 };
        this.updateZoomTransform();
    },

    updateZoomTransform() {
        const viewport = document.getElementById('canvas-viewport');
        viewport.style.transform = `translate(${this.state.zoom.x}px, ${this.state.zoom.y}px) scale(${this.state.zoom.scale})`;
    },

    downloadPNG() {
        const canvas = document.getElementById('art-canvas');
        const link = document.createElement('a');
        link.download = `Mariya's_Pixel_Art_${this.state.gridSize}x${this.state.gridSize}.png`;
        link.href = canvas.toDataURL("image/png", 1.0); // Maximum quality
        link.click();
    },

    // Utilities
    getUniqueColors(data) { const set = new Set(); const res = []; data.forEach(p=>{ const k=`${p.r},${p.g},${p.b}`; if(!set.has(k)){set.add(k); res.push(p);}}); return res; },
    rgbToHex(r, g, b) { return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1); },
    sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
};

document.addEventListener('DOMContentLoaded', () => app.init());
let deferredPrompt = null;

// Capture install event
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    // Show popup after small delay (premium feel)
    setTimeout(() => {
        document.getElementById('install-popup').classList.remove('hidden');
    }, 1500);
});

// Install button click
document.addEventListener('click', async (e) => {
    if (e.target.id === 'install-btn') {
        if (!deferredPrompt) return;

        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;

        if (choice.outcome === 'accepted') {
            console.log('Ho gaya app Install');
        }

        deferredPrompt = null;
        document.getElementById('install-popup').classList.add('hidden');
    }

    if (e.target.id === 'close-install') {
        document.getElementById('install-popup').classList.add('hidden');
    }
});
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js');
    });
}
