import fs from 'fs';
import path from 'path';
import process from 'process';

const root = process.cwd();
const localConfigPath = path.join(root, 'deploy-plugin.local.json');

function readTargetDir() {
  if (process.env.OBSIDIAN_KANBAN_PLUGIN_DIR) {
    return process.env.OBSIDIAN_KANBAN_PLUGIN_DIR;
  }

  if (fs.existsSync(localConfigPath)) {
    const config = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
    return config.pluginDir;
  }
}

const targetDir = readTargetDir();

if (!targetDir) {
  throw new Error(
    'Set OBSIDIAN_KANBAN_PLUGIN_DIR or create deploy-plugin.local.json with {"pluginDir":"..."}'
  );
}

if (!fs.existsSync(targetDir)) {
  throw new Error(`Plugin directory does not exist: ${targetDir}`);
}

const artifactsToMove = ['main.js', 'styles.css'];

for (const artifact of artifactsToMove) {
  const source = path.join(root, artifact);
  const target = path.join(targetDir, artifact);

  if (!fs.existsSync(source)) {
    throw new Error(`Missing build artifact: ${source}`);
  }

  if (fs.existsSync(target)) {
    fs.rmSync(target);
  }

  try {
    fs.renameSync(source, target);
  } catch (e) {
    if (e.code !== 'EXDEV') {
      throw e;
    }

    fs.copyFileSync(source, target);
    fs.rmSync(source);
  }
}

fs.copyFileSync(path.join(root, 'manifest.json'), path.join(targetDir, 'manifest.json'));

console.log(`Deployed Kanban plugin to ${targetDir}`);
