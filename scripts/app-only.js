const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
      ...options
    });

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) return resolve();
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function main() {
  await run(npmCommand, ['run', 'build:client']);

  try {
    await run(process.execPath, [path.join(__dirname, 'fma-sync.js')]);
  } catch (error) {
    console.warn(error.message || error);
    console.warn('Skipping FMA sync and continuing with the existing local catalog.');
  }

  await run(process.execPath, [path.join(ROOT, 'server.js')]);
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
