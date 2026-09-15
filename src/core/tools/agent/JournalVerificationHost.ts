import { TFile } from 'obsidian';
import type ObsidianAgentPlugin from '../../../main';
import { WorkJournal } from '../../agent/WorkJournal';
import { JournalVerification } from '../../agent/JournalVerification';
import { validateVaultRelativePath } from '../vault/pathValidation';
import { IframeSandboxExecutor } from '../../sandbox/IframeSandboxExecutor';
import type { EsbuildWasmManager } from '../../sandbox/EsbuildWasmManager';

export function createJournalVerification(plugin: ObsidianAgentPlugin, journal: WorkJournal, compiler?: EsbuildWasmManager): JournalVerification {
    return new JournalVerification(journal, {
        readFile: async raw => {
            const path = validateVaultRelativePath(raw);
            const configDir = plugin.app.vault.configDir;
            if (!path || path === configDir || path.startsWith(`${configDir}/`)
                || !plugin.ignoreService || plugin.ignoreService.isIgnored(path)) throw new Error('Path denied');
            const file = plugin.app.vault.getAbstractFileByPath(path);
            // Indexed files only: no adapter fallback outside governance.
            if (!(file instanceof TFile) || file.stat.size > 65536) throw new Error('File unavailable or over verification limit');
            const content = await plugin.app.vault.read(file);
            if (content.length > 65536) throw new Error('File over verification limit');
            return content;
        },
        ...(compiler ? {
            compile: (source: string) => compiler.transform(source),
            createSandbox: () => new IframeSandboxExecutor(plugin, 'none'),
        } : {}),
    });
}
