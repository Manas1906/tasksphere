import { socket } from './websocket';

/**
 * WhiteboardView manages the collaborative canvas.
 * It uses coordinate normalization to support responsive screens of different aspect ratios.
 */
export class WhiteboardView {
  constructor() {
    this.container = null;
    this.canvas = null;
    this.ctx = null;
    this.isDrawing = false;
    this.currentTool = 'pen'; // pen | eraser
    this.currentColor = '#6366f1';
    this.currentSize = 4;
    this.lastPos = { x: 0, y: 0 };
    this._resizeHandler = null;
    this._socketSubscription = null;
  }

  render() {
    const mainContainer = document.getElementById('mainContainer');
    if (!mainContainer) return;

    mainContainer.innerHTML = `
      <div class="whiteboard-view-container">
        <div class="whiteboard-header">
          <div class="whiteboard-title-group">
            <h2 class="whiteboard-title">Collaborative Canvas</h2>
            <span class="whiteboard-subtitle">Draw diagrams and flows with your team in real-time</span>
          </div>
          <div class="whiteboard-toolbar">
            <div class="whiteboard-tool-group">
              <button id="toolPen" class="whiteboard-tool-btn whiteboard-tool-btn--active" title="Pen">✏️ Pen</button>
              <button id="toolEraser" class="whiteboard-tool-btn" title="Eraser">🧹 Eraser</button>
            </div>
            
            <div class="whiteboard-tool-group" style="gap: 8px;">
              <span class="whiteboard-label">Size:</span>
              <input type="range" id="brushSize" min="1" max="25" value="4" class="whiteboard-slider">
              <span id="brushSizeVal" class="whiteboard-slider-val">4px</span>
            </div>

            <div class="whiteboard-tool-group">
              <div class="whiteboard-color-picker">
                <button class="whiteboard-color-btn whiteboard-color-btn--active" data-color="#6366f1" style="background-color: #6366f1;"></button>
                <button class="whiteboard-color-btn" data-color="#10b981" style="background-color: #10b981;"></button>
                <button class="whiteboard-color-btn" data-color="#3b82f6" style="background-color: #3b82f6;"></button>
                <button class="whiteboard-color-btn" data-color="#ef4444" style="background-color: #ef4444;"></button>
                <button class="whiteboard-color-btn" data-color="#f59e0b" style="background-color: #f59e0b;"></button>
                <button class="whiteboard-color-btn" data-color="#a855f7" style="background-color: #a855f7;"></button>
                <button class="whiteboard-color-btn" data-color="#ffffff" style="background-color: #ffffff; border: 1px solid var(--border-color);"></button>
              </div>
            </div>

            <button id="clearWhiteboardBtn" class="btn btn--outline" style="color: var(--accent-rose); border-color: var(--accent-rose);">Clear Canvas</button>
          </div>
        </div>
        <div class="whiteboard-canvas-wrapper" id="canvasWrapper">
          <canvas id="whiteboardCanvas"></canvas>
        </div>
      </div>
    `;

    this.container = mainContainer.querySelector('.whiteboard-view-container');
    this.canvas = document.getElementById('whiteboardCanvas');
    this.ctx = this.canvas.getContext('2d');

    this.setupCanvasSize();
    this.bindEvents();
    this.subscribeDrawings();
  }

  setupCanvasSize() {
    const wrapper = document.getElementById('canvasWrapper');
    if (!wrapper || !this.canvas) return;

    const rect = wrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Cache current canvas content before scaling
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.canvas.width;
    tempCanvas.height = this.canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(this.canvas, 0, 0);

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    this.ctx.scale(dpr, dpr);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    this.ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width / dpr, tempCanvas.height / dpr);
  }

  bindEvents() {
    this._resizeHandler = () => this.setupCanvasSize();
    window.addEventListener('resize', this._resizeHandler);

    this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
    this.canvas.addEventListener('mousemove', (e) => this.draw(e));
    this.canvas.addEventListener('mouseup', () => this.stopDrawing());
    this.canvas.addEventListener('mouseleave', () => this.stopDrawing());

    // Mobile touch events
    this.canvas.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      this.canvas.dispatchEvent(mouseEvent);
      e.preventDefault();
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      this.canvas.dispatchEvent(mouseEvent);
      e.preventDefault();
    }, { passive: false });

    this.canvas.addEventListener('touchend', () => {
      const mouseEvent = new MouseEvent('mouseup', {});
      this.canvas.dispatchEvent(mouseEvent);
    });

    document.getElementById('toolPen').onclick = () => this.setTool('pen');
    document.getElementById('toolEraser').onclick = () => this.setTool('eraser');

    const sizeSlider = document.getElementById('brushSize');
    const sizeVal = document.getElementById('brushSizeVal');
    sizeSlider.oninput = () => {
      this.currentSize = sizeSlider.value;
      sizeVal.textContent = `${this.currentSize}px`;
    };

    this.container.querySelectorAll('.whiteboard-color-btn').forEach(btn => {
      btn.onclick = () => {
        this.container.querySelectorAll('.whiteboard-color-btn').forEach(b => b.classList.remove('whiteboard-color-btn--active'));
        btn.classList.add('whiteboard-color-btn--active');
        this.currentColor = btn.getAttribute('data-color');
        this.setTool('pen');
      };
    });

    document.getElementById('clearWhiteboardBtn').onclick = () => {
      if (confirm('Clear the whiteboard for all users?')) {
        this.clearLocalCanvas();
        this.broadcastClear();
      }
    };
  }

  setTool(tool) {
    this.currentTool = tool;
    document.getElementById('toolPen').classList.toggle('whiteboard-tool-btn--active', tool === 'pen');
    document.getElementById('toolEraser').classList.toggle('whiteboard-tool-btn--active', tool === 'eraser');
  }

  startDrawing(e) {
    this.isDrawing = true;
    this.lastPos = this.getRelativePos(e);
  }

  draw(e) {
    if (!this.isDrawing) return;

    const currentPos = this.getRelativePos(e);
    const drawColor = this.currentTool === 'eraser' ? 'eraser' : this.currentColor;
    const drawSize = this.currentSize;

    this.drawSegment(this.lastPos.x, this.lastPos.y, currentPos.x, currentPos.y, drawColor, drawSize);
    this.broadcastDrawSegment(this.lastPos, currentPos, drawColor, drawSize);

    this.lastPos = currentPos;
  }

  stopDrawing() {
    this.isDrawing = false;
  }

  getRelativePos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  drawSegment(x0, y0, x1, y1, color, size) {
    this.ctx.beginPath();
    
    if (color === 'eraser') {
      this.ctx.globalCompositeOperation = 'destination-out';
    } else {
      this.ctx.globalCompositeOperation = 'source-over';
    }

    let finalColor = color;
    if (color.startsWith('var(')) {
      finalColor = getComputedStyle(document.documentElement).getPropertyValue(color.substring(4, color.length - 1).trim());
    }

    this.ctx.strokeStyle = finalColor;
    this.ctx.lineWidth = size;
    this.ctx.moveTo(x0, y0);
    this.ctx.lineTo(x1, y1);
    this.ctx.stroke();
    this.ctx.closePath();

    // Restore standard drawing mode
    this.ctx.globalCompositeOperation = 'source-over';
  }

  clearLocalCanvas() {
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  broadcastDrawSegment(pos0, pos1, color, size) {
    if (!socket.connected) return;

    const rect = this.canvas.getBoundingClientRect();
    const payload = {
      type: 'draw',
      x0: pos0.x / rect.width,
      y0: pos0.y / rect.height,
      x1: pos1.x / rect.width,
      y1: pos1.y / rect.height,
      color: color,
      size: size
    };

    socket.send('/app/whiteboard.draw', payload);
  }

  broadcastClear() {
    if (!socket.connected) return;
    socket.send('/app/whiteboard.draw', { type: 'clear' });
  }

  subscribeDrawings() {
    if (!socket.connected) return;

    this._socketSubscription = socket.subscribe('/topic/whiteboard', (payload) => {
      if (payload.type === 'clear') {
        this.clearLocalCanvas();
      } else if (payload.type === 'draw') {
        const rect = this.canvas.getBoundingClientRect();
        const x0 = payload.x0 * rect.width;
        const y0 = payload.y0 * rect.height;
        const x1 = payload.x1 * rect.width;
        const y1 = payload.y1 * rect.height;

        this.drawSegment(x0, y0, x1, y1, payload.color, payload.size);
      }
    });
  }

  destroy() {
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
    }
    if (this._socketSubscription) {
      this._socketSubscription.unsubscribe();
    }
  }
}
