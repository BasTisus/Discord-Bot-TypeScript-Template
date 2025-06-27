// src/commands/metadata-tempvoice.ts - TempVoice Command Metadata
import {
    ApplicationCommandType,
    PermissionFlagsBits,
    PermissionsBitField,
    RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';

export const TempVoiceCommandMetadata: {
    [command: string]: RESTPostAPIChatInputApplicationCommandsJSONBody;
} = {
    TEMPVOICE_CREATE: {
        type: ApplicationCommandType.ChatInput,
        name: 'tempvoicecreate',
        description: 'Erstellt einen Creator-Channel für temporäre Voice-Kanäle (Testing)',
        dm_permission: false,
        default_member_permissions: PermissionsBitField.resolve([
            PermissionFlagsBits.Administrator,
        ]).toString(),
        options: []
    },
    TEMPVOICE_STATUS: {
        type: ApplicationCommandType.ChatInput,
        name: 'tempvoicestatus',
        description: 'Zeigt den Status deines temporären Voice-Channels',
        dm_permission: false,
        default_member_permissions: undefined,
        options: []
    },
    TEMPVOICE_LIST: {
        type: ApplicationCommandType.ChatInput,
        name: 'tempvoicelist',
        description: 'Zeigt alle aktiven temporären Voice-Channels (Admin)',
        dm_permission: false,
        default_member_permissions: PermissionsBitField.resolve([
            PermissionFlagsBits.ManageChannels,
        ]).toString(),
        options: []
    }
};