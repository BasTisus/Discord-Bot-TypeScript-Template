// src/commands/metadata-tempvoice.ts - Teil 5/8
// Command Metadata Export für TempVoice-Commands

export const TempVoiceCommandMetadata = {
    // Creator & Owner Management
    byvoicecreate: {
        name: 'byvoicecreate',
        description: 'Erstellt einen Creator-Channel für temporäre Voice-Channels',
        type: 1,
        dmPermission: false,
        defaultMemberPermissions: '8', // Administrator
    },
    byvoicesetowner: {
        name: 'byvoicesetowner',
        description: 'Ändert den Besitzer des temporären Voice-Channels',
        type: 1,
        dmPermission: false,
    },
    
    // Channel Settings
    byvoicelimit: {
        name: 'byvoicelimit',
        description: 'Ändert das Nutzer-Limit des temporären Voice-Channels',
        type: 1,
        dmPermission: false,
    },
    byvoicename: {
        name: 'byvoicename',
        description: 'Ändert den Namen des temporären Voice-Channels',
        type: 1,
        dmPermission: false,
    },
    
    // Visibility & Security
    byvoicehide: {
        name: 'byvoicehide',
        description: 'Versteckt den temporären Voice-Channel vor anderen Nutzern',
        type: 1,
        dmPermission: false,
    },
    byvoiceshow: {
        name: 'byvoiceshow',
        description: 'Macht den temporären Voice-Channel wieder sichtbar',
        type: 1,
        dmPermission: false,
    },
    byvoicelock: {
        name: 'byvoicelock',
        description: 'Sperrt den temporären Voice-Channel für neue Nutzer',
        type: 1,
        dmPermission: false,
    },
    byvoiceunlock: {
        name: 'byvoiceunlock',
        description: 'Entsperrt den temporären Voice-Channel für neue Nutzer',
        type: 1,
        dmPermission: false,
    },
    byvoiceclaim: {
        name: 'byvoiceclaim',
        description: 'Beansprucht den Channel wenn der Besitzer nicht anwesend ist',
        type: 1,
        dmPermission: false,
    },
    
    // Moderation
    byvoiceban: {
        name: 'byvoiceban',
        description: 'Verbannt einen Nutzer aus dem temporären Voice-Channel',
        type: 1,
        dmPermission: false,
    },
    byvoiceunban: {
        name: 'byvoiceunban',
        description: 'Entbannt einen Nutzer aus dem temporären Voice-Channel',
        type: 1,
        dmPermission: false,
    },
    byvoicekick: {
        name: 'byvoicekick',
        description: 'Wirft einen Nutzer aus dem temporären Voice-Channel',
        type: 1,
        dmPermission: false,
    },
    
    // Status & Information
    byvoicestatus: {
        name: 'byvoicestatus',
        description: 'Zeigt detaillierte Informationen über den temporären Voice-Channel',
        type: 1,
        dmPermission: false,
    },
    
    // Admin Commands
    byvoicelist: {
        name: 'byvoicelist',
        description: 'Zeigt alle aktiven temporären Voice-Channels (Admin)',
        type: 1,
        dmPermission: false,
        defaultMemberPermissions: '8', // Administrator
    },
    byvoicestats: {
        name: 'byvoicestats',
        description: 'Zeigt erweiterte TempVoice-Statistiken (Admin)',
        type: 1,
        dmPermission: false,
        defaultMemberPermissions: '8', // Administrator
    },
    byvoicecleanup: {
        name: 'byvoicecleanup',
        description: 'Bereinigt leere temporäre Voice-Channels (Admin)',
        type: 1,
        dmPermission: false,
        defaultMemberPermissions: '8', // Administrator
    },
    byvoiceconfig: {
        name: 'byvoiceconfig',
        description: 'Konfiguriert TempVoice-Einstellungen für den Server (Admin)',
        type: 1,
        dmPermission: false,
        defaultMemberPermissions: '8', // Administrator
    },
} as const;

// Export aller Command-Klassen
export {
    TempVoiceCreateCommand,
    TempVoiceSetOwnerCommand,
    TempVoiceLimitCommand,
    TempVoiceRenameCommand,
    TempVoiceHideCommand,
    TempVoiceShowCommand,
    TempVoiceLockCommand,
    TempVoiceUnlockCommand,
    TempVoiceClaimCommand,
    TempVoiceBanCommand,
    TempVoiceUnbanCommand,
    TempVoiceKickCommand,
    TempVoiceStatusCommand,
    TempVoiceListCommand,
    TempVoiceStatsCommand,
    TempVoiceCleanupCommand,
    TempVoiceConfigCommand
} from './chat/tempvoice-commands.js';