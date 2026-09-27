import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.ts';

const dir = () => join(config.dataDir, 'files');
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isAttachmentId(id: string): boolean {
  return ID.test(id) && existsSync(join(dir(), `${id}.pdf`));
}

export function saveAttachment(bytes: Uint8Array): string {
  mkdirSync(dir(), { recursive: true });
  const id = randomUUID();
  writeFileSync(join(dir(), `${id}.pdf`), bytes);
  return id;
}

export function readAttachment(id: string): Buffer | null {
  return isAttachmentId(id) ? readFileSync(join(dir(), `${id}.pdf`)) : null;
}

export function deleteAttachment(id: string): void {
  if (ID.test(id)) rmSync(join(dir(), `${id}.pdf`), { force: true });
}

// Uploads that were reviewed but never saved as an item.
export function removeOrphans(referenced: Set<string>, olderThanMs = 24 * 3_600_000): number {
  if (!existsSync(dir())) return 0;
  let removed = 0;
  for (const file of readdirSync(dir())) {
    const id = file.replace(/\.pdf$/, '');
    const path = join(dir(), file);
    if (!referenced.has(id) && Date.now() - statSync(path).mtimeMs > olderThanMs) {
      rmSync(path, { force: true });
      removed++;
    }
  }
  return removed;
}
