// src/commands/chat/tempvoice-commands.ts - TempVoice Slash Commands (TEIL 1/4)
import {
    ApplicationCommandType,
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ChannelType,
    CommandInteraction,
    GuildMember,
    VoiceChannel,
    TextChannel,
    User,
    ChatInputCommandInteraction,
    PermissionsString
} from 'discord.js';

import { Command, CommandDeferType } from '../index.js';
import { tempVoiceModule } from '../../modules/tempvoice/index.js';
import { Logger } from '../../services/index.js';
import { EventData } from '../../models/internal-models.js';

// 1. /byvoicetempcreate - Creator Channel erstellen
export class TempVoiceCreateCommand implements Command {
    public names = ['byvoicetempcreate'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['ManageChannels', 'ManageRoles'];

    public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
        const channelName = intr.options.getString('channelname', true);
        const maxSlots = intr.options.getInteger('maxslots') || 3;
        const category = intr.options.getChannel('kategorie');
        
        try {
            // Erstelle Creator Channel
            const creatorChannel = await intr.guild!.channels.create({
                name: channelName,
                type: ChannelType.GuildVoice,
                parent: category?.id,
                userLimit: 1,
                permissionOverwrites: [
                    {
                        id: intr.guild!.id,
                        allow: ['ViewChannel', 'Connect']
                    }
                ]
            });

            // Update Config in MongoDB
            const config = await (tempVoiceModule as any).getGuildConfig(intr.guildId!);
            if (!config.creatorChannels.includes(creatorChannel.id)) {
                config.creatorChannels.push(creatorChannel.id);
                config.defaultMaxUsers = maxSlots;
                await (tempVoiceModule as any).saveGuildConfig(intr.guildId!, config);
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Creator-Channel erstellt!')
                .setDescription(`Der Creator-Channel **${channelName}** wurde erfolgreich erstellt!`)
                .setColor(0x00ff00)
                .addFields(
                    { name: '📢 Channel', value: `${creatorChannel}`, inline: true },
                    { name: '📁 Kategorie', value: category ? category.name : 'Keine Kategorie', inline: true },
                    { name: '👥 Standard Max-Users', value: `${maxSlots === 0 ? 'Unbegrenzt' : maxSlots}`, inline: true },
                    { name: '🎯 Funktionsweise', value: 'Wenn jemand diesem Channel beitritt, wird automatisch ein temporärer Voice-Channel mit Text-Channel erstellt!', inline: false },
                    { name: '🗑️ Auto-Löschung', value: 'Temporäre Channels werden automatisch gelöscht wenn sie leer sind.', inline: false },
                    { name: '🗄️ Datenspeicherung', value: 'MongoDB mit verbesserter Performance und Statistiken', inline: false }
                )
                .setFooter({ text: 'TempVoice System • MongoDB • Erfolgreich konfiguriert' })
                .setTimestamp();

            await intr.reply({ embeds: [embed] });

            Logger.info(`✅ Creator-Channel erstellt: ${channelName} (${creatorChannel.id}) mit max ${maxSlots} Users - MongoDB`);
        } catch (error) {
            Logger.error('Fehler beim Erstellen des Creator-Channels', error);
            await intr.reply({
                content: `❌ Fehler beim Erstellen des Creator-Channels: ${error}`,
                ephemeral: true
            });
        }
    }
}

// 2. /byvoicesetowner - Besitzer ändern
export class TempVoiceSetOwnerCommand implements Command {
    public names = ['byvoicesetowner'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['ManageChannels', 'ManageRoles'];

    public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
        const newOwner = intr.options.getUser('user', true);
        
        const tempChannelData = tempVoiceModule.isInTempChannel(intr);
        if (!tempChannelData) {
            await intr.reply({
                content: '❌ Du bist nicht in einem temporären Voice-Channel!',
                ephemeral: true
            });
            return;
        }

        if (!tempVoiceModule.isChannelOwner(intr.guildId!, (intr.member as GuildMember).voice.channel!.id, intr.user.id)) {
            await intr.reply({
                content: '❌ Nur der Channel-Besitzer kann den Besitzer ändern!',
                ephemeral: true
            });
            return;
        }

        const newOwnerMember = intr.guild!.members.cache.get(newOwner.id);
        if (!newOwnerMember?.voice.channel || newOwnerMember.voice.channel.id !== (intr.member as GuildMember).voice.channel!.id) {
            await intr.reply({
                content: '❌ Der neue Besitzer muss sich im Voice-Channel befinden!',
                ephemeral: true
            });
            return;
        }

        const oldOwnerId = tempChannelData.ownerId;

        try {
            // Update owner data in MongoDB
            tempChannelData.ownerId = newOwner.id;
            tempChannelData.ownerName = newOwnerMember.displayName;
            await (tempVoiceModule as any).setTempChannel(intr.guildId!, (intr.member as GuildMember).voice.channel!.id, tempChannelData);

            // Update permissions
            const voiceChannel = (intr.member as GuildMember).voice.channel as VoiceChannel;
            const textChannel = intr.guild!.channels.cache.get(tempChannelData.textChannelId) as TextChannel;
            
            await (tempVoiceModule as any).updateOwnerPermissions(voiceChannel, textChannel, newOwnerMember, oldOwnerId);

            // Log ownership change
            await (tempVoiceModule as any).updateTempChannelActivity(intr.guildId!, voiceChannel.id, 'owner_changed', newOwner.id);

            const embed = new EmbedBuilder()
                .setTitle('👑 Besitzer geändert')
                .setDescription(`**${newOwnerMember.displayName}** ist jetzt der neue Besitzer des Channels!`)
                .addFields(
                    { name: '👤 Neuer Besitzer', value: `${newOwnerMember}`, inline: true },
                    { name: '👤 Vorheriger Besitzer', value: `<@${oldOwnerId}>`, inline: true },
                    { name: '🔄 Geändert von', value: `${intr.user}`, inline: true }
                )
                .setColor(0x00ff00)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Besitzer-Wechsel • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Übertragen der Besitzer-Rechte', error);
            await intr.reply({
                content: '❌ Fehler beim Übertragen der Besitzer-Rechte!',
                ephemeral: true
            });
        }
    }
}

// 3. /byvoicesetlimit - User-Limit setzen
export class TempVoiceSetLimitCommand implements Command {
    public names = ['byvoicesetlimit'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['ManageChannels'];

    public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
        const limit = intr.options.getInteger('zahl', true);
        
        const tempChannelData = tempVoiceModule.isInTempChannel(intr);
        if (!tempChannelData) {
            await intr.reply({
                content: '❌ Du bist nicht in einem temporären Voice-Channel!',
                ephemeral: true
            });
            return;
        }

        if (!tempVoiceModule.isChannelOwner(intr.guildId!, (intr.member as GuildMember).voice.channel!.id, intr.user.id)) {
            await intr.reply({
                content: '❌ Nur der Channel-Besitzer kann das Limit ändern!',
                ephemeral: true
            });
            return;
        }

        try {
            const voiceChannel = (intr.member as GuildMember).voice.channel as VoiceChannel;
            await voiceChannel.setUserLimit(limit);
            
            // Update in MongoDB
            tempChannelData.maxUsers = limit;
            await (tempVoiceModule as any).setTempChannel(intr.guildId!, voiceChannel.id, tempChannelData);

            // Log limit change
            await (tempVoiceModule as any).updateTempChannelActivity(intr.guildId!, voiceChannel.id, 'limit_changed', intr.user.id);

            const embed = new EmbedBuilder()
                .setTitle('👥 Nutzer-Limit geändert')
                .setDescription(`Nutzer-Limit auf **${limit === 0 ? 'unbegrenzt' : limit}** gesetzt!`)
                .addFields(
                    { name: '📊 Neues Limit', value: `${limit === 0 ? 'Unbegrenzt' : limit}`, inline: true },
                    { name: '👤 Geändert von', value: `${intr.user}`, inline: true },
                    { name: '👥 Aktuell im Channel', value: `${voiceChannel.members.size}`, inline: true }
                )
                .setColor(0x3498db)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Limit-Änderung • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Setzen des Limits', error);
            await intr.reply({
                content: '❌ Fehler beim Setzen des Limits!',
                ephemeral: true
            });
        }
    }
}