(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global.ImageTracer = factory());
}(this, (function () {
  'use strict';

  class ImageTracer {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
    }

    // Load image and return a promise
    loadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
          this.canvas.width = img.width;
          this.canvas.height = img.height;
          this.ctx.drawImage(img, 0, 0);
          resolve(img);
        };
        img.onerror = reject;
        img.src = src;
      });
    }

    // Get image data with color information
    getImageData(threshold = 128) {
      const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      const data = imageData.data;
      const width = imageData.width;
      const height = imageData.height;
      const pixels = [];

      // Store color information
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
        const value = brightness > threshold ? 0 : 255;
        pixels.push({ value, color: { r, g, b } });
      }

      return { pixels, width, height };
    }

    // Simple edge detection with color association
    findEdges(pixels, width, height) {
      const edges = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          if (pixels[i].value === 255) {
            // Check neighboring pixels
            const neighbors = [
              (y > 0) ? pixels[(y - 1) * width + x] : null,
              (y < height - 1) ? pixels[(y + 1) * width + x] : null,
              (x > 0) ? pixels[y * width + x - 1] : null,
              (x < width - 1) ? pixels[y * width + x + 1] : null
            ];
            if (neighbors.some(n => n && n.value === 0)) {
              edges.push({ x, y, color: pixels[i].color });
            }
          }
        }
      }
      return edges;
    }

    // Trace edges to create paths
    tracePaths(edges, width, height) {
      const visited = new Set();
      const paths = [];

      const getIndex = (x, y) => `${x},${y}`;

      while (edges.length > 0) {
        let path = [];
        let current = edges.shift();
        if (!current) break;

        path.push(current);
        visited.add(getIndex(current.x, current.y));

        let found = true;
        while (found) {
          found = false;
          const last = path[path.length - 1];
          const neighbors = [
            { x: last.x + 1, y: last.y },
            { x: last.x - 1, y: last.y },
            { x: last.x, y: last.y + 1 },
            { x: last.x, y: last.y - 1 },
            { x: last.x + 1, y: last.y + 1 },
            { x: last.x + 1, y: last.y - 1 },
            { x: last.x - 1, y: last.y + 1 },
            { x: last.x - 1, y: last.y - 1 }
          ];

          for (const n of neighbors) {
            const idx = getIndex(n.x, n.y);
            if (
              n.x >= 0 && n.x < width &&
              n.y >= 0 && n.y < height &&
              !visited.has(idx) &&
              edges.some(e => e.x === n.x && e.y === n.y)
            ) {
              const nextEdge = edges.find(e => e.x === n.x && e.y === n.y);
              path.push(nextEdge);
              visited.add(idx);
              edges.splice(edges.indexOf(nextEdge), 1);
              found = true;
              break;
            }
          }
        }

        if (path.length > 1) {
          paths.push(path);
        }
      }

      return paths;
    }

    // Ramer-Douglas-Peucker algorithm for path simplification
    simplifyPath(path, epsilon = 1) {
      if (path.length <= 2) return path;

      const getDistance = (point, lineStart, lineEnd) => {
        const px = lineEnd.x - lineStart.x;
        const py = lineEnd.y - lineStart.y;
        const len = Math.sqrt(px * px + py * py);
        if (len === 0) return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
        const t = Math.max(0, Math.min(1, ((point.x - lineStart.x) * px + (point.y - lineStart.y) * py) / (len * len)));
        const projX = lineStart.x + t * px;
        const projY = lineStart.y + t * py;
        return Math.hypot(point.x - projX, point.y - projY);
      };

      let maxDistance = 0;
      let index = 0;
      for (let i = 1; i < path.length - 1; i++) {
        const d = getDistance(path[i], path[0], path[path.length - 1]);
        if (d > maxDistance) {
          maxDistance = d;
          index = i;
        }
      }

      if (maxDistance > epsilon) {
        const left = path.slice(0, index + 1);
        const right = path.slice(index);
        const simplifiedLeft = this.simplifyPath(left, epsilon);
        const simplifiedRight = this.simplifyPath(right, epsilon);
        return simplifiedLeft.slice(0, -1).concat(simplifiedRight);
      } else {
        return [path[0], path[path.length - 1]];
      }
    }

    // Convert paths to smooth SVG paths with Bezier curves
    smoothPath(path) {
      if (path.length < 3) return path;

      const smoothed = [path[0]];
      for (let i = 1; i < path.length - 1; i++) {
        const prev = path[i - 1];
        const curr = path[i];
        const next = path[i + 1];

        // Calculate control points for cubic Bezier
        const cp1x = curr.x + (curr.x - prev.x) * 0.2;
        const cp1y = curr.y + (curr.y - prev.y) * 0.2;
        const cp2x = curr.x - (next.x - curr.x) * 0.2;
        const cp2y = curr.y - (next.y - curr.y) * 0.2;

        smoothed.push({ x: cp1x, y: cp1y, isControl: true });
        smoothed.push({ x: cp2x, y: cp2y, isControl: true });
        smoothed.push(curr);
      }
      smoothed.push(path[path.length - 1]);
      return smoothed;
    }

    // Convert paths to SVG string with color
    pathsToSvg(paths, width, height, colorTolerance = 30) {
      let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

      // Group paths by color
      const colorGroups = {};
      for (const path of paths) {
        if (path.length < 2) continue;
        const simplifiedPath = this.simplifyPath(path, 1);
        const smoothedPath = this.smoothPath(simplifiedPath);

        // Get average color of the path
        let r = 0, g = 0, b = 0, count = 0;
        for (const point of path) {
          r += point.color.r;
          g += point.color.g;
          b += point.color.b;
          count++;
        }
        const avgColor = {
          r: Math.round(r / count),
          g: Math.round(g / count),
          b: Math.round(b / count)
        };

        // Quantize color to reduce noise
        let colorKey = null;
        for (const key in colorGroups) {
          const [cr, cg, cb] = key.split(',').map(Number);
          if (
            Math.abs(cr - avgColor.r) < colorTolerance &&
            Math.abs(cg - avgColor.g) < colorTolerance &&
            Math.abs(cb - avgColor.b) < colorTolerance
          ) {
            colorKey = key;
            break;
          }
        }
        if (!colorKey) {
          colorKey = `${avgColor.r},${avgColor.g},${avgColor.b}`;
        }

        if (!colorGroups[colorKey]) {
          colorGroups[colorKey] = [];
        }
        colorGroups[colorKey].push(smoothedPath);
      }

      // Generate SVG paths for each color group
      for (const colorKey in colorGroups) {
        const [r, g, b] = colorKey.split(',').map(Number);
        const hexColor = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).padStart(6, '0')}`;
        for (const path of colorGroups[colorKey]) {
          let d = `M${path[0].x},${path[0].y}`;
          for (let i = 1; i < path.length; i++) {
            if (path[i].isControl && i + 2 < path.length) {
              d += ` C${path[i].x},${path[i].y} ${path[i + 1].x},${path[i + 1].y} ${path[i + 2].x},${path[i + 2].y}`;
              i += 2;
            } else {
              d += ` L${path[i].x},${path[i].y}`;
            }
          }
          svg += `<path d="${d}" fill="${hexColor}" stroke="${hexColor}" stroke-width="0.5"/>`;
        }
      }

      svg += '</svg>';
      return svg;
    }

    // Main method to trace image to SVG
    async trace(imageSrc, options = {}) {
      const { threshold = 128, colorTolerance = 30 } = options;
      try {
        await this.loadImage(imageSrc);
        const { pixels, width, height } = this.getImageData(threshold);
        const edges = this.findEdges(pixels, width, height);
        const paths = this.tracePaths(edges, width, height);
        const svg = this.pathsToSvg(paths, width, height, colorTolerance);
        return svg;
      } catch (error) {
        console.error('Error tracing image:', error);
        return null;
      }
    }
  }

  return ImageTracer;
})));