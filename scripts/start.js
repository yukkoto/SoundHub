const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const shouldSkipDocker =
  process.argv.includes('--skip-docker') ||
  ['1', 'true', 'yes'].includes(String(process.env.SKIP_DOCKER || '').toLowerCase());

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit'
    });

    child.on('error', error => {
      if (error.code === 'ENOENT') {
        error.message = `Command not found: ${command}`;
        reject(error);
        return;
      }
      reject(error);
    });

    child.on('exit', code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function main() {
  if (!shouldSkipDocker) {
    try {
      await run('docker', ['compose', 'up', '-d', 'postgres']);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        console.warn('Docker CLI not found. Skipping docker compose.');
        console.warn('Assuming PostgreSQL is already running on DATABASE_URL / PGHOST.');
        console.warn('If it is not running yet, install Docker Desktop or start PostgreSQL manually.');
      } else {
        throw error;
      }
    }
  }

  await run(process.execPath, [path.join(__dirname, 'db-wait.js')]);
  await run(process.execPath, [path.join(__dirname, 'db-migrate.js')]);
  await run(process.execPath, [path.join(__dirname, 'db-seed.js')]);
  await run(npmCommand, ['run', 'build:client']);

  try {
    await run(process.execPath, [path.join(__dirname, 'fma-sync.js')]);
  } catch (error) {
    console.warn(error.message || error);
    console.warn('Skipping FMA sync and continuing with the existing local catalog.');
  }

  const app = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit'
  });

  const stopSignals = ['SIGINT', 'SIGTERM'];
  for (const signal of stopSignals) {
    process.on(signal, () => {
      if (!app.killed) app.kill(signal);
    });
  }

  app.on('exit', code => {
    process.exit(code || 0);
  });
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
