// High-performance canvas renderer with pan + zoom.
// Coordinates: world cell (cx, cy) -> screen px = (cx * zoom + tx, cy * zoom + ty).
//
// Two render paths:
//   - "rect" path: when zoom >= ~3 px/cell, draw individual rounded-ish cells.
//   - "image-data" path: when zoom is small, write directly to an ImageData buffer
//     in screen-space — way faster for huge populations zoomed out.

import { unpackX, unpackY } from './life.js';

export class Renderer {
  constructor(canvas, life) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.life = life;

    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.width = 0;
    this.height = 0;

    // Camera: world coords of the screen origin (0,0), and zoom (px/cell).
    this.zoom = 18;
    this.tx = 0;
    this.ty = 0;
    this.minZoom = 0.5;
    this.maxZoom = 80;

    // Style.
    this.bg = '#07050f';
    this.gridMinor = 'rgba(139, 116, 240, 0.07)';
    this.gridMajor = 'rgba(139, 116, 240, 0.14)';
    this.cellFill = '#c4b5fd';
    this.cellGlow = 'rgba(167, 139, 250, 0.55)';
    // Highlight color (used by Conway-mode for isolated tubs).
    this.highlightFill = '#fbbf24';
    this.highlightGlow = 'rgba(251, 191, 36, 0.65)';
    this.highlightRGB  = [0xfb, 0xbf, 0x24];
    // Set<packedKey> of cells to render with the highlight palette.
    this.highlights = new Set();

    this._imgData = null;

    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.floor(rect.width * this.dpr);
    this.canvas.height = Math.floor(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._imgData = null;
  }

  /** Center the view on the given world cell (default: origin). */
  centerOn(cx = 0, cy = 0) {
    this.tx = this.width / 2 - cx * this.zoom;
    this.ty = this.height / 2 - cy * this.zoom;
  }

  /** Center the view on the bounds of the live population, fitting it in view. */
  fitTo(bounds, padding = 0.15) {
    if (!bounds) { this.centerOn(0, 0); return; }
    const [minX, minY, maxX, maxY] = bounds;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const padW = this.width * (1 - padding * 2);
    const padH = this.height * (1 - padding * 2);
    const z = Math.min(padW / w, padH / h);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, z));
    const cx = (minX + maxX) / 2 + 0.5;
    const cy = (minY + maxY) / 2 + 0.5;
    this.centerOn(cx, cy);
  }

  screenToWorld(sx, sy) {
    return [
      Math.floor((sx - this.tx) / this.zoom),
      Math.floor((sy - this.ty) / this.zoom),
    ];
  }

  /** Zoom around a screen anchor (mouse position). */
  zoomAt(sx, sy, factor) {
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    if (newZoom === this.zoom) return;
    // Keep the world point under the cursor stationary.
    const wx = (sx - this.tx) / this.zoom;
    const wy = (sy - this.ty) / this.zoom;
    this.zoom = newZoom;
    this.tx = sx - wx * this.zoom;
    this.ty = sy - wy * this.zoom;
  }

  pan(dx, dy) {
    this.tx += dx;
    this.ty += dy;
  }

  draw() {
    const { ctx, width, height, zoom, tx, ty } = this;
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, width, height);

    // Visible world bounds, padded by 1 cell.
    const wx0 = Math.floor((0 - tx) / zoom) - 1;
    const wy0 = Math.floor((0 - ty) / zoom) - 1;
    const wx1 = Math.ceil((width  - tx) / zoom) + 1;
    const wy1 = Math.ceil((height - ty) / zoom) + 1;

    if (zoom >= 6) this._drawGrid(wx0, wy0, wx1, wy1);

    if (zoom >= 3) {
      this._drawCellsRect(wx0, wy0, wx1, wy1);
    } else {
      this._drawCellsPixels(wx0, wy0, wx1, wy1);
    }
  }

  _drawGrid(wx0, wy0, wx1, wy1) {
    const { ctx, zoom, tx, ty, width, height } = this;
    // Minor grid every cell, major every 10.
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.strokeStyle = this.gridMinor;
    for (let x = wx0; x <= wx1; x++) {
      const px = Math.round(x * zoom + tx) + 0.5;
      if (x % 10 === 0) continue;
      ctx.moveTo(px, 0); ctx.lineTo(px, height);
    }
    for (let y = wy0; y <= wy1; y++) {
      const py = Math.round(y * zoom + ty) + 0.5;
      if (y % 10 === 0) continue;
      ctx.moveTo(0, py); ctx.lineTo(width, py);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = this.gridMajor;
    for (let x = wx0; x <= wx1; x++) {
      if (x % 10 !== 0) continue;
      const px = Math.round(x * zoom + tx) + 0.5;
      ctx.moveTo(px, 0); ctx.lineTo(px, height);
    }
    for (let y = wy0; y <= wy1; y++) {
      if (y % 10 !== 0) continue;
      const py = Math.round(y * zoom + ty) + 0.5;
      ctx.moveTo(0, py); ctx.lineTo(width, py);
    }
    ctx.stroke();
  }

  _drawCellsRect(wx0, wy0, wx1, wy1) {
    const { ctx, zoom, tx, ty, life } = this;
    const cells = life.cells;
    const inset = zoom > 10 ? 1 : 0;
    const drawSize = Math.max(1, zoom - inset);

    // Two-pass draw: ordinary cells, then highlighted cells overpainted with a
    // distinct color and a softer glow. Splitting passes lets us flip
    // fillStyle/shadow once each rather than per-cell.
    const drawPass = (set, fill, glow, glowEnabled) => {
      ctx.fillStyle = fill;
      const useGlow = glowEnabled && zoom >= 10 && set.size < 4000;
      if (useGlow) {
        ctx.save();
        ctx.shadowColor = glow;
        ctx.shadowBlur = Math.min(16, zoom * 0.7);
      }
      for (const k of set) {
        const cx = unpackX(k);
        if (cx < wx0 || cx > wx1) continue;
        const cy = unpackY(k);
        if (cy < wy0 || cy > wy1) continue;
        ctx.fillRect(cx * zoom + tx, cy * zoom + ty, drawSize, drawSize);
      }
      if (useGlow) ctx.restore();
    };

    drawPass(cells, this.cellFill, this.cellGlow, true);
    if (this.highlights.size > 0) {
      drawPass(this.highlights, this.highlightFill, this.highlightGlow, true);
    }
  }

  _drawCellsPixels(wx0, wy0, wx1, wy1) {
    // For very small zoom, write directly into ImageData. We scale via integer
    // sampling: each screen pixel maps to floor((sx - tx)/zoom) world cell.
    const { ctx, width, height, zoom, tx, ty, life } = this;
    const W = Math.floor(width * this.dpr);
    const H = Math.floor(height * this.dpr);

    if (!this._imgData || this._imgData.width !== W || this._imgData.height !== H) {
      this._imgData = ctx.createImageData(W, H);
    }
    const img = this._imgData;
    const data = img.data;

    // Background fill.
    // 0x07 0x05 0x0f
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 0x07; data[i+1] = 0x05; data[i+2] = 0x0f; data[i+3] = 255;
    }

    // For each live cell in viewport, splat a pixel block of size = max(1, round(zoom*dpr)).
    const pxSize = Math.max(1, Math.round(zoom * this.dpr));
    const dpr = this.dpr;

    const splat = (set, r, g, b) => {
      for (const k of set) {
        const cx = (k >>> 16) & 0xFFFF;
        const cxs = cx & 0x8000 ? cx - 0x10000 : cx;
        if (cxs < wx0 || cxs > wx1) continue;
        const cy = k & 0xFFFF;
        const cys = cy & 0x8000 ? cy - 0x10000 : cy;
        if (cys < wy0 || cys > wy1) continue;

        const sx = Math.round((cxs * zoom + tx) * dpr);
        const sy = Math.round((cys * zoom + ty) * dpr);

        for (let dy2 = 0; dy2 < pxSize; dy2++) {
          const yy = sy + dy2;
          if (yy < 0 || yy >= H) continue;
          let off = (yy * W + sx) * 4;
          for (let dx2 = 0; dx2 < pxSize; dx2++) {
            const xx = sx + dx2;
            if (xx < 0 || xx >= W) { off += 4; continue; }
            data[off] = r; data[off+1] = g; data[off+2] = b; data[off+3] = 255;
            off += 4;
          }
        }
      }
    };

    splat(life.cells, 0xc4, 0xb5, 0xfd);
    if (this.highlights.size > 0) {
      const [hr, hg, hb] = this.highlightRGB;
      splat(this.highlights, hr, hg, hb);
    }

    // Reset transform so putImageData is in raw pixels.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(img, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
}
