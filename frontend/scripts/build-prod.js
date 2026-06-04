/**
 * build-prod.js
 * Cross-platform: build frontend directly to backend/src/main/resources/static/
 * Uses react-scripts BUILD_PATH env var — no intermediate copy, no duplication.
 * Usage: node scripts/build-prod.js
 * npm script: npm run build
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STATIC_DIR = path.resolve(ROOT, '..', 'backend', 'src', 'main', 'resources', 'static');
const LEGACY_BUILD = path.join(ROOT, 'build');

// 清理旧的前端 build/ 目录（迁移前遗留的冗余产物）
if (fs.existsSync(LEGACY_BUILD)) {
    console.log('[build-prod] Removing legacy frontend/build/ directory...');
    fs.rmSync(LEGACY_BUILD, { recursive: true, force: true });
}

// 清空目标目录，避免旧版本残留（如旧 chunk 哈希文件堆积）
if (fs.existsSync(STATIC_DIR)) {
    console.log('[build-prod] Cleaning target:', STATIC_DIR);
    fs.rmSync(STATIC_DIR, { recursive: true, force: true });
}

console.log('[build-prod] Building frontend directly to:', STATIC_DIR);
execSync('npx react-scripts build', {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, BUILD_PATH: STATIC_DIR }
});

console.log('[build-prod] Done! Frontend built to backend/src/main/resources/static/');
