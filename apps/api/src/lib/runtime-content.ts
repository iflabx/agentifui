import {
  accessSync,
  constants,
  existsSync,
  realpathSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

export function resolveRuntimeContentDir(
  relative: 'content/pages' | 'messages'
): string {
  const configured = process.env.AGENTIF_RUNTIME_DIR;
  if (
    configured !== undefined &&
    (!configured.trim() || !path.isAbsolute(configured))
  ) {
    throw new Error('AGENTIF_RUNTIME_DIR must be an absolute path');
  }
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '../..'),
  ];
  const root = candidates.find(directory =>
    existsSync(path.join(directory, 'messages/en-US.json'))
  );
  if (!configured && !root)
    throw new Error(
      'Cannot locate runtime content; configure AGENTIF_RUNTIME_DIR'
    );
  const runtime = realpathSync(
    configured || path.join(root!, 'output/runtime')
  );
  if (configured && root) {
    const source = realpathSync(root);
    if (
      runtime === path.parse(runtime).root ||
      runtime === source ||
      runtime.startsWith(`${source}${path.sep}`) ||
      source.startsWith(`${runtime}${path.sep}`)
    ) {
      throw new Error('Configured runtime directory must be outside source');
    }
  }
  const directory = realpathSync(path.join(runtime, relative));
  if (
    !directory.startsWith(`${runtime}${path.sep}`) ||
    !statSync(directory).isDirectory()
  ) {
    throw new Error('Runtime content directory is invalid');
  }
  accessSync(directory, constants.R_OK | constants.W_OK | constants.X_OK);
  return directory;
}
