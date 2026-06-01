/**
 * build-prod.js
 * Cross-platform: build frontend and copy artifacts to backend/src/main/resources/static/
 * Usage: node scripts/build-prod.js
 * npm script: npm run build:prod
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const STATIC_DIR = path.join(ROOT, '..', 'backend', 'src', 'main', 'resources', 'static');

console.log('[build-prod] Starting frontend build...');
execSync('npx react-scripts build', { cwd: ROOT, stdio: 'inherit' });

console.log('[build-prod] Cleaning target dir:', STATIC_DIR);
fs.rmSync(STATIC_DIR, { recursive: true, force: true });

console.log('[build-prod] Copying build artifacts to:', STATIC_DIR);
fs.cpSync(BUILD_DIR, STATIC_DIR, { recursive: true });

console.log('[build-prod] Done! Frontend artifacts copied to backend/src/main/resources/static/');
