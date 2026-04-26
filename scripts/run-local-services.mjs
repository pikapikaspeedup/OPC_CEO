import { spawn } from 'node:child_process';

const mode = process.argv[2] === 'start' ? 'start' : 'dev';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const services = [
  { name: 'api', args: ['run', `${mode}:api`] },
  { name: 'web', args: ['run', `${mode}:web`] },
];

const children = [];
let shuttingDown = false;
let exitCode = 0;

function stopAll(signal = 'SIGTERM') {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

for (const service of services) {
  const child = spawn(npmCommand, service.args, {
    stdio: 'inherit',
    env: process.env,
  });
  children.push(child);

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    exitCode = code ?? (signal ? 1 : 0);
    if (signal) {
      console.error(`[${service.name}] exited by signal ${signal}`);
    } else {
      console.error(`[${service.name}] exited with code ${exitCode}`);
    }
    stopAll();
  });

  child.on('error', (error) => {
    if (!shuttingDown) {
      console.error(`[${service.name}] failed to start: ${error.message}`);
      exitCode = 1;
      stopAll();
    }
  });
}

process.on('SIGINT', () => {
  stopAll('SIGINT');
});

process.on('SIGTERM', () => {
  stopAll('SIGTERM');
});

process.on('beforeExit', () => {
  process.exitCode = exitCode;
});
