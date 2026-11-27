import path from 'node:path';
import { spawn } from 'node:child_process';

const apiPort = process.env.API_PORT || '8787';

const apiServer = spawn(process.execPath, [path.resolve(process.cwd(), 'local/server.js')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: apiPort,
    HOST: '127.0.0.1',
    SERVE_STATIC: 'false',
    LOCAL_AUTH_MODE: process.env.LOCAL_AUTH_MODE || 'off',
  },
});

const viteServer = spawn(
  process.execPath,
  [path.resolve(process.cwd(), 'node_modules/vite/bin/vite.js'), '--host'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      YUMYUM_LOCAL: '1',
      API_PORT: apiPort,
    },
  }
);

let exiting = false;

function shutdown(code = 0) {
  if (exiting) {
    return;
  }
  exiting = true;
  if (!apiServer.killed) {
    apiServer.kill('SIGTERM');
  }
  if (!viteServer.killed) {
    viteServer.kill('SIGTERM');
  }
  setTimeout(() => {
    process.exit(code);
  }, 200).unref();
}

apiServer.on('exit', (code) => {
  shutdown(code || 0);
});

viteServer.on('exit', (code) => {
  shutdown(code || 0);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
