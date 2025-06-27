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
    User
} from 'discord.js';
import { ChatInputCommandInteraction } from 'discord.js';

import { Command } from '../index.js';
import { tempVoiceModule } from '../../modules/tempvoice/index.js';
import { Logger } from '../../services/index.js';

// 1. /byvoicetempcreate - Creator Channel erstellen
export class TempVoiceCreateCommand implements Command {
    public metadata = {
        name: 'byvoicetempcreate',
        description: 'Erstellt einen Creator-Channel für temporäre Voice-Kanäle',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
        defaultMemberPermissions: PermissionFlagsBits.Administrator,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicetempcreate')
        .setDescription('Erstellt einen Creator-Channel für temporäre Voice-Kanäle')
        .addStringOption(option =>
            option.setName('channelname')
                .setDescription('Name des Creator-Channels')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('maxslots')
                .setDescription('Standard-Anzahl maximaler Nutzer für erstellte Temp-Channels (Standard: 3)')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(99))
        .addChannelOption(option =>
            option.setName('kategorie')
                .setDescription('Kategorie in der die temporären Kanäle erstellt werden')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
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
    public metadata = {
        name: 'byvoicesetlimit',
        description: 'Setzt das Nutzer-Limit des Voice-Channels',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicesetlimit')
        .setDescription('Setzt das Nutzer-Limit des Voice-Channels')
        .addIntegerOption(option =>
            option.setName('zahl')
                .setDescription('Maximale Anzahl Nutzer (0 = unbegrenzt)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(99));

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
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
// 4. /byvoicesetvisible - Sichtbarkeit ändern
export class TempVoiceSetVisibleCommand implements Command {
    public metadata = {
        name: 'byvoicesetvisible',
        description: 'Ändert die Sichtbarkeit des Voice-Channels',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicesetvisible')
        .setDescription('Ändert die Sichtbarkeit des Voice-Channels')
        .addBooleanOption(option =>
            option.setName('sichtbar')
                .setDescription('Soll der Channel für alle sichtbar sein?')
                .setRequired(true));

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const visible = intr.options.getBoolean('sichtbar', true);
        
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
                content: '❌ Nur der Channel-Besitzer kann die Sichtbarkeit ändern!',
                ephemeral: true
            });
            return;
        }

        try {
            const voiceChannel = (intr.member as GuildMember).voice.channel as VoiceChannel;
            
            // Sammle alle Permission IDs EINMAL
            const permissionIds = Array.from(voiceChannel.permissionOverwrites.cache.keys());
            
            // Bearbeite alle Permissions sequenziell
            for (const id of permissionIds) {
                if (id === tempChannelData.ownerId) {
                    // Owner-Permissions nicht ändern - immer sichtbar
                    continue;
                }
                
                try {
                    await voiceChannel.permissionOverwrites.edit(id, {
                        ViewChannel: visible // true = sichtbar, false = versteckt
                    });
                    
                    // Kleine Pause zwischen Updates um Rate-Limits zu vermeiden
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    Logger.warn(`Warnung: Konnte Permission für ${id} nicht setzen: ${error}`);
                }
            }

            // Update in MongoDB
            tempChannelData.isVisible = visible;
            await (tempVoiceModule as any).setTempChannel(intr.guildId!, voiceChannel.id, tempChannelData);

            // Log visibility change
            await (tempVoiceModule as any).updateTempChannelActivity(intr.guildId!, voiceChannel.id, 'visibility_changed', intr.user.id);

            const embed = new EmbedBuilder()
                .setTitle(`${visible ? '👁️' : '🙈'} Sichtbarkeit geändert`)
                .setDescription(`Voice-Channel ist jetzt ${visible ? 'sichtbar' : 'versteckt'} für alle Rollen!`)
                .addFields(
                    { name: '👁️ Status', value: visible ? 'Sichtbar' : 'Versteckt', inline: true },
                    { name: '👤 Geändert von', value: `${intr.user}`, inline: true },
                    { name: '💡 Hinweis', value: 'Text-Channel bleibt unverändert und ist nur für Voice-Teilnehmer sichtbar.', inline: false }
                )
                .setColor(visible ? 0x00ff00 : 0x95a5a6)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Sichtbarkeit • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Ändern der Sichtbarkeit', error);
            await intr.reply({
                content: '❌ Fehler beim Ändern der Sichtbarkeit!',
                ephemeral: true
            });
        }
    }
}

// 5. /byvoicelock - Channel sperren/entsperren
export class TempVoiceLockCommand implements Command {
    public metadata = {
        name: 'byvoicelock',
        description: 'Sperrt oder entsperrt den Voice-Channel',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicelock')
        .setDescription('Sperrt oder entsperrt den Voice-Channel')
        .addBooleanOption(option =>
            option.setName('gesperrt')
                .setDescription('Soll der Channel gesperrt werden?')
                .setRequired(true));

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const locked = intr.options.getBoolean('gesperrt', true);
        
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
                content: '❌ Nur der Channel-Besitzer kann den Channel sperren!',
                ephemeral: true
            });
            return;
        }

        try {
            const voiceChannel = (intr.member as GuildMember).voice.channel as VoiceChannel;
            
            // Sammle alle Permission IDs EINMAL
            const permissionIds = Array.from(voiceChannel.permissionOverwrites.cache.keys());
            
            // Bearbeite alle Permissions sequenziell
            for (const id of permissionIds) {
                if (id === tempChannelData.ownerId) {
                    // Owner kann immer joinen - Permissions nicht ändern
                    continue;
                }
                
                try {
                    await voiceChannel.permissionOverwrites.edit(id, {
                        Connect: locked ? false : true // false = gesperrt, true = offen
                    });
                    
                    // Kleine Pause zwischen Updates um Rate-Limits zu vermeiden
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    Logger.warn(`Warnung: Konnte Permission für ${id} nicht setzen: ${error}`);
                }
            }

            // Update in MongoDB
            tempChannelData.isLocked = locked;
            await (tempVoiceModule as any).setTempChannel(intr.guildId!, voiceChannel.id, tempChannelData);

            // Log lock change
            await (tempVoiceModule as any).updateTempChannelActivity(intr.guildId!, voiceChannel.id, 'lock_changed', intr.user.id);

            const embed = new EmbedBuilder()
                .setTitle(`${locked ? '🔒' : '🔓'} Channel ${locked ? 'gesperrt' : 'entsperrt'}`)
                .setDescription(`Voice-Channel ist jetzt ${locked ? 'gesperrt' : 'entsperrt'} für alle Rollen!`)
                .addFields(
                    { name: '🔒 Status', value: locked ? 'Gesperrt' : 'Offen', inline: true },
                    { name: '👤 Geändert von', value: `${intr.user}`, inline: true },
                    { name: '💡 Hinweis', value: 'Text-Channel bleibt unverändert und ist nur für Voice-Teilnehmer sichtbar.', inline: false }
                )
                .setColor(locked ? 0xff0000 : 0x00ff00)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Lock-Status • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Lock/Unlock', error);
            await intr.reply({
                content: '❌ Fehler beim Sperren/Entsperren des Channels!',
                ephemeral: true
            });
        }
    }
}

// 6. /byvoiceclaim - Channel beanspruchen
export class TempVoiceClaimCommand implements Command {
    public metadata = {
        name: 'byvoiceclaim',
        description: 'Beansprucht den Channel wenn der Besitzer nicht anwesend ist',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoiceclaim')
        .setDescription('Beansprucht den Channel wenn der Besitzer nicht anwesend ist');

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const tempChannelData = tempVoiceModule.isInTempChannel(intr);
        if (!tempChannelData) {
            await intr.reply({
                content: '❌ Du bist nicht in einem temporären Voice-Channel!',
                ephemeral: true
            });
            return;
        }

        // Check if owner is still in channel
        const channel = (intr.member as GuildMember).voice.channel as VoiceChannel;
        const ownerInChannel = channel.members.has(tempChannelData.ownerId);

        if (ownerInChannel) {
            await intr.reply({
                content: '❌ Der aktuelle Besitzer ist noch im Channel!',
                ephemeral: true
            });
            return;
        }

        const oldOwnerId = tempChannelData.ownerId;
        const oldOwnerName = tempChannelData.ownerName;

        try {
            // Transfer ownership in MongoDB
            tempChannelData.ownerId = intr.user.id;
            tempChannelData.ownerName = (intr.member as GuildMember).displayName;
            await (tempVoiceModule as any).setTempChannel(intr.guildId!, channel.id, tempChannelData);

            // Give owner permissions
            const textChannel = intr.guild!.channels.cache.get(tempChannelData.textChannelId) as TextChannel;
            await (tempVoiceModule as any).updateOwnerPermissions(channel, textChannel, intr.member as GuildMember, oldOwnerId);

            // Log claim action
            await (tempVoiceModule as any).updateTempChannelActivity(intr.guildId!, channel.id, 'channel_claimed', intr.user.id);

            const embed = new EmbedBuilder()
                .setTitle('👑 Channel beansprucht!')
                .setDescription(`**${(intr.member as GuildMember).displayName}** hat den Channel erfolgreich beansprucht!`)
                .addFields(
                    { name: '👤 Neuer Besitzer', value: `${intr.member}`, inline: true },
                    { name: '👻 Vorheriger Besitzer', value: `${oldOwnerName} (abwesend)`, inline: true },
                    { name: '⏰ Beansprucht', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                )
                .setColor(0x00ff00)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Channel Claim • MongoDB' });

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

// 7. /byvoicesetname - Channel-Name ändern
export class TempVoiceSetNameCommand implements Command {
    public metadata = {
        name: 'byvoicesetname',
        description: 'Ändert den Namen des Voice-Channels',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicesetname')
        .setDescription('Ändert den Namen des Voice-Channels')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Neuer Name für den Channel')
                .setRequired(true)
                .setMaxLength(100));

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const newName = intr.options.getString('name', true);
        
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
                content: '❌ Nur der Channel-Besitzer kann den Namen ändern!',
                ephemeral: true
            });
            return;
        }

        try {
            const voiceChannel = (intr.member as GuildMember).voice.channel as VoiceChannel;
            const oldName = voiceChannel.name;
            await voiceChannel.setName(newName);
            
            // Log name change
            await (tempVoiceModule as any).updateTempChannelActivity(intr.guildId!, voiceChannel.id, 'name_changed', intr.user.id);

            const embed = new EmbedBuilder()
                .setTitle('📝 Channel-Name geändert')
                .addFields(
                    { name: '📛 Alter Name', value: oldName, inline: true },
                    { name: '📝 Neuer Name', value: newName, inline: true },
                    { name: '👤 Geändert von', value: `${intr.user}`, inline: true }
                )
                .setColor(0x3498db)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Name-Änderung • MongoDB' });
            
            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Ändern des Namens', error);
            await intr.reply({
                content: '❌ Fehler beim Ändern des Namens! (Rate-Limit erreicht?)',
                ephemeral: true
            });
        }
    }
}
// 8. /byvoicekick - User kicken
export class TempVoiceKickCommand implements Command {
    public metadata = {
        name: 'byvoicekick',
        description: 'Kickt einen Nutzer aus dem Voice-Channel',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicekick')
        .setDescription('Kickt einen Nutzer aus dem Voice-Channel')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Nutzer der gekickt werden soll')
                .setRequired(true));

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const targetUser = intr.options.getUser('user', true);
        
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
                content: '❌ Nur der Channel-Besitzer kann Nutzer kicken!',
                ephemeral: true
            });
            return;
        }

        if (targetUser.id === intr.user.id) {
            await intr.reply({
                content: '❌ Du kannst dich nicht selbst kicken!',
                ephemeral: true
            });
            return;
        }

        const targetMember = intr.guild!.members.cache.get(targetUser.id);
        if (!targetMember || !targetMember.voice.channel || targetMember.voice.channel.id !== (intr.member as GuildMember).voice.channel!.id) {
            await intr.reply({
                content: '❌ Der Nutzer ist nicht in deinem Voice-Channel!',
                ephemeral: true
            });
            return;
        }

        try {
            await targetMember.voice.disconnect('Vom Channel-Besitzer gekickt');
            
            // Log kick action
            await (tempVoiceModule as any).updateTempChannelActivity(intr.guildId!, (intr.member as GuildMember).voice.channel!.id, 'user_kicked', targetUser.id);

            const embed = new EmbedBuilder()
                .setTitle('👢 Nutzer gekickt')
                .setDescription(`**${targetMember.displayName}** wurde aus dem Channel gekickt!`)
                .addFields(
                    { name: '👤 Gekickter Nutzer', value: `${targetMember}`, inline: true },
                    { name: '👑 Gekickt von', value: `${intr.user}`, inline: true },
                    { name: '⏰ Zeitpunkt', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                )
                .setColor(0xff8000)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • User Kick • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Kicken des Nutzers', error);
            await intr.reply({
                content: '❌ Fehler beim Kicken des Nutzers! (Fehlende Berechtigung?)',
                ephemeral: true
            });
        }
    }
}

// 9. /byvoiceban - User bannen
export class TempVoiceBanCommand implements Command {
    public metadata = {
        name: 'byvoiceban',
        description: 'Verbannt einen Nutzer vom Voice-Channel',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoiceban')
        .setDescription('Verbannt einen Nutzer vom Voice-Channel')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Nutzer der verbannt werden soll')
                .setRequired(true));

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const targetUser = intr.options.getUser('user', true);
        
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
                content: '❌ Nutzer nicht auf diesem Server gefunden!',
                ephemeral: true
            });
            return;
        }
        
        try {
            // Add to banned list in MongoDB
            if (!tempChannelData.bannedUsers.includes(targetUser.id)) {
                tempChannelData.bannedUsers.push(targetUser.id);
                await (tempVoiceModule as any).setTempChannel(intr.guildId!, (intr.member as GuildMember).voice.channel!.id, tempChannelData);
            }

            const voiceChannel = (intr.member as GuildMember).voice.channel as VoiceChannel;
            await voiceChannel.permissionOverwrites.create(targetMember, {
                Connect: false,
                ViewChannel: false
            });

            // Kick if currently in channel
            if (targetMember.voice.channel && targetMember.voice.channel.id === voiceChannel.id) {
                await targetMember.voice.disconnect('Vom Channel verbannt');
            }

            // Log ban action
            await (tempVoiceModule as any).updateTempChannelActivity(intr.guildId!, voiceChannel.id, 'user_banned', targetUser.id);

            const embed = new EmbedBuilder()
                .setTitle('🚫 Nutzer verbannt')
                .setDescription(`**${targetMember.displayName}** wurde vom Channel verbannt!`)
                .addFields(
                    { name: '👤 Verbannter Nutzer', value: `${targetMember}`, inline: true },
                    { name: '👑 Verbannt von', value: `${intr.user}`, inline: true },
                    { name: '📊 Gebannte Nutzer', value: `${tempChannelData.bannedUsers.length}`, inline: true }
                )
                .setColor(0xff0000)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • User Ban • MongoDB' });

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

// 10. /byvoiceunban - User entbannen
export class TempVoiceUnbanCommand implements Command {
    public metadata = {
        name: 'byvoiceunban',
        description: 'Entbannt einen Nutzer vom Voice-Channel',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoiceunban')
        .setDescription('Entbannt einen Nutzer vom Voice-Channel')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Nutzer der entbannt werden soll')
                .setRequired(true));

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const targetUser = intr.options.getUser('user', true);
        
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
                content: '❌ Nur der Channel-Besitzer kann Nutzer entbannen!',
                ephemeral: true
            });
            return;
        }

        if (!tempChannelData.bannedUsers.includes(targetUser.id)) {
            await intr.reply({
                content: '❌ Dieser Nutzer ist nicht verbannt!',
                ephemeral: true
            });
            return;
        }

        const targetMember = intr.guild!.members.cache.get(targetUser.id);
        if (!targetMember) {
            await intr.reply({
                content: '❌ Nutzer nicht auf diesem Server gefunden!',
                ephemeral: true
            });
            return;
        }
        
        try {
            // Remove from banned list in MongoDB
            tempChannelData.bannedUsers = tempChannelData.bannedUsers.filter(id => id !== targetUser.id);
            await (tempVoiceModule as any).setTempChannel(intr.guildId!, (intr.member as GuildMember).voice.channel!.id, tempChannelData);

            // Remove channel permissions
            const voiceChannel = (intr.member as GuildMember).voice.channel as VoiceChannel;
            await voiceChannel.permissionOverwrites.delete(targetMember);

            // Log unban action
            await (tempVoiceModule as any).updateTempChannelActivity(intr.guildId!, voiceChannel.id, 'user_unbanned', targetUser.id);

            const embed = new EmbedBuilder()
                .setTitle('✅ Nutzer entbannt')
                .setDescription(`**${targetMember.displayName}** wurde entbannt!`)
                .addFields(
                    { name: '👤 Entbannter Nutzer', value: `${targetMember}`, inline: true },
                    { name: '👑 Entbannt von', value: `${intr.user}`, inline: true },
                    { name: '📊 Gebannte Nutzer', value: `${tempChannelData.bannedUsers.length}`, inline: true }
                )
                .setColor(0x00ff00)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • User Unban • MongoDB' });

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

// 11. /byvoicestatus - Channel Status anzeigen
export class TempVoiceStatusCommand implements Command {
    public metadata = {
        name: 'byvoicestatus',
        description: 'Zeigt den aktuellen Status des Voice-Channels',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicestatus')
        .setDescription('Zeigt den aktuellen Status des Voice-Channels');

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const tempChannelData = tempVoiceModule.isInTempChannel(intr);
        if (!tempChannelData) {
            await intr.reply({
                content: '❌ Du bist nicht in einem temporären Voice-Channel!',
                ephemeral: true
            });
            return;
        }

        const channel = (intr.member as GuildMember).voice.channel as VoiceChannel;
        const owner = intr.guild!.members.cache.get(tempChannelData.ownerId);
        const connectedUsers = channel.members.map(member => member.displayName).join(', ') || 'Niemand';
        
        const bannedUserNames = tempChannelData.bannedUsers.length > 0 ? 
            tempChannelData.bannedUsers.map(id => {
                const member = intr.guild!.members.cache.get(id);
                return member ? member.displayName : 'Unbekannt';
            }).join(', ') : 'Niemand';

        // Status-Icons und Texte
        const visibilityIcon = tempChannelData.isVisible ? '👁️' : '🙈';
        const lockIcon = tempChannelData.isLocked ? '🔒' : '🔓';
        const statusText = tempChannelData.isVisible ? 
            (tempChannelData.isLocked ? 'Sichtbar aber gesperrt' : 'Sichtbar und offen') :
            'Versteckt';

        // Berechne Channel-Lebensdauer
        const lifetime = Date.now() - tempChannelData.createdAt.getTime();
        const lifetimeMinutes = Math.floor(lifetime / 60000);

        const embed = new EmbedBuilder()
            .setTitle('📊 Voice-Channel Status')
            .setColor(0x3498db)
            .addFields(
                { name: '📢 Channel-Name', value: channel.name, inline: true },
                { name: '👑 Besitzer', value: owner ? owner.displayName : 'Unbekannt', inline: true },
                { name: '👥 Nutzer-Limit', value: `${tempChannelData.maxUsers === 0 ? 'Unbegrenzt' : tempChannelData.maxUsers}`, inline: true },
                { name: `${visibilityIcon} Sichtbarkeit`, value: tempChannelData.isVisible ? 'Sichtbar' : 'Versteckt', inline: true },
                { name: `${lockIcon} Zugang`, value: tempChannelData.isLocked ? 'Gesperrt' : 'Offen', inline: true },
                { name: '📊 Status', value: statusText, inline: true },
                { name: '🔢 Aktuelle Nutzer', value: `${channel.members.size}/${tempChannelData.maxUsers === 0 ? '∞' : tempChannelData.maxUsers}`, inline: true },
                { name: '⏱️ Lebensdauer', value: `${lifetimeMinutes} Minuten`, inline: true },
                { name: '🗄️ Speicher', value: 'MongoDB', inline: true },
                { name: '⏰ Erstellt', value: `<t:${Math.floor(tempChannelData.createdAt.getTime() / 1000)}:R>`, inline: false },
                { name: '👥 Verbundene Nutzer', value: connectedUsers, inline: false },
                { name: '🚫 Verbannte Nutzer', value: bannedUserNames, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'TempVoice • Channel Status • MongoDB • Automatische Löschung bei Leere' });

        // Aktivitäts-Log (letzte 5 Aktivitäten)
        if (tempChannelData.activityLog && tempChannelData.activityLog.length > 0) {
            const recentActivities = tempChannelData.activityLog
                .slice(-5)
                .reverse()
                .map(activity => {
                    const timestamp = Math.floor(activity.timestamp.getTime() / 1000);
                    return `<t:${timestamp}:t> - ${activity.activity}`;
                })
                .join('\n');
            
            embed.addFields({
                name: '📋 Letzte Aktivitäten',
                value: recentActivities || 'Keine Aktivitäten',
                inline: false
            });
        }

        await intr.reply({ embeds: [embed] });
    }
}
// 12. /byvoicelist - Admin Command: Alle aktiven Temp-Channels anzeigen
export class TempVoiceListCommand implements Command {
    public metadata = {
        name: 'byvoicelist',
        description: 'Zeigt alle aktiven temporären Voice-Channels',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
        defaultMemberPermissions: PermissionFlagsBits.Administrator,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicelist')
        .setDescription('Zeigt alle aktiven temporären Voice-Channels')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        await intr.deferReply({ ephemeral: true });
        
        try {
            const allChannels = await (tempVoiceModule as any).getAllTempChannels(intr.guildId!);
            
            if (allChannels.length === 0) {
                await intr.editReply({
                    content: '📭 Keine aktiven temporären Voice-Channels gefunden!'
                });
                return;
            }

            let description = '';
            let activeCount = 0;
            
            for (const channelData of allChannels) {
                const channel = intr.guild!.channels.cache.get(channelData.voiceChannelId) as VoiceChannel;
                if (channel) {
                    activeCount++;
                    const owner = intr.guild!.members.cache.get(channelData.ownerId);
                    const visIcon = channelData.isVisible ? '👁️' : '🙈';
                    const lockIcon = channelData.isLocked ? '🔒' : '🔓';
                    const lifetime = Math.floor((Date.now() - channelData.createdAt.getTime()) / 60000);
                    
                    description += `**${channel.name}**\n`;
                    description += `├ 👑 Besitzer: ${owner ? owner.displayName : 'Unbekannt'}\n`;
                    description += `├ 👥 Nutzer: ${channel.members.size}/${channelData.maxUsers === 0 ? '∞' : channelData.maxUsers}\n`;
                    description += `├ ${visIcon} ${channelData.isVisible ? 'Sichtbar' : 'Versteckt'} | ${lockIcon} ${channelData.isLocked ? 'Gesperrt' : 'Offen'}\n`;
                    description += `├ ⏱️ Lebensdauer: ${lifetime}min\n`;
                    description += `└ 🚫 Gebannt: ${channelData.bannedUsers.length}\n\n`;
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('📋 Aktive temporäre Voice-Channels')
                .setDescription(description || 'Keine aktiven Channels gefunden.')
                .setColor(0x3498db)
                .setFooter({ text: `${activeCount}/${allChannels.length} Channel(s) aktiv • MongoDB • Auto-Löschung` })
                .setTimestamp();

            await intr.editReply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Abrufen der Channel-Liste', error);
            await intr.editReply({
                content: '❌ Fehler beim Abrufen der Channel-Liste!'
            });
        }
    }
}

// 13. /byvoicestats - Erweiterte Channel-Statistiken
export class TempVoiceStatsCommand implements Command {
    public metadata = {
        name: 'byvoicestats',
        description: 'Zeigt erweiterte TempVoice-Statistiken',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
        defaultMemberPermissions: PermissionFlagsBits.Administrator,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicestats')
        .setDescription('Zeigt erweiterte TempVoice-Statistiken')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        await intr.deferReply({ ephemeral: true });
        
        try {
            const stats = await tempVoiceModule.getDetailedStats(intr.guildId!);
            
            const embed = new EmbedBuilder()
                .setTitle('📊 TempVoice Statistiken')
                .setColor(0x3498db)
                .setTimestamp();

            // Basis-Statistiken
            embed.addFields(
                { name: '📈 Channels gesamt', value: `${stats.totalChannels}`, inline: true },
                { name: '🟢 Aktuell aktiv', value: `${stats.activeChannels}`, inline: true },
                { name: '📅 Heute erstellt', value: `${stats.channelsToday}`, inline: true },
                { name: '🧠 Im Speicher', value: `${stats.memoryChannels}`, inline: true },
                { name: '⏱️ Ø Lebensdauer', value: `${Math.round(stats.avgChannelLifetime / 60000)} Min`, inline: true },
                { name: '🗄️ Datenbank', value: 'MongoDB', inline: true }
            );

            // Top Channel-Ersteller
            if (stats.topOwners.length > 0) {
                const topOwnersList = stats.topOwners.map((owner, index) => 
                    `${index + 1}. ${owner.ownerName}: ${owner.count} Channels`
                ).join('\n');
                
                embed.addFields({
                    name: '👑 Top Channel-Ersteller',
                    value: topOwnersList,
                    inline: false
                });
            }

            embed.setFooter({ text: 'TempVoice System • MongoDB • Erweiterte Statistiken' });

            await intr.editReply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Abrufen der Stats', error);
            await intr.editReply({
                content: '❌ Fehler beim Abrufen der Statistiken!'
            });
        }
    }
}

// 14. /byvoicecleanup - Manueller Cleanup
export class TempVoiceCleanupCommand implements Command {
    public metadata = {
        name: 'byvoicecleanup',
        description: 'Führt manuellen Cleanup aller Temp-Channels durch',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
        defaultMemberPermissions: PermissionFlagsBits.Administrator,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicecleanup')
        .setDescription('Führt manuellen Cleanup aller Temp-Channels durch')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        await intr.deferReply({ ephemeral: true });
        
        try {
            await tempVoiceModule.cleanupOrphanedChannels(intr.client);
            await tempVoiceModule.cleanupEmptyChannels(intr.client);
            
            const stats = await tempVoiceModule.getDetailedStats(intr.guildId!);
            
            const embed = new EmbedBuilder()
                .setTitle('🧹 Cleanup abgeschlossen')
                .setDescription('Alle verwaisten und leeren Channels wurden bereinigt')
                .addFields(
                    { name: '✅ Aktive Channels', value: `${stats.activeChannels}`, inline: true },
                    { name: '🗄️ DB-Einträge', value: `${stats.totalChannels}`, inline: true },
                    { name: '🧠 Im Speicher', value: `${stats.memoryChannels}`, inline: true }
                )
                .setColor(0x00ff00)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Manueller Cleanup • MongoDB' });

            await intr.editReply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim manuellen Cleanup', error);
            await intr.editReply({
                content: '❌ Fehler beim Cleanup!'
            });
        }
    }
}

// Export aller TempVoice Commands für das Discord.js Template System
export const TempVoiceCommands = [
    // Creator & Owner Commands
    TempVoiceCreateCommand,      // /byvoicetempcreate (Admin)
    TempVoiceSetOwnerCommand,    // /byvoicesetowner
    TempVoiceClaimCommand,       // /byvoiceclaim
    
    // Channel Settings
    TempVoiceSetLimitCommand,    // /byvoicesetlimit
    TempVoiceSetVisibleCommand,  // /byvoicesetvisible
    TempVoiceLockCommand,        // /byvoicelock
    TempVoiceSetNameCommand,     // /byvoicesetname
    
    // User Management
    TempVoiceKickCommand,        // /byvoicekick
    TempVoiceBanCommand,         // /byvoiceban
    TempVoiceUnbanCommand,       // /byvoiceunban
    
    // Information & Status
    TempVoiceStatusCommand,      // /byvoicestatus
    TempVoiceListCommand,        // /byvoicelist (Admin)
    TempVoiceStatsCommand,       // /byvoicestats (Admin)
    TempVoiceCleanupCommand,     // /byvoicecleanup (Admin)
];

// Einzelne Command-Instanzen für direkten Import
export const tempVoiceCreateCommand = new TempVoiceCreateCommand();
export const tempVoiceSetOwnerCommand = new TempVoiceSetOwnerCommand();
export const tempVoiceSetLimitCommand = new TempVoiceSetLimitCommand();
export const tempVoiceSetVisibleCommand = new TempVoiceSetVisibleCommand();
export const tempVoiceLockCommand = new TempVoiceLockCommand();
export const tempVoiceClaimCommand = new TempVoiceClaimCommand();
export const tempVoiceSetNameCommand = new TempVoiceSetNameCommand();
export const tempVoiceKickCommand = new TempVoiceKickCommand();
export const tempVoiceBanCommand = new TempVoiceBanCommand();
export const tempVoiceUnbanCommand = new TempVoiceUnbanCommand();
export const tempVoiceStatusCommand = new TempVoiceStatusCommand();
export const tempVoiceListCommand = new TempVoiceListCommand();
export const tempVoiceStatsCommand = new TempVoiceStatsCommand();
export const tempVoiceCleanupCommand = new TempVoiceCleanupCommand();