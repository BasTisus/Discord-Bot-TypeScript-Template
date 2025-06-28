import {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    ApplicationCommandType,
    PermissionFlagsBits,
    GuildMember,
    EmbedBuilder,
    PermissionsString
} from 'discord.js';
import { RateLimiter } from 'discord.js-rate-limiter';

import { Logger } from '../../services/index.js';
import { Command, CommandDeferType } from '../index.js';
// Korrigierter Import
import { TempVoiceModule } from '../../modules/tempvoice/index.js';

// Instanz der TempVoiceModule (wird normalerweise über Dependency Injection bereitgestellt)
declare const tempVoiceModule: TempVoiceModule;

// 1. /byvoicecreate - Creator-Channel erstellen
export class TempVoiceCreateCommand implements Command {
    public names = ['byvoicecreate'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['ManageChannels', 'Connect'];
    public cooldown = new RateLimiter(1, 5000);

    public metadata = {
        name: 'byvoicecreate',
        description: 'Erstellt einen Creator-Channel für temporäre Voice-Channels',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
        defaultMemberPermissions: PermissionFlagsBits.ManageChannels,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicecreate')
        .setDescription('Erstellt einen Creator-Channel für temporäre Voice-Channels')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Name des Creator-Channels')
                .setRequired(true)
                .setMaxLength(100))
        .addIntegerOption(option =>
            option.setName('max_users')
                .setDescription('Standard-Nutzer-Limit für temporäre Channels')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(99))
        .addChannelOption(option =>
            option.setName('category')
                .setDescription('Kategorie für den Creator-Channel')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const name = intr.options.getString('name', true);
        const maxUsers = intr.options.getInteger('max_users') || 0;
        const category = intr.options.getChannel('category');

        try {
            const result = await (tempVoiceModule as any).createCreatorChannel(
                intr.guild!,
                name,
                category?.id,
                maxUsers
            );

            if (!result.success) {
                await intr.reply({
                    content: `❌ ${result.message}`,
                    ephemeral: true
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Creator-Channel erstellt!')
                .setDescription(`Der Creator-Channel wurde erfolgreich erstellt.`)
                .addFields(
                    { name: '📢 Channel', value: `<#${result.channelId}>`, inline: true },
                    { name: '👥 Max. Nutzer', value: maxUsers === 0 ? 'Unbegrenzt' : maxUsers.toString(), inline: true },
                    { name: '📁 Kategorie', value: category ? `<#${category.id}>` : 'Keine', inline: true }
                )
                .setColor(0x00ff00)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Creator Channel • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Erstellen des Creator-Channels', error);
            await intr.reply({
                content: '❌ Fehler beim Erstellen des Creator-Channels!',
                ephemeral: true
            });
        }
    }
}

// 2. /byvoicesetowner - Besitzer ändern
export class TempVoiceSetOwnerCommand implements Command {
    public names = ['byvoicesetowner'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['ManageChannels'];
    public cooldown = new RateLimiter(1, 3000);

    public metadata = {
        name: 'byvoicesetowner',
        description: 'Ändert den Besitzer des temporären Voice-Channels',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicesetowner')
        .setDescription('Ändert den Besitzer des temporären Voice-Channels')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Neuer Besitzer des Channels')
                .setRequired(true));

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const newOwner = intr.options.getUser('user', true);

        const tempChannelData = (tempVoiceModule as any).isInTempChannel(intr);
        if (!tempChannelData) {
            await intr.reply({
                content: '❌ Du bist nicht in einem temporären Voice-Channel!',
                ephemeral: true
            });
            return;
        }

        if (!(tempVoiceModule as any).isChannelOwner(intr.guildId!, (intr.member as GuildMember).voice.channel!.id, intr.user.id)) {
            await intr.reply({
                content: '❌ Nur der Channel-Besitzer kann den Besitzer ändern!',
                ephemeral: true
            });
            return;
        }

        const newOwnerMember = intr.guild!.members.cache.get(newOwner.id);
        if (!newOwnerMember) {
            await intr.reply({
                content: '❌ Der neue Besitzer ist nicht auf diesem Server!',
                ephemeral: true
            });
            return;
        }

        if (!newOwnerMember.voice.channel || newOwnerMember.voice.channel.id !== tempChannelData.channelId) {
            await intr.reply({
                content: '❌ Der neue Besitzer muss im Channel sein!',
                ephemeral: true
            });
            return;
        }

        try {
            const result = await (tempVoiceModule as any).setChannelOwner(
                intr.guildId!,
                tempChannelData.channelId,
                newOwner.id
            );

            if (!result.success) {
                await intr.reply({
                    content: `❌ ${result.message}`,
                    ephemeral: true
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Besitzer geändert!')
                .setDescription(`Der Channel-Besitzer wurde erfolgreich geändert.`)
                .addFields(
                    { name: '👤 Neuer Besitzer', value: `${newOwner}`, inline: true },
                    { name: '📢 Channel', value: `<#${tempChannelData.channelId}>`, inline: true }
                )
                .setColor(0x00ff00)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Owner Changed • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Ändern des Channel-Besitzers', error);
            await intr.reply({
                content: '❌ Fehler beim Ändern des Besitzers!',
                ephemeral: true
            });
        }
    }
}

// 3. /byvoicelimit - Nutzer-Limit
export class TempVoiceLimitCommand implements Command {
    public names = ['byvoicelimit'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['ManageChannels'];
    public cooldown = new RateLimiter(1, 3000);

    public metadata = {
        name: 'byvoicelimit',
        description: 'Ändert das Nutzer-Limit des temporären Voice-Channels',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicelimit')
        .setDescription('Ändert das Nutzer-Limit des temporären Voice-Channels')
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Nutzer-Limit (0 = unbegrenzt)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(99));

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const limit = intr.options.getInteger('limit', true);

        const tempChannelData = (tempVoiceModule as any).isInTempChannel(intr);
        if (!tempChannelData) {
            await intr.reply({
                content: '❌ Du bist nicht in einem temporären Voice-Channel!',
                ephemeral: true
            });
            return;
        }

        if (!(tempVoiceModule as any).isChannelOwner(intr.guildId!, (intr.member as GuildMember).voice.channel!.id, intr.user.id)) {
            await intr.reply({
                content: '❌ Nur der Channel-Besitzer kann das Limit ändern!',
                ephemeral: true
            });
            return;
        }

        try {
            const result = await (tempVoiceModule as any).setChannelLimit(
                intr.guildId!,
                tempChannelData.channelId,
                limit
            );

            if (!result.success) {
                await intr.reply({
                    content: `❌ ${result.message}`,
                    ephemeral: true
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Nutzer-Limit geändert!')
                .setDescription(`Das Nutzer-Limit wurde erfolgreich geändert.`)
                .addFields(
                    { name: '👥 Neues Limit', value: limit === 0 ? 'Unbegrenzt' : limit.toString(), inline: true },
                    { name: '📢 Channel', value: `<#${tempChannelData.channelId}>`, inline: true }
                )
                .setColor(0x00ff00)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Limit Changed • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Ändern des Nutzer-Limits', error);
            await intr.reply({
                content: '❌ Fehler beim Ändern des Limits!',
                ephemeral: true
            });
        }
    }
}

// 4. /byvoicename - Channel umbenennen
export class TempVoiceRenameCommand implements Command {
    public names = ['byvoicename'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['ManageChannels'];
    public cooldown = new RateLimiter(1, 5000);

    public metadata = {
        name: 'byvoicename',
        description: 'Benennt den temporären Voice-Channel um',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicename')
        .setDescription('Benennt den temporären Voice-Channel um')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Neuer Name des Channels')
                .setRequired(true)
                .setMaxLength(100));

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const newName = intr.options.getString('name', true);

        const tempChannelData = (tempVoiceModule as any).isInTempChannel(intr);
        if (!tempChannelData) {
            await intr.reply({
                content: '❌ Du bist nicht in einem temporären Voice-Channel!',
                ephemeral: true
            });
            return;
        }

        if (!(tempVoiceModule as any).isChannelOwner(intr.guildId!, (intr.member as GuildMember).voice.channel!.id, intr.user.id)) {
            await intr.reply({
                content: '❌ Nur der Channel-Besitzer kann den Channel umbenennen!',
                ephemeral: true
            });
            return;
        }

        try {
            const result = await (tempVoiceModule as any).renameChannel(
                intr.guildId!,
                tempChannelData.channelId,
                newName
            );

            if (!result.success) {
                await intr.reply({
                    content: `❌ ${result.message}`,
                    ephemeral: true
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Channel umbenannt!')
                .setDescription(`Der Channel wurde erfolgreich umbenannt.`)
                .addFields(
                    { name: '📝 Neuer Name', value: newName, inline: true },
                    { name: '📢 Channel', value: `<#${tempChannelData.channelId}>`, inline: true }
                )
                .setColor(0x00ff00)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Channel Renamed • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Umbenennen des Channels', error);
            await intr.reply({
                content: '❌ Fehler beim Umbenennen des Channels!',
                ephemeral: true
            });
        }
    }
}

// 5. /byvoicehide - Channel verstecken
export class TempVoiceHideCommand implements Command {
    public names = ['byvoicehide'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['ManageChannels'];
    public cooldown = new RateLimiter(1, 3000);

    public metadata = {
        name: 'byvoicehide',
        description: 'Versteckt den temporären Voice-Channel vor anderen Nutzern',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicehide')
        .setDescription('Versteckt den temporären Voice-Channel vor anderen Nutzern');

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const tempChannelData = (tempVoiceModule as any).isInTempChannel(intr);
        if (!tempChannelData) {
            await intr.reply({
                content: '❌ Du bist nicht in einem temporären Voice-Channel!',
                ephemeral: true
            });
            return;
        }

        if (!(tempVoiceModule as any).isChannelOwner(intr.guildId!, (intr.member as GuildMember).voice.channel!.id, intr.user.id)) {
            await intr.reply({
                content: '❌ Nur der Channel-Besitzer kann den Channel verstecken!',
                ephemeral: true
            });
            return;
        }

        if (tempChannelData.isHidden) {
            await intr.reply({
                content: '❌ Der Channel ist bereits versteckt!',
                ephemeral: true
            });
            return;
        }

        try {
            const result = await (tempVoiceModule as any).hideChannel(
                intr.guildId!,
                tempChannelData.channelId
            );

            if (!result.success) {
                await intr.reply({
                    content: `❌ ${result.message}`,
                    ephemeral: true
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Channel versteckt!')
                .setDescription(`Der Channel wurde erfolgreich vor anderen Nutzern versteckt.`)
                .addFields(
                    { name: '👁️ Sichtbarkeit', value: 'Versteckt', inline: true },
                    { name: '📢 Channel', value: `<#${tempChannelData.channelId}>`, inline: true }
                )
                .setColor(0xffa500)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Channel Hidden • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Verstecken des Channels', error);
            await intr.reply({
                content: '❌ Fehler beim Verstecken des Channels!',
                ephemeral: true
            });
        }
    }
}
// 6. /byvoiceshow - Channel sichtbar machen
export class TempVoiceShowCommand implements Command {
    public names = ['byvoiceshow'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['ManageChannels'];
    public cooldown = new RateLimiter(1, 3000);

    public metadata = {
        name: 'byvoiceshow',
        description: 'Macht den temporären Voice-Channel wieder sichtbar',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoiceshow')
        .setDescription('Macht den temporären Voice-Channel wieder sichtbar');

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const tempChannelData = (tempVoiceModule as any).isInTempChannel(intr);
        if (!tempChannelData) {
            await intr.reply({
                content: '❌ Du bist nicht in einem temporären Voice-Channel!',
                ephemeral: true
            });
            return;
        }

        if (!(tempVoiceModule as any).isChannelOwner(intr.guildId!, (intr.member as GuildMember).voice.channel!.id, intr.user.id)) {
            await intr.reply({
                content: '❌ Nur der Channel-Besitzer kann den Channel sichtbar machen!',
                ephemeral: true
            });
            return;
        }

        if (!tempChannelData.isHidden) {
            await intr.reply({
                content: '❌ Der Channel ist bereits sichtbar!',
                ephemeral: true
            });
            return;
        }

        try {
            const result = await (tempVoiceModule as any).showChannel(
                intr.guildId!,
                tempChannelData.channelId
            );

            if (!result.success) {
                await intr.reply({
                    content: `❌ ${result.message}`,
                    ephemeral: true
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Channel sichtbar!')
                .setDescription(`Der Channel ist wieder für alle Nutzer sichtbar.`)
                .addFields(
                    { name: '👁️ Sichtbarkeit', value: 'Sichtbar', inline: true },
                    { name: '📢 Channel', value: `<#${tempChannelData.channelId}>`, inline: true }
                )
                .setColor(0x00ff00)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Channel Visible • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Sichtbar-Machen des Channels', error);
            await intr.reply({
                content: '❌ Fehler beim Sichtbar-Machen des Channels!',
                ephemeral: true
            });
        }
    }
}

// 7. /byvoicelock - Channel sperren
export class TempVoiceLockCommand implements Command {
    public names = ['byvoicelock'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['ManageChannels'];
    public cooldown = new RateLimiter(1, 3000);

    public metadata = {
        name: 'byvoicelock',
        description: 'Sperrt den temporären Voice-Channel für neue Nutzer',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicelock')
        .setDescription('Sperrt den temporären Voice-Channel für neue Nutzer');

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const tempChannelData = (tempVoiceModule as any).isInTempChannel(intr);
        if (!tempChannelData) {
            await intr.reply({
                content: '❌ Du bist nicht in einem temporären Voice-Channel!',
                ephemeral: true
            });
            return;
        }

        if (!(tempVoiceModule as any).isChannelOwner(intr.guildId!, (intr.member as GuildMember).voice.channel!.id, intr.user.id)) {
            await intr.reply({
                content: '❌ Nur der Channel-Besitzer kann den Channel sperren!',
                ephemeral: true
            });
            return;
        }

        if (tempChannelData.isLocked) {
            await intr.reply({
                content: '❌ Der Channel ist bereits gesperrt!',
                ephemeral: true
            });
            return;
        }

        try {
            const result = await (tempVoiceModule as any).lockChannel(
                intr.guildId!,
                tempChannelData.channelId
            );

            if (!result.success) {
                await intr.reply({
                    content: `❌ ${result.message}`,
                    ephemeral: true
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('🔒 Channel gesperrt!')
                .setDescription(`Der Channel wurde für neue Nutzer gesperrt.`)
                .addFields(
                    { name: '🔐 Status', value: 'Gesperrt', inline: true },
                    { name: '📢 Channel', value: `<#${tempChannelData.channelId}>`, inline: true }
                )
                .setColor(0xff0000)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Channel Locked • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Sperren des Channels', error);
            await intr.reply({
                content: '❌ Fehler beim Sperren des Channels!',
                ephemeral: true
            });
        }
    }
}

// 8. /byvoiceunlock - Channel entsperren
export class TempVoiceUnlockCommand implements Command {
    public names = ['byvoiceunlock'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['ManageChannels'];
    public cooldown = new RateLimiter(1, 3000);

    public metadata = {
        name: 'byvoiceunlock',
        description: 'Entsperrt den temporären Voice-Channel für neue Nutzer',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoiceunlock')
        .setDescription('Entsperrt den temporären Voice-Channel für neue Nutzer');

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const tempChannelData = (tempVoiceModule as any).isInTempChannel(intr);
        if (!tempChannelData) {
            await intr.reply({
                content: '❌ Du bist nicht in einem temporären Voice-Channel!',
                ephemeral: true
            });
            return;
        }

        if (!(tempVoiceModule as any).isChannelOwner(intr.guildId!, (intr.member as GuildMember).voice.channel!.id, intr.user.id)) {
            await intr.reply({
                content: '❌ Nur der Channel-Besitzer kann den Channel entsperren!',
                ephemeral: true
            });
            return;
        }

        if (!tempChannelData.isLocked) {
            await intr.reply({
                content: '❌ Der Channel ist bereits entsperrt!',
                ephemeral: true
            });
            return;
        }

        try {
            const result = await (tempVoiceModule as any).unlockChannel(
                intr.guildId!,
                tempChannelData.channelId
            );

            if (!result.success) {
                await intr.reply({
                    content: `❌ ${result.message}`,
                    ephemeral: true
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('🔓 Channel entsperrt!')
                .setDescription(`Der Channel wurde für neue Nutzer entsperrt.`)
                .addFields(
                    { name: '🔐 Status', value: 'Entsperrt', inline: true },
                    { name: '📢 Channel', value: `<#${tempChannelData.channelId}>`, inline: true }
                )
                .setColor(0x00ff00)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Channel Unlocked • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Entsperren des Channels', error);
            await intr.reply({
                content: '❌ Fehler beim Entsperren des Channels!',
                ephemeral: true
            });
        }
    }
}

// 9. /byvoiceclaim - Channel beanspruchen
export class TempVoiceClaimCommand implements Command {
    public names = ['byvoiceclaim'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['ManageChannels'];
    public cooldown = new RateLimiter(1, 5000);

    public metadata = {
        name: 'byvoiceclaim',
        description: 'Beansprucht einen temporären Voice-Channel ohne Besitzer',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoiceclaim')
        .setDescription('Beansprucht einen temporären Voice-Channel ohne Besitzer');

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const tempChannelData = (tempVoiceModule as any).isInTempChannel(intr);
        if (!tempChannelData) {
            await intr.reply({
                content: '❌ Du bist nicht in einem temporären Voice-Channel!',
                ephemeral: true
            });
            return;
        }

        if (tempChannelData.ownerId && intr.guild!.members.cache.get(tempChannelData.ownerId)) {
            await intr.reply({
                content: '❌ Dieser Channel hat bereits einen aktiven Besitzer!',
                ephemeral: true
            });
            return;
        }

        try {
            const result = await (tempVoiceModule as any).claimChannel(
                intr.guildId!,
                tempChannelData.channelId,
                intr.user.id
            );

            if (!result.success) {
                await intr.reply({
                    content: `❌ ${result.message}`,
                    ephemeral: true
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Channel beansprucht!')
                .setDescription(`Du bist jetzt der Besitzer dieses Channels.`)
                .addFields(
                    { name: '👤 Neuer Besitzer', value: `${intr.user}`, inline: true },
                    { name: '📢 Channel', value: `<#${tempChannelData.channelId}>`, inline: true }
                )
                .setColor(0x00ff00)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Channel Claimed • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Beanspruchen des Channels', error);
            await intr.reply({
                content: '❌ Fehler beim Beanspruchen des Channels!',
                ephemeral: true
            });
        }
    }
}

// 10. /byvoiceban - Nutzer verbannen
export class TempVoiceBanCommand implements Command {
    public names = ['byvoiceban'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['ManageChannels', 'MoveMembers'];
    public cooldown = new RateLimiter(1, 3000);

    public metadata = {
        name: 'byvoiceban',
        description: 'Verbannt einen Nutzer aus dem temporären Voice-Channel',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoiceban')
        .setDescription('Verbannt einen Nutzer aus dem temporären Voice-Channel')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Nutzer zum Verbannen')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Grund für den Bann')
                .setRequired(false)
                .setMaxLength(200));

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const targetUser = intr.options.getUser('user', true);
        const reason = intr.options.getString('reason') || 'Kein Grund angegeben';

        const tempChannelData = (tempVoiceModule as any).isInTempChannel(intr);
        if (!tempChannelData) {
            await intr.reply({
                content: '❌ Du bist nicht in einem temporären Voice-Channel!',
                ephemeral: true
            });
            return;
        }

        if (!(tempVoiceModule as any).isChannelOwner(intr.guildId!, (intr.member as GuildMember).voice.channel!.id, intr.user.id)) {
            await intr.reply({
                content: '❌ Nur der Channel-Besitzer kann Nutzer verbannen!',
                ephemeral: true
            });
            return;
        }

        if (targetUser.id === intr.user.id) {
            await intr.reply({
                content: '❌ Du kannst dich nicht selbst verbannen!',
                ephemeral: true
            });
            return;
        }

        const targetMember = intr.guild!.members.cache.get(targetUser.id);
        if (!targetMember) {
            await intr.reply({
                content: '❌ Der Nutzer ist nicht auf diesem Server!',
                ephemeral: true
            });
            return;
        }

        try {
            const result = await (tempVoiceModule as any).banUserFromChannel(
                intr.guildId!,
                tempChannelData.channelId,
                targetUser.id,
                reason
            );

            if (!result.success) {
                await intr.reply({
                    content: `❌ ${result.message}`,
                    ephemeral: true
                });
                return;
            }

            // Nutzer aus dem Channel entfernen, falls er drin ist
            if (targetMember.voice.channel && targetMember.voice.channel.id === tempChannelData.channelId) {
                try {
                    await targetMember.voice.disconnect('Channel-Bann');
                } catch (error) {
                    Logger.warn('Konnte gebannten Nutzer nicht disconnecten', error);
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('🔨 Nutzer verbannt!')
                .setDescription(`Der Nutzer wurde aus dem Channel verbannt.`)
                .addFields(
                    { name: '👤 Verbannter Nutzer', value: `${targetUser}`, inline: true },
                    { name: '📝 Grund', value: reason, inline: true },
                    { name: '📢 Channel', value: `<#${tempChannelData.channelId}>`, inline: false }
                )
                .setColor(0xff0000)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • User Banned • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Verbannen des Nutzers', error);
            await intr.reply({
                content: '❌ Fehler beim Verbannen des Nutzers!',
                ephemeral: true
            });
        }
    }
}
// 11. /byvoiceunban - Nutzer entbannen
export class TempVoiceUnbanCommand implements Command {
    public names = ['byvoiceunban'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['ManageChannels'];
    public cooldown = new RateLimiter(1, 3000);

    public metadata = {
        name: 'byvoiceunban',
        description: 'Entbannt einen Nutzer aus dem temporären Voice-Channel',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoiceunban')
        .setDescription('Entbannt einen Nutzer aus dem temporären Voice-Channel')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Nutzer zum Entbannen')
                .setRequired(true));

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const targetUser = intr.options.getUser('user', true);

        const tempChannelData = (tempVoiceModule as any).isInTempChannel(intr);
        if (!tempChannelData) {
            await intr.reply({
                content: '❌ Du bist nicht in einem temporären Voice-Channel!',
                ephemeral: true
            });
            return;
        }

        if (!(tempVoiceModule as any).isChannelOwner(intr.guildId!, (intr.member as GuildMember).voice.channel!.id, intr.user.id)) {
            await intr.reply({
                content: '❌ Nur der Channel-Besitzer kann Nutzer entbannen!',
                ephemeral: true
            });
            return;
        }

        try {
            const result = await (tempVoiceModule as any).unbanUserFromChannel(
                intr.guildId!,
                tempChannelData.channelId,
                targetUser.id
            );

            if (!result.success) {
                await intr.reply({
                    content: `❌ ${result.message}`,
                    ephemeral: true
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Nutzer entbannt!')
                .setDescription(`Der Nutzer wurde aus der Bannliste entfernt.`)
                .addFields(
                    { name: '👤 Entbannter Nutzer', value: `${targetUser}`, inline: true },
                    { name: '📢 Channel', value: `<#${tempChannelData.channelId}>`, inline: true }
                )
                .setColor(0x00ff00)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • User Unbanned • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Entbannen des Nutzers', error);
            await intr.reply({
                content: '❌ Fehler beim Entbannen des Nutzers!',
                ephemeral: true
            });
        }
    }
}

// 12. /byvoicekick - Nutzer rauswerfen
export class TempVoiceKickCommand implements Command {
    public names = ['byvoicekick'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['MoveMembers'];
    public cooldown = new RateLimiter(1, 3000);

    public metadata = {
        name: 'byvoicekick',
        description: 'Wirft einen Nutzer aus dem temporären Voice-Channel',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicekick')
        .setDescription('Wirft einen Nutzer aus dem temporären Voice-Channel')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Nutzer zum Rauswerfen')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Grund für den Kick')
                .setRequired(false)
                .setMaxLength(200));

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const targetUser = intr.options.getUser('user', true);
        const reason = intr.options.getString('reason') || 'Kein Grund angegeben';

        const tempChannelData = (tempVoiceModule as any).isInTempChannel(intr);
        if (!tempChannelData) {
            await intr.reply({
                content: '❌ Du bist nicht in einem temporären Voice-Channel!',
                ephemeral: true
            });
            return;
        }

        if (!(tempVoiceModule as any).isChannelOwner(intr.guildId!, (intr.member as GuildMember).voice.channel!.id, intr.user.id)) {
            await intr.reply({
                content: '❌ Nur der Channel-Besitzer kann Nutzer rauswerfen!',
                ephemeral: true
            });
            return;
        }

        if (targetUser.id === intr.user.id) {
            await intr.reply({
                content: '❌ Du kannst dich nicht selbst rauswerfen!',
                ephemeral: true
            });
            return;
        }

        const targetMember = intr.guild!.members.cache.get(targetUser.id);
        if (!targetMember) {
            await intr.reply({
                content: '❌ Der Nutzer ist nicht auf diesem Server!',
                ephemeral: true
            });
            return;
        }

        if (!targetMember.voice.channel || targetMember.voice.channel.id !== tempChannelData.channelId) {
            await intr.reply({
                content: '❌ Der Nutzer ist nicht in diesem Channel!',
                ephemeral: true
            });
            return;
        }

        try {
            await targetMember.voice.disconnect(reason);

            const embed = new EmbedBuilder()
                .setTitle('👢 Nutzer rausgeworfen!')
                .setDescription(`Der Nutzer wurde aus dem Channel entfernt.`)
                .addFields(
                    { name: '👤 Rausgeworfener Nutzer', value: `${targetUser}`, inline: true },
                    { name: '📝 Grund', value: reason, inline: true },
                    { name: '📢 Channel', value: `<#${tempChannelData.channelId}>`, inline: false }
                )
                .setColor(0xffa500)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • User Kicked • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Rauswerfen des Nutzers', error);
            await intr.reply({
                content: '❌ Fehler beim Rauswerfen des Nutzers!',
                ephemeral: true
            });
        }
    }
}

// 13. /byvoicestatus - Channel-Status
export class TempVoiceStatusCommand implements Command {
    public names = ['byvoicestatus'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = [];
    public cooldown = new RateLimiter(1, 5000);

    public metadata = {
        name: 'byvoicestatus',
        description: 'Zeigt den Status des temporären Voice-Channels an',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicestatus')
        .setDescription('Zeigt den Status des temporären Voice-Channels an');

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const tempChannelData = (tempVoiceModule as any).isInTempChannel(intr);
        if (!tempChannelData) {
            await intr.reply({
                content: '❌ Du bist nicht in einem temporären Voice-Channel!',
                ephemeral: true
            });
            return;
        }

        try {
            const channel = intr.guild!.channels.cache.get(tempChannelData.channelId);
            if (!channel || !channel.isVoiceBased()) {
                await intr.reply({
                    content: '❌ Channel nicht gefunden!',
                    ephemeral: true
                });
                return;
            }

            const owner = tempChannelData.ownerId ? await intr.guild!.members.fetch(tempChannelData.ownerId).catch(() => null) : null;
            const bannedUsers = tempChannelData.bannedUsers || [];
            const createdAt = tempChannelData.createdAt ? new Date(tempChannelData.createdAt) : new Date();

            const statusEmoji = {
                locked: tempChannelData.isLocked ? '🔒' : '🔓',
                hidden: tempChannelData.isHidden ? '👁️‍🗨️' : '👁️',
                limit: channel.userLimit === 0 ? '∞' : channel.userLimit.toString()
            };

            const embed = new EmbedBuilder()
                .setTitle('📊 Channel-Status')
                .setDescription(`Status-Informationen für ${channel.name}`)
                .addFields(
                    { name: '📢 Channel', value: `<#${channel.id}>`, inline: true },
                    { name: '👤 Besitzer', value: owner ? `${owner.user}` : 'Kein Besitzer', inline: true },
                    { name: '👥 Nutzer', value: `${channel.members.size}/${statusEmoji.limit}`, inline: true },
                    { name: '🔐 Gesperrt', value: statusEmoji.locked, inline: true },
                    { name: '👁️ Sichtbar', value: statusEmoji.hidden, inline: true },
                    { name: '🚫 Gebannt', value: bannedUsers.length.toString(), inline: true },
                    { name: '⏰ Erstellt', value: `<t:${Math.floor(createdAt.getTime() / 1000)}:R>`, inline: false }
                )
                .setColor(0x5865f2)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Channel Status • MongoDB' });

            if (bannedUsers.length > 0) {
                const bannedList = await Promise.all(
                    bannedUsers.slice(0, 5).map(async (userId: string) => {
                        try {
                            const user = await intr.client.users.fetch(userId);
                            return user.tag;
                        } catch {
                            return `Unbekannter Nutzer (${userId})`;
                        }
                    })
                );

                embed.addFields({
                    name: '🚫 Gebannte Nutzer',
                    value: bannedList.join('\n') + (bannedUsers.length > 5 ? `\n... und ${bannedUsers.length - 5} weitere` : ''),
                    inline: false
                });
            }

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Abrufen des Channel-Status', error);
            await intr.reply({
                content: '❌ Fehler beim Abrufen des Status!',
                ephemeral: true
            });
        }
    }
}

// 14. /byvoicelist - Admin Channel-Liste
export class TempVoiceListCommand implements Command {
    public names = ['byvoicelist'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = [];
    public cooldown = new RateLimiter(1, 10000);

    public metadata = {
        name: 'byvoicelist',
        description: 'Zeigt alle aktiven temporären Voice-Channels an (Admin)',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
        defaultMemberPermissions: PermissionFlagsBits.ManageChannels,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicelist')
        .setDescription('Zeigt alle aktiven temporären Voice-Channels an (Admin)')
        .addIntegerOption(option =>
            option.setName('page')
                .setDescription('Seite der Ergebnisse')
                .setRequired(false)
                .setMinValue(1))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const page = intr.options.getInteger('page') || 1;
        const pageSize = 10;

        try {
            const allChannels = await (tempVoiceModule as any).getAllTempChannels(intr.guildId!);
            
            if (allChannels.length === 0) {
                await intr.reply({
                    content: '📝 Keine aktiven temporären Voice-Channels gefunden.',
                    ephemeral: true
                });
                return;
            }

            const totalPages = Math.ceil(allChannels.length / pageSize);
            const startIndex = (page - 1) * pageSize;
            const endIndex = Math.min(startIndex + pageSize, allChannels.length);
            const channelsOnPage = allChannels.slice(startIndex, endIndex);

            const embed = new EmbedBuilder()
                .setTitle('📋 Aktive TempVoice-Channels')
                .setDescription(`Seite ${page} von ${totalPages} • Gesamt: ${allChannels.length} Channels`)
                .setColor(0x5865f2)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Channel List • MongoDB' });

            for (const channelData of channelsOnPage) {
                const channel = intr.guild!.channels.cache.get(channelData.channelId);
                const owner = channelData.ownerId ? await intr.guild!.members.fetch(channelData.ownerId).catch(() => null) : null;
                
                const statusIcons = [
                    channelData.isLocked ? '🔒' : '',
                    channelData.isHidden ? '👁️‍🗨️' : '',
                    channelData.bannedUsers?.length > 0 ? '🚫' : ''
                ].filter(Boolean).join(' ');

                const channelInfo = channel
                    ? `<#${channel.id}> (${channel.members.size} Nutzer)`
                    : `Gelöschter Channel (${channelData.channelId})`;

                embed.addFields({
                    name: `${channelInfo} ${statusIcons}`,
                    value: `👤 **Besitzer:** ${owner ? owner.user.tag : 'Kein Besitzer'}\n⏰ **Erstellt:** <t:${Math.floor(new Date(channelData.createdAt).getTime() / 1000)}:R>`,
                    inline: false
                });
            }

            if (totalPages > 1) {
                embed.addFields({
                    name: '📖 Navigation',
                    value: `Verwende \`/byvoicelist page:${page + 1}\` für die nächste Seite`,
                    inline: false
                });
            }

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Abrufen der Channel-Liste', error);
            await intr.reply({
                content: '❌ Fehler beim Abrufen der Channel-Liste!',
                ephemeral: true
            });
        }
    }
}

// 15. /byvoicestats - Erweiterte Statistiken
export class TempVoiceStatsCommand implements Command {
    public names = ['byvoicestats'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = [];
    public cooldown = new RateLimiter(1, 10000);

    public metadata = {
        name: 'byvoicestats',
        description: 'Zeigt erweiterte TempVoice-Statistiken an',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicestats')
        .setDescription('Zeigt erweiterte TempVoice-Statistiken an')
        .addStringOption(option =>
            option.setName('timeframe')
                .setDescription('Zeitraum für die Statistiken')
                .setRequired(false)
                .addChoices(
                    { name: 'Heute', value: 'today' },
                    { name: 'Diese Woche', value: 'week' },
                    { name: 'Dieser Monat', value: 'month' },
                    { name: 'Alle Zeit', value: 'all' }
                ));

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const timeframe = intr.options.getString('timeframe') || 'all';

        try {
            const stats = await (tempVoiceModule as any).getDetailedStats(intr.guildId!, timeframe);
            
            const embed = new EmbedBuilder()
                .setTitle('📈 TempVoice-Statistiken')
                .setDescription(`Statistiken für ${this.getTimeframeText(timeframe)}`)
                .addFields(
                    { name: '📊 Allgemeine Statistiken', value: [
                        `📢 **Aktive Channels:** ${stats.activeChannels}`,
                        `🔧 **Creator-Channels:** ${stats.creatorChannels}`,
                        `👥 **Aktive Nutzer:** ${stats.activeUsers}`,
                        `⚡ **Durchschn. Response:** ${stats.averageResponseTime}ms`
                    ].join('\n'), inline: true },
                    { name: '📈 Channel-Aktivität', value: [
                        `✅ **Erstellt:** ${stats.channelsCreated}`,
                        `🗑️ **Gelöscht:** ${stats.channelsDeleted}`,
                        `📊 **Durchschn. Dauer:** ${stats.averageChannelDuration}`,
                        `👑 **Besitzer-Wechsel:** ${stats.ownershipChanges}`
                    ].join('\n'), inline: true },
                    { name: '🔧 Aktionen', value: [
                        `🔒 **Sperren/Entsperren:** ${stats.lockActions}`,
                        `👁️ **Verstecken/Zeigen:** ${stats.visibilityActions}`,
                        `🚫 **Bans/Unbans:** ${stats.banActions}`,
                        `👢 **Kicks:** ${stats.kickActions}`
                    ].join('\n'), inline: true }
                )
                .setColor(0x5865f2)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Statistics • MongoDB' });

            if (stats.topUsers && stats.topUsers.length > 0) {
                const topUsersList = await Promise.all(
                    stats.topUsers.slice(0, 5).map(async (userData: any, index: number) => {
                        try {
                            const user = await intr.client.users.fetch(userData.userId);
                            return `${index + 1}. ${user.tag} (${userData.channelCount} Channels)`;
                        } catch {
                            return `${index + 1}. Unbekannter Nutzer (${userData.channelCount} Channels)`;
                        }
                    })
                );

                embed.addFields({
                    name: '🏆 Top Channel-Ersteller',
                    value: topUsersList.join('\n'),
                    inline: false
                });
            }

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Abrufen der Statistiken', error);
            await intr.reply({
                content: '❌ Fehler beim Abrufen der Statistiken!',
                ephemeral: true
            });
        }
    }

    private getTimeframeText(timeframe: string): string {
        switch (timeframe) {
            case 'today': return 'heute';
            case 'week': return 'diese Woche';
            case 'month': return 'diesen Monat';
            case 'all': return 'alle Zeit';
            default: return 'alle Zeit';
        }
    }
}
// 16. /byvoicecleanup - Admin Cleanup
export class TempVoiceCleanupCommand implements Command {
    public names = ['byvoicecleanup'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['ManageChannels'];
    public cooldown = new RateLimiter(1, 30000);

    public metadata = {
        name: 'byvoicecleanup',
        description: 'Bereinigt verwaiste und leere temporäre Voice-Channels (Admin)',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
        defaultMemberPermissions: PermissionFlagsBits.ManageChannels,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicecleanup')
        .setDescription('Bereinigt verwaiste und leere temporäre Voice-Channels (Admin)')
        .addBooleanOption(option =>
            option.setName('force')
                .setDescription('Erzwingt die Bereinigung aller leeren Channels')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('max_age')
                .setDescription('Maximales Alter in Minuten für leere Channels')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(1440))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const force = intr.options.getBoolean('force') || false;
        const maxAge = intr.options.getInteger('max_age') || 5; // Standard: 5 Minuten

        await intr.deferReply({ ephemeral: true });

        try {
            const cleanupResult = await (tempVoiceModule as any).cleanupChannels(
                intr.guildId!,
                force,
                maxAge * 60 * 1000 // Umrechnung in Millisekunden
            );

            const embed = new EmbedBuilder()
                .setTitle('🧹 Cleanup abgeschlossen!')
                .setDescription('Die Bereinigung der temporären Voice-Channels wurde durchgeführt.')
                .addFields(
                    { name: '🗑️ Gelöschte Channels', value: cleanupResult.deletedChannels.toString(), inline: true },
                    { name: '📝 Bereinigte Datensätze', value: cleanupResult.cleanedRecords.toString(), inline: true },
                    { name: '⏱️ Verarbeitungszeit', value: `${cleanupResult.processingTime}ms`, inline: true }
                )
                .setColor(0x00ff00)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Cleanup Complete • MongoDB' });

            if (cleanupResult.deletedChannels > 0) {
                embed.addFields({
                    name: '📋 Details',
                    value: [
                        `🔹 **Verwaiste Channels:** ${cleanupResult.orphanedChannels}`,
                        `🔹 **Leere Channels:** ${cleanupResult.emptyChannels}`,
                        `🔹 **Fehlerhafte Channels:** ${cleanupResult.errorChannels}`
                    ].join('\n'),
                    inline: false
                });
            }

            await intr.editReply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Cleanup der Channels', error);
            await intr.editReply({
                content: '❌ Fehler beim Cleanup der Channels!'
            });
        }
    }
}

// 17. /byvoiceconfig - Server-Konfiguration
export class TempVoiceConfigCommand implements Command {
    public names = ['byvoiceconfig'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['ManageChannels'];
    public cooldown = new RateLimiter(1, 5000);

    public metadata = {
        name: 'byvoiceconfig',
        description: 'Konfiguriert TempVoice-Einstellungen für den Server (Admin)',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
        defaultMemberPermissions: PermissionFlagsBits.Administrator,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoiceconfig')
        .setDescription('Konfiguriert TempVoice-Einstellungen für den Server (Admin)')
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('Zeigt aktuelle Konfiguration an'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Ändert Konfigurationseinstellungen')
                .addIntegerOption(option =>
                    option.setName('default_max_users')
                        .setDescription('Standard max. Nutzer für neue Channels')
                        .setRequired(false)
                        .setMinValue(0)
                        .setMaxValue(99))
                .addIntegerOption(option =>
                    option.setName('cleanup_interval')
                        .setDescription('Cleanup-Intervall in Sekunden')
                        .setRequired(false)
                        .setMinValue(30)
                        .setMaxValue(3600))
                .addBooleanOption(option =>
                    option.setName('auto_delete_text')
                        .setDescription('Text-Channels automatisch löschen')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('log_actions')
                        .setDescription('Aktionen protokollieren')
                        .setRequired(false))
                .addChannelOption(option =>
                    option.setName('log_channel')
                        .setDescription('Channel für Logs')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Setzt Konfiguration auf Standard zurück'))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const subcommand = intr.options.getSubcommand();
        
        if (subcommand === 'view') {
            await this.viewConfig(intr);
        } else if (subcommand === 'set') {
            await this.setConfig(intr);
        } else if (subcommand === 'reset') {
            await this.resetConfig(intr);
        }
    }

    private async viewConfig(intr: ChatInputCommandInteraction): Promise<void> {
        try {
            const config = (tempVoiceModule as any).getGuildConfig(intr.guildId!);
            
            const creatorChannelList = config.creatorChannels && config.creatorChannels.length > 0
                ? await Promise.all(
                    config.creatorChannels.map(async (channelId: string) => {
                        const channel = intr.guild!.channels.cache.get(channelId);
                        return channel ? `<#${channel.id}>` : `Gelöschter Channel (${channelId})`;
                    })
                ).then(channels => channels.join('\n'))
                : 'Keine Creator-Channels konfiguriert';

            const logChannel = config.logChannelId ? intr.guild!.channels.cache.get(config.logChannelId) : null;

            const embed = new EmbedBuilder()
                .setTitle('⚙️ TempVoice-Konfiguration')
                .setDescription(`Aktuelle Einstellungen für ${intr.guild!.name}`)
                .addFields(
                    { name: '📢 Creator-Channels', value: creatorChannelList, inline: false },
                    { name: '👥 Standard Max. Nutzer', value: config.defaultMaxUsers?.toString() || '0 (unbegrenzt)', inline: true },
                    { name: '🧹 Cleanup-Intervall', value: `${config.cleanupInterval || 300}s`, inline: true },
                    { name: '📝 Auto-Delete Text', value: config.autoDeleteText ? '✅ Aktiviert' : '❌ Deaktiviert', inline: true },
                    { name: '📋 Aktionen protokollieren', value: config.logActions ? '✅ Aktiviert' : '❌ Deaktiviert', inline: true },
                    { name: '📤 Log-Channel', value: logChannel ? `<#${logChannel.id}>` : 'Nicht konfiguriert', inline: true },
                    { name: '📊 Statistiken sammeln', value: config.collectStats ? '✅ Aktiviert' : '❌ Deaktiviert', inline: true }
                )
                .setColor(0x5865f2)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Configuration • MongoDB' });

            await intr.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            Logger.error('Fehler beim Abrufen der Konfiguration', error);
            await intr.reply({
                content: '❌ Fehler beim Abrufen der Konfiguration!',
                ephemeral: true
            });
        }
    }

    private async setConfig(intr: ChatInputCommandInteraction): Promise<void> {
        try {
            const updates: any = {};
            
            const defaultMaxUsers = intr.options.getInteger('default_max_users');
            const cleanupInterval = intr.options.getInteger('cleanup_interval');
            const autoDeleteText = intr.options.getBoolean('auto_delete_text');
            const logActions = intr.options.getBoolean('log_actions');
            const logChannel = intr.options.getChannel('log_channel');

            if (defaultMaxUsers !== null) updates.defaultMaxUsers = defaultMaxUsers;
            if (cleanupInterval !== null) updates.cleanupInterval = cleanupInterval;
            if (autoDeleteText !== null) updates.autoDeleteText = autoDeleteText;
            if (logActions !== null) updates.logActions = logActions;
            if (logChannel !== null) updates.logChannelId = logChannel.id;

            if (Object.keys(updates).length === 0) {
                await intr.reply({
                    content: '❌ Keine Änderungen angegeben!',
                    ephemeral: true
                });
                return;
            }

            const result = await (tempVoiceModule as any).updateGuildConfig(intr.guildId!, updates);

            if (!result.success) {
                await intr.reply({
                    content: `❌ ${result.message}`,
                    ephemeral: true
                });
                return;
            }

            const changedSettings = Object.keys(updates).map(key => {
                const value = updates[key];
                switch (key) {
                    case 'defaultMaxUsers': return `👥 **Standard Max. Nutzer:** ${value === 0 ? 'Unbegrenzt' : value}`;
                    case 'cleanupInterval': return `🧹 **Cleanup-Intervall:** ${value}s`;
                    case 'autoDeleteText': return `📝 **Auto-Delete Text:** ${value ? 'Aktiviert' : 'Deaktiviert'}`;
                    case 'logActions': return `📋 **Aktionen protokollieren:** ${value ? 'Aktiviert' : 'Deaktiviert'}`;
                    case 'logChannelId': return `📤 **Log-Channel:** <#${value}>`;
                    default: return `**${key}:** ${value}`;
                }
            });

            const embed = new EmbedBuilder()
                .setTitle('✅ Konfiguration aktualisiert!')
                .setDescription('Die TempVoice-Einstellungen wurden erfolgreich geändert.')
                .addFields({
                    name: '🔧 Geänderte Einstellungen',
                    value: changedSettings.join('\n'),
                    inline: false
                })
                .setColor(0x00ff00)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Configuration Updated • MongoDB' });

            await intr.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            Logger.error('Fehler beim Aktualisieren der Konfiguration', error);
            await intr.reply({
                content: '❌ Fehler beim Aktualisieren der Konfiguration!',
                ephemeral: true
            });
        }
    }

    private async resetConfig(intr: ChatInputCommandInteraction): Promise<void> {
        try {
            const result = await (tempVoiceModule as any).resetGuildConfig(intr.guildId!);

            if (!result.success) {
                await intr.reply({
                    content: `❌ ${result.message}`,
                    ephemeral: true
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('🔄 Konfiguration zurückgesetzt!')
                .setDescription('Die TempVoice-Einstellungen wurden auf die Standardwerte zurückgesetzt.')
                .addFields({
                    name: '📋 Standard-Einstellungen',
                    value: [
                        '👥 **Standard Max. Nutzer:** 0 (unbegrenzt)',
                        '🧹 **Cleanup-Intervall:** 300s',
                        '📝 **Auto-Delete Text:** Deaktiviert',
                        '📋 **Aktionen protokollieren:** Deaktiviert',
                        '📤 **Log-Channel:** Nicht konfiguriert'
                    ].join('\n'),
                    inline: false
                })
                .setColor(0xffa500)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Configuration Reset • MongoDB' });

            await intr.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            Logger.error('Fehler beim Zurücksetzen der Konfiguration', error);
            await intr.reply({
                content: '❌ Fehler beim Zurücksetzen der Konfiguration!',
                ephemeral: true
            });
        }
    }
}

// Hilfsfunktionen für bessere Code-Organisation
export class TempVoiceCommandUtils {
    /**
     * Überprüft, ob ein Nutzer der Besitzer eines TempVoice-Channels ist
     */
    public static isChannelOwner(guildId: string, channelId: string, userId: string): boolean {
        return (tempVoiceModule as any).isChannelOwner(guildId, channelId, userId);
    }

    /**
     * Überprüft, ob ein Nutzer in einem TempVoice-Channel ist
     */
    public static isInTempChannel(interaction: ChatInputCommandInteraction): any {
        return (tempVoiceModule as any).isInTempChannel(interaction);
    }

    /**
     * Formatiert die Dauer in einem menschenlesbaren Format
     */
    public static formatDuration(milliseconds: number): string {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    /**
     * Erstellt eine Standard-Fehler-Embed
     */
    public static createErrorEmbed(title: string, message: string): EmbedBuilder {
        return new EmbedBuilder()
            .setTitle(`❌ ${title}`)
            .setDescription(message)
            .setColor(0xff0000)
            .setTimestamp()
            .setFooter({ text: 'TempVoice • Error • MongoDB' });
    }

    /**
     * Erstellt eine Standard-Erfolg-Embed
     */
    public static createSuccessEmbed(title: string, message: string): EmbedBuilder {
        return new EmbedBuilder()
            .setTitle(`✅ ${title}`)
            .setDescription(message)
            .setColor(0x00ff00)
            .setTimestamp()
            .setFooter({ text: 'TempVoice • Success • MongoDB' });
    }

    /**
     * Validiert Channel-Namen
     */
    public static validateChannelName(name: string): { valid: boolean; message?: string } {
        if (name.length < 1) {
            return { valid: false, message: 'Der Channel-Name darf nicht leer sein!' };
        }
        if (name.length > 100) {
            return { valid: false, message: 'Der Channel-Name darf nicht länger als 100 Zeichen sein!' };
        }
        if (!/^[a-zA-Z0-9\s\-_äöüÄÖÜß]+$/.test(name)) {
            return { valid: false, message: 'Der Channel-Name enthält ungültige Zeichen!' };
        }
        return { valid: true };
    }

    /**
     * Konvertiert Berechtigungen zu menschenlesbaren Strings
     */
    public static formatPermissions(permissions: PermissionsString[]): string {
        const permissionMap: Record<string, string> = {
            'ManageChannels': 'Channels verwalten',
            'Connect': 'Verbinden',
            'MoveMembers': 'Mitglieder verschieben',
            'ViewChannel': 'Channel anzeigen',
            'Administrator': 'Administrator'
        };

        return permissions.map(perm => permissionMap[perm] || perm).join(', ');
    }
}

// Export aller Commands für einfache Registrierung
export const ALL_TEMPVOICE_COMMANDS = [
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
] as const;