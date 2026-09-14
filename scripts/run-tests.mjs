import { spawn } from 'node:child_process';
import { testEnvironment } from './test-env.mjs';
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--test', 'tests/*.test.ts'], {
  env: testEnvironment(), stdio: 'inherit', windowsHide: true,
});
child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
