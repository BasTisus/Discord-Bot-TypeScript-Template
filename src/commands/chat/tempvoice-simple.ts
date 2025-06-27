// src/commands/chat/tempvoice-simple.ts - TempVoice Commands (Template-kompatibel)
import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    ChannelType,
    GuildMember,
    VoiceChannel,
    TextChannel,
    PermissionsString
} from 'discord.js';

import { Command, CommandDeferType } from '../index.js';
import { tempVoiceModule } from '../../modules/tempvoice/index.js';
import { Logger } from '../../services/index.js';
import { EventData } from '../../models/internal-models.js';

// 1. /tempvoicecreate - Creator Channel erstellen (vereinfacht)
export class TempVoiceCreateSimpleCommand implements Command {
    public names = ['tempvoicecreate'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['ManageChannels', 'ManageRoles'];

    public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
        try {
            const channelName = '🎤 Join to Create';
            const maxSlots = 5;
            
            // Erstelle Creator Channel
            const creatorChannel = await intr.guild!.channels.create({
                name: channelName,
                type: ChannelType.GuildVoice,
                userLimit: 1,
                permissionOverwrites: [
                    {
                        id: intr.guild!.id,
                        allow: ['ViewChannel', 'Connect']
                    }
                ]
            });

            // Update Config
            const config = tempVoiceModule.getGuildConfig(intr.guildId!);
            if (!config.creatorChannels.includes(creatorChannel.id)) {
                config.creatorChannels.push(creatorChannel.id);
                config.defaultMaxUsers = maxSlots;
                tempVoiceModule.saveGuildConfig(intr.guildId!, config);
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Creator-Channel erstellt!')
                .setDescription(`Der Creator-Channel **${channelName}** wurde erfolgreich erstellt!`)
                .setColor(0x00ff00)
                .addFields(
                    { name: '📢 Channel', value: `${creatorChannel}`, inline: true },
                    { name: '👥 Max-Users', value: `${maxSlots}`, inline: true },
                    { name: '🎯 Funktionsweise', value: 'Tritt dem Channel bei um automatisch einen eigenen Channel zu erstellen!', inline: false },
                    { name: '🧪 Testing', value: 'Memory-Modus aktiv - Daten gehen bei Neustart verloren', inline: false }
                )
                .setFooter({ text: 'TempVoice System • Testing Version • Memory Storage' });

            await intr.editReply({ embeds: [embed] });
            Logger.info(`✅ Creator-Channel erstellt: ${channelName} (${creatorChannel.id})`);
        } catch (error) {
            Logger.error('Fehler beim Erstellen des Creator-Channels', error);
            await intr.editReply({
                content: `❌ Fehler beim Erstellen des Creator-Channels: ${error}`
            });
        }
    }
}

// 2. /tempvoicestatus - Channel Status anzeigen
export class TempVoiceStatusSimpleCommand implements Command {
    public names = ['tempvoicestatus'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = [];

    public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
        const tempChannelData = tempVoiceModule.isInTempChannel(intr);
        if (!tempChannelData) {
            await intr.editReply({
                content: '❌ Du bist nicht in einem temporären Voice-Channel!\n\n' +
                        '💡 **So geht\'s:**\n' +
                        '1. Verwende `/tempvoicecreate` um einen Creator-Channel zu erstellen\n' +
                        '2. Tritt dem "🎤 Join to Create" Channel bei\n' +
                        '3. Dein eigener Channel wird automatisch erstellt!'
            });
            return;
        }

        const channel = (intr.member as GuildMember).voice.channel as VoiceChannel;
        const owner = intr.guild!.members.cache.get(tempChannelData.ownerId);
        
        // Berechne Channel-Lebensdauer
        const lifetime = Date.now() - tempChannelData.createdAt.getTime();
        const lifetimeMinutes = Math.floor(lifetime / 60000);
        const lifetimeSeconds = Math.floor((lifetime % 60000) / 1000);

        const connectedUsers = channel.members.map(member => member.displayName).join(', ') || 'Niemand';

        const embed = new EmbedBuilder()
            .setTitle('📊 Voice-Channel Status')
            .setColor(0x3498db)
            .addFields(
                { name: '📢 Channel-Name', value: channel.name, inline: true },
                { name: '👑 Besitzer', value: owner ? owner.displayName : 'Unbekannt', inline: true },
                { name: '👥 Nutzer-Limit', value: `${tempChannelData.maxUsers === 0 ? 'Unbegrenzt' : tempChannelData.maxUsers}`, inline: true },
                { name: '🔢 Aktuelle Nutzer', value: `${channel.members.size}/${tempChannelData.maxUsers === 0 ? '∞' : tempChannelData.maxUsers}`, inline: true },
                { name: '⏱️ Lebensdauer', value: `${lifetimeMinutes}min ${lifetimeSeconds}s`, inline: true },
                { name: '🗄️ Speicher', value: 'Memory (Testing)', inline: true },
                { name: '⏰ Erstellt', value: `<t:${Math.floor(tempChannelData.createdAt.getTime() / 1000)}:R>`, inline: true },
                { name: '👁️ Sichtbar', value: tempChannelData.isVisible ? 'Ja' : 'Nein', inline: true },
                { name: '🔒 Status', value: tempChannelData.isLocked ? 'Gesperrt' : 'Offen', inline: true },
                { name: '👥 Verbundene Nutzer', value: connectedUsers, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'TempVoice • Testing Version • Automatische Löschung bei Leere' });

        await intr.editReply({ embeds: [embed] });
    }
}

// 3. /tempvoicelist - Admin: Alle aktiven Channels
export class TempVoiceListSimpleCommand implements Command {
    public names = ['tempvoicelist'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = [];

    public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
        try {
            const allChannels = tempVoiceModule.getAllTempChannels(intr.guildId!);
            
            if (allChannels.length === 0) {
                await intr.editReply({
                    content: '📭 Keine aktiven temporären Voice-Channels gefunden!\n\n' +
                            '💡 **Erste Schritte:**\n' +
                            '1. `/tempvoicecreate` - Creator Channel erstellen\n' +
                            '2. Creator Channel beitreten\n' +
                            '3. Automatische Channel-Erstellung!'
                });
                return;
            }

            let description = '';
            let activeCount = 0;
            
            for (const channelData of allChannels.slice(0, 10)) { // Limit 10 für Testing
                const channel = intr.guild!.channels.cache.get(channelData.voiceChannelId) as VoiceChannel;
                if (channel) {
                    activeCount++;
                    const owner = intr.guild!.members.cache.get(channelData.ownerId);
                    const lifetime = Math.floor((Date.now() - channelData.createdAt.getTime()) / 60000);
                    
                    description += `**${channel.name}**\n`;
                    description += `├ 👑 ${owner ? owner.displayName : 'Unbekannt'}\n`;
                    description += `├ 👥 ${channel.members.size}/${channelData.maxUsers === 0 ? '∞' : channelData.maxUsers} Nutzer\n`;
                    description += `├ ⏱️ ${lifetime} Minuten alt\n`;
                    description += `└ 📊 ${channelData.isVisible ? 'Sichtbar' : 'Versteckt'} | ${channelData.isLocked ? 'Gesperrt' : 'Offen'}\n\n`;
                }
            }

            const config = tempVoiceModule.getGuildConfig(intr.guildId!);
            const creatorChannelsList = config.creatorChannels.length > 0 ? 
                config.creatorChannels.map(id => {
                    const channel = intr.guild!.channels.cache.get(id);
                    return channel ? `• ${channel.name}` : '• (Gelöschter Channel)';
                }).join('\n') : 'Keine Creator-Channels';

            const embed = new EmbedBuilder()
                .setTitle('📋 TempVoice System Status')
                .setDescription(description || 'Keine aktiven Channels gefunden.')
                .setColor(0x3498db)
                .addFields(
                    { name: '📊 Statistiken', value: `${activeCount}/${allChannels.length} Channel(s) aktiv`, inline: true },
                    { name: '🗄️ Speicher', value: 'Memory (Testing)', inline: true },
                    { name: '⚙️ Standard Max-Users', value: `${config.defaultMaxUsers}`, inline: true },
                    { name: '🎤 Creator-Channels', value: creatorChannelsList, inline: false }
                )
                .setFooter({ text: 'TempVoice • Testing Version • Memory Storage' });

            await intr.editReply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Abrufen der Channel-Liste', error);
            await intr.editReply({
                content: '❌ Fehler beim Abrufen der Channel-Liste!'
            });
        }
    }
}

// 4. /tempvoicecleanup - Manueller Cleanup (Admin)
export class TempVoiceCleanupSimpleCommand implements Command {
    public names = ['tempvoicecleanup'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = ['ManageChannels'];

    public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
        try {
            const beforeCount = tempVoiceModule.getAllTempChannels(intr.guildId!).length;
            
            await tempVoiceModule.cleanupEmptyChannels(intr.client);
            
            const afterCount = tempVoiceModule.getAllTempChannels(intr.guildId!).length;
            const cleanedCount = beforeCount - afterCount;
            
            const embed = new EmbedBuilder()
                .setTitle('🧹 Cleanup abgeschlossen')
                .setDescription('Automatischer Cleanup aller leeren Temp-Channels durchgeführt')
                .addFields(
                    { name: '📊 Vor Cleanup', value: `${beforeCount} Channels`, inline: true },
                    { name: '✅ Nach Cleanup', value: `${afterCount} Channels`, inline: true },
                    { name: '🗑️ Bereinigt', value: `${cleanedCount} Channels`, inline: true },
                    { name: '🗄️ Speicher', value: 'Memory (Testing)', inline: true },
                    { name: '⏰ Automatisch', value: 'Läuft alle 5 Minuten', inline: true },
                    { name: '💡 Hinweis', value: 'Leere Channels werden automatisch nach 1 Sekunde gelöscht', inline: false }
                )
                .setColor(cleanedCount > 0 ? 0x00ff00 : 0x3498db)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Manueller Cleanup • Testing Version' });

            await intr.editReply({ embeds: [embed] });
            Logger.info(`🧹 Manueller Cleanup: ${cleanedCount} Channels bereinigt`);
        } catch (error) {
            Logger.error('Fehler beim manuellen Cleanup', error);
            await intr.editReply({
                content: '❌ Fehler beim Cleanup!'
            });
        }
    }
}

// Export für einfachen Import
export const TempVoiceSimpleCommands = [
    TempVoiceCreateSimpleCommand,
    TempVoiceStatusSimpleCommand,
    TempVoiceListSimpleCommand,
    TempVoiceCleanupSimpleCommand
];