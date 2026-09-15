/**
 * FIX-19-31-03: project only storage preferences needed by a loaded skill.
 * Host-owned preparation, never a general read exemption for config files.
 * Unrelated skills receive no extra context or I/O.
 */
import type { App } from 'obsidian';

function folder(value: unknown): string {
    if (value === undefined || value === '' || value === '/') return '';
    if (typeof value !== 'string' || value.length > 512 || /[<>:\\]/.test(value)
        || [...value].some(char => char.charCodeAt(0) < 32)
        || value.startsWith('/') || value.split('/').includes('..')) throw new Error('Invalid storage folder');
    return value.split('/').filter(part => part !== '' && part !== '.').join('/');
}

export async function buildSkillStorageContext(app: App, body: string): Promise<string> {
    if (!/\b(?:attachmentFolderPath|newFileFolderPath|newFileLocation)\b/.test(body)) return '';
    const instruction = 'Host storage settings: use these resolved vault-relative folders instead of reading app.json, '
        + 'including when the skill requests that preparation. Config access stays blocked; do not change ignore rules. ';
    try {
        const raw = await app.vault.adapter.read(`${app.vault.configDir}/app.json`);
        if (raw.length > 65536) throw new Error('Oversized configuration');
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid configuration');
        const config = parsed as Record<string, unknown>;
        const activePath = app.workspace?.getActiveFile()?.path ?? '';
        const activeFolder = folder(activePath.includes('/') ? activePath.slice(0, activePath.lastIndexOf('/')) : '');
        const attachment = config.attachmentFolderPath;
        const attachmentFolder = typeof attachment === 'string' && (attachment === '.' || attachment.startsWith('./'))
            ? [activeFolder, folder(attachment)].filter(Boolean).join('/') : folder(attachment);
        const location = config.newFileLocation ?? 'root';
        if (typeof location !== 'string' || !['root', 'current', 'folder'].includes(location)) throw new Error('Unknown new-file location');
        const noteFolder = location === 'current' ? activeFolder : location === 'folder' ? folder(config.newFileFolderPath) : '';
        const configDir = app.vault.configDir.toLowerCase();
        if ([attachmentFolder, noteFolder].some(p => p.toLowerCase() === configDir || p.toLowerCase().startsWith(`${configDir}/`))) {
            throw new Error('Storage points into protected configuration');
        }
        return instruction + 'An empty folder means vault root.\n'
            + JSON.stringify({ attachmentFolderPath: attachmentFolder, newFileFolderPath: noteFolder }) + '\n\n';
    } catch {
        return 'Host storage settings are unavailable or invalid. If writing needs a destination, ask for the folder. '
            + 'Do not guess defaults, read protected app.json, or ask to change ignore rules.\n\n';
    }
}
