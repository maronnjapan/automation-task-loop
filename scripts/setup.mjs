#!/usr/bin/env node

/**
 * Creates (or reuses), uploads, and deploys the Apps Script web app.
 * Google login/consent deliberately stays in Google's own browser UI; this
 * script never reads a password, cookie, OAuth token, or browser profile.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const claspConfigPath = resolve(projectRoot, '.clasp.json');
const deployStatePath = resolve(projectRoot, '.deploy-state.json');
const args = new Set(process.argv.slice(2));
const noOpen = args.has('--no-open') || Boolean(process.env.CI);
const reuseOnly = args.has('--reuse-project');
const title = optionValue('--title') || '会議作業管理';
const suppliedScriptId = optionValue('--script-id');
const suppliedDeploymentId = optionValue('--deployment-id');
const claspBin = platform() === 'win32' ? resolve(projectRoot, 'node_modules', '.bin', 'clasp.cmd') : resolve(projectRoot, 'node_modules', '.bin', 'clasp');

if (args.has('--help')) {
  process.stdout.write([
    '使い方: npm run setup -- [options]',
    '',
    '  --script-id ID       既存 Apps Script プロジェクトを使用',
    '  --deployment-id ID   既存 deployment を更新',
    '  --title NAME         新規プロジェクト名（既定: 会議作業管理）',
    '  --reuse-project      .clasp.json がない場合は失敗',
    '  --no-open            ブラウザを自動で開かない',
    '  --help               この説明を表示',
    ''
  ].join('\n'));
  process.exit(0);
}

if (!existsSync(claspBin)) {
  fail('clasp がありません。先に npm install を実行してください。');
}

await ensureLogin();
await ensureProject();
runClasp(['push', '--force'], { capture: false });

const previousState = readJson(deployStatePath, {});
const deploymentId = suppliedDeploymentId || previousState.deploymentId || '';
const deployArgs = ['create-deployment', '--description', 'automation-task-loop ' + new Date().toISOString()];
if (deploymentId) deployArgs.push('--deploymentId', deploymentId);
const deployOutput = runClasp(deployArgs, { capture: true });
const resolvedDeploymentId = deploymentId || parseDeploymentId(deployOutput);
if (!resolvedDeploymentId) {
  fail('デプロイは完了しましたが deployment ID を取得できませんでした。`npx clasp list-deployments` で確認してください。\n' + deployOutput);
}

const webAppUrl = 'https://script.google.com/macros/s/' + resolvedDeploymentId + '/exec';
writeFileSync(deployStatePath, JSON.stringify({ deploymentId: resolvedDeploymentId, webAppUrl, deployedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });

const setupUrl = webAppUrl + '?setup=1';
process.stdout.write('\nデプロイが完了しました。\n');
process.stdout.write('Web アプリ: ' + webAppUrl + '\n');
process.stdout.write('初期設定URL: ' + setupUrl + '\n');
process.stdout.write('初回だけ Google のログイン・権限同意が表示されることがあります。\n');
if (!noOpen) openBrowser(setupUrl);

async function ensureLogin() {
  const status = spawnSync(claspBin, ['show-authorized-user', '--json'], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (status.status === 0) return;
  process.stdout.write('Google アカウントへの clasp ログインを開始します。\n');
  runClasp(['login'], { capture: false });
}

async function ensureProject() {
  if (existsSync(claspConfigPath)) return;
  if (reuseOnly && !suppliedScriptId) fail('--reuse-project を指定しましたが .clasp.json がありません。初回は npm run setup を実行してください。');
  if (suppliedScriptId) {
    writeFileSync(claspConfigPath, JSON.stringify({ scriptId: suppliedScriptId, rootDir: '.' }, null, 2) + '\n', { mode: 0o600 });
    return;
  }

  const temporaryProjectDir = mkdtempSync(join(tmpdir(), 'automation-task-loop-clasp-'));
  try {
    createProjectInTemporaryDirectory(temporaryProjectDir);
  } catch (error) {
    if (/script api|apps script api|user settings/i.test(String(error.message))) {
      const settingsUrl = 'https://script.google.com/home/usersettings';
      process.stdout.write('\nApps Script API を有効にしてください: ' + settingsUrl + '\n');
      if (noOpen) throw new Error('Apps Script API を有効にしてから、同じコマンドを再実行してください。');
      if (!noOpen) openBrowser(settingsUrl);
      const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
      await prompt.question('有効化したら Enter を押してください。');
      prompt.close();
      createProjectInTemporaryDirectory(temporaryProjectDir);
    } else {
      throw error;
    }
  } finally {
    rmSync(temporaryProjectDir, { recursive: true, force: true });
  }
}

function createProjectInTemporaryDirectory(temporaryProjectDir) {
  // A standalone Apps Script becomes a web app through appsscript.json and deployment.
  // Creating it outside the repository prevents clasp's initial pull from overwriting source files.
  runClasp(['create-script', '--type', 'standalone', '--title', title, '--rootDir', '.'], { capture: true, cwd: temporaryProjectDir });
  const generated = readJson(resolve(temporaryProjectDir, '.clasp.json'), null);
  if (!generated || !generated.scriptId) throw new Error('作成した Apps Script の scriptId を取得できませんでした。');
  writeFileSync(claspConfigPath, JSON.stringify({ scriptId: generated.scriptId, rootDir: '.' }, null, 2) + '\n', { mode: 0o600 });
}

function runClasp(commandArgs, options) {
  const cwd = options.cwd || projectRoot;
  try {
    if (options.capture) {
      const output = execFileSync(claspBin, commandArgs, { cwd: cwd, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
      process.stdout.write(output);
      return output;
    }
    execFileSync(claspBin, commandArgs, { cwd: cwd, stdio: 'inherit' });
    return '';
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr) : '';
    const stdout = error.stdout ? String(error.stdout) : '';
    throw new Error('clasp ' + commandArgs[0] + ' に失敗しました。\n' + [stdout.trim(), stderr.trim()].filter(Boolean).join('\n'), { cause: error });
  }
}

function parseDeploymentId(output) {
  const explicit = String(output).match(/(?:deployment|deployed)\s+(?:id\s*[:=]\s*)?([A-Za-z0-9_-]{20,})/i);
  if (explicit) return explicit[1];
  const appsScriptId = String(output).match(/\b(AKfy[A-Za-z0-9_-]{20,})\b/);
  return appsScriptId ? appsScriptId[1] : '';
}

function openBrowser(url) {
  let result;
  if (platform() === 'darwin') result = spawnSync('open', [url], { stdio: 'ignore' });
  else if (platform() === 'win32') result = spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
  else result = spawnSync('xdg-open', [url], { stdio: 'ignore' });
  if (result.error || result.status !== 0) process.stdout.write('ブラウザを自動で開けませんでした。上記の初期設定URLを手動で開いてください。\n');
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) { return fallback; }
}

function fail(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}
