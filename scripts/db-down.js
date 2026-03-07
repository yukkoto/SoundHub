const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit'
    });

    child.on('error', error => {
      reject(error);
    });

    child.on('exit', code => {
      if (code === 0) return resolve();
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function main() {
  try {
    await run('docker', ['compose', 'down']);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      console.error('Docker CLI not found.');
      console.error('Nothing to stop via Docker in this environment.');
      process.exit(1);
    }
    throw error;
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
