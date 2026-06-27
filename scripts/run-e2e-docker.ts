import { spawn } from 'node:child_process';

const composeFile = 'test/e2e/docker/verdaccio.compose.yml';

function run(command: string, args: string[]): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (code !== null) {
				resolve(code);
				return;
			}
			console.error(`${command} ${args.join(' ')} exited via ${signal ?? 'unknown signal'}`);
			resolve(1);
		});
	});
}

async function main(): Promise<number> {
	const dockerCode = await run('docker', ['info', '--format', '{{.ServerVersion}}']);
	if (dockerCode !== 0) {
		console.error('Docker daemon is not reachable. Start Docker and rerun `pnpm test:e2e:docker`.');
		return dockerCode;
	}

	const upCode = await run('docker', ['compose', '-f', composeFile, 'up', '-d', '--wait']);
	if (upCode !== 0) return upCode;

	const testCode = await run('pnpm', ['test:e2e']);
	const cleanupCode = await run('docker', ['compose', '-f', composeFile, 'down', '-v']);
	return testCode !== 0 ? testCode : cleanupCode;
}

process.exitCode = await main();
