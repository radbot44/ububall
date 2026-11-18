'use strict';
/* Deterministic Ubu SVG & rasterized sprite renderer. */
const { createUbuRenderer } = require('./render/svg.js');
const renderSVG = createUbuRenderer(globalThis);
Object.defineProperty(renderSVG, 'createUbuRenderer', { value: createUbuRenderer });
if (typeof globalThis !== 'undefined') globalThis.ubuRender = renderSVG;
if (typeof module === 'object' && module.exports) module.exports = renderSVG;
