// src/commands/chat/tempvoice-commands.ts - Teil 1/8
// Vollständige TempVoice by-Commands mit MongoDB-Integration
import { 
    ApplicationCommandType, 
    ChatInputCommandInteraction, 
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ChannelType,
    GuildMember,
    VoiceChannel,
    TextChannel,
    CategoryChannel
} from 'discord.js';
import { Command } from '../index.js';
import { tempVoiceModule } from '../../modules/tempvoice/index.js';
import { Logger } from '../../services/index.js';

// 1. /byvoicecreate - Creator-Channel erstellen (Admin Command)
export class TempVoiceCreateCommand implements Command {
    public metadata = {
        name: 'byvoicecreate',
        description: 'Erstellt einen Creator-Channel für temporäre Voice-Channels',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
        defaultMemberPermissions: PermissionFlagsBits.Administrator,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicecreate')
        .setDescription('Erstellt einen Creator-Channel für temporäre Voice-Channels')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Name des Creator-Channels')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50))
        .addIntegerOption(option =>
            option.setName('maxslots')
                .setDescription('Standard maximale Anzahl Nutzer (0 = unbegrenzt)')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(99))
        .addChannelOption(option =>
            option.setName('category')
                .setDescription('Kategorie für den Creator-Channel')
                .setRequired(false)
                .addChannelTypes(ChannelType.GuildCategory))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        await intr.deferReply({ ephemeral: true });
        
        const channelName = intr.options.getString('name', true);
        const maxSlots = intr.options.getInteger('maxslots') ?? 5;
        const category = intr.options.getChannel('category') as CategoryChannel | null;
        
        try {
            // Creator-Channel erstellen
            const creatorChannel = await intr.guild!.channels.create({
                name: channelName,
                type: ChannelType.GuildVoice,
                parent: category?.id,
                userLimit: maxSlots === 0 ? 0 : maxSlots,
                permissionOverwrites: [
                    {
                        id: intr.guild!.roles.everyone.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
                    }
                ]
            });

            // Config aktualisieren
            const config = (tempVoiceModule as any).getGuildConfig(intr.guildId!);
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

            await intr.editReply({ embeds: [embed] });

            Logger.info(`✅ Creator-Channel erstellt: ${channelName} (${creatorChannel.id}) mit max ${maxSlots} Users - MongoDB`);
        } catch (error) {
            Logger.error('Fehler beim Erstellen des Creator-Channels', error);
            await intr.editReply({
                content: `❌ Fehler beim Erstellen des Creator-Channels: ${error}`
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

        if (newOwner.id === tempChannelData.ownerId) {
            await intr.reply({
                content: '❌ Dieser Nutzer ist bereits der Besitzer!',
                ephemeral: true
            });
            return;
        }

        const newOwnerMember = intr.guild!.members.cache.get(newOwner.id);
        if (!newOwnerMember) {
            await intr.reply({
                content: '❌ Nutzer nicht auf diesem Server gefunden!',
                ephemeral: true
            });
            return;
        }

        // Check if new owner is in the voice channel
        const voiceChannel = (intr.member as GuildMember).voice.channel as VoiceChannel;
        if (!voiceChannel.members.has(newOwner.id)) {
            await intr.reply({
                content: '❌ Der neue Besitzer muss im Voice-Channel sein!',
                ephemeral: true
            });
            return;
        }

        try {
            const oldOwnerId = tempChannelData.ownerId;
            const oldOwnerName = tempChannelData.ownerName;

            // Update ownership in MongoDB
            tempChannelData.ownerId = newOwner.id;
            tempChannelData.ownerName = newOwnerMember.displayName;
            await (tempVoiceModule as any).setTempChannel(intr.guildId!, voiceChannel.id, tempChannelData);

            // Update permissions
            const textChannel = intr.guild!.channels.cache.get(tempChannelData.textChannelId) as TextChannel;
            await (tempVoiceModule as any).updateOwnerPermissions(voiceChannel, textChannel, newOwnerMember, oldOwnerId);

            // Log ownership change
            await (tempVoiceModule as any).updateTempChannelActivity(intr.guildId!, voiceChannel.id, 'ownership_transferred', newOwner.id);

            const embed = new EmbedBuilder()
                .setTitle('👑 Besitzer geändert!')
                .setDescription(`Der Besitzer wurde erfolgreich auf **${newOwnerMember.displayName}** übertragen!`)
                .addFields(
                    { name: '👤 Neuer Besitzer', value: `${newOwnerMember}`, inline: true },
                    { name: '👻 Vorheriger Besitzer', value: `${oldOwnerName}`, inline: true },
                    { name: '👑 Übertragen von', value: `${intr.user}`, inline: true }
                )
                .setColor(0x00ff00)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Ownership Transfer • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Ändern des Besitzers', error);
            await intr.reply({
                content: '❌ Fehler beim Ändern des Besitzers!',
                ephemeral: true
            });
        }
    }
}

// 3. /byvoicelimit - Nutzer-Limit ändern
export class TempVoiceLimitCommand implements Command {
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
                .setDescription('Neues Nutzer-Limit (0 = unbegrenzt)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(99));

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        const newLimit = intr.options.getInteger('limit', true);
        
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
            const voiceChannel = (intr.member as GuildMember).voice.channel as VoiceChannel;
            
            // Update channel limit
            await voiceChannel.setUserLimit(newLimit);

            // Update in MongoDB
            tempChannelData.maxUsers = newLimit;
            await (tempVoiceModule as any).setTempChannel(intr.guildId!, voiceChannel.id, tempChannelData);

            // Log limit change
            await (tempVoiceModule as any).updateTempChannelActivity(intr.guildId!, voiceChannel.id, 'limit_changed', intr.user.id);

            const embed = new EmbedBuilder()
                .setTitle('👥 Nutzer-Limit geändert!')
                .setDescription(`Das Nutzer-Limit wurde auf **${newLimit === 0 ? 'Unbegrenzt' : newLimit}** gesetzt!`)
                .addFields(
                    { name: '👥 Neues Limit', value: `${newLimit === 0 ? 'Unbegrenzt' : newLimit}`, inline: true },
                    { name: '👤 Geändert von', value: `${intr.user}`, inline: true },
                    { name: '📊 Aktuell im Channel', value: `${voiceChannel.members.size}`, inline: true }
                )
                .setColor(0x3498db)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • User Limit • MongoDB' });

            await intr.reply({ embeds: [embed] });
        } catch (error) {
            Logger.error('Fehler beim Ändern des Limits', error);
            await intr.reply({
                content: '❌ Fehler beim Ändern des Limits!',
                ephemeral: true
            });
        }
    }
}

// 4. /byvoicename - Channel-Name ändern
export class TempVoiceRenameCommand implements Command {
    public metadata = {
        name: 'byvoicename',
        description: 'Ändert den Namen des temporären Voice-Channels',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicename')
        .setDescription('Ändert den Namen des temporären Voice-Channels')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Neuer Name für den Channel')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50));

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
                content: '❌ Nur der Channel-Besitzer kann den Namen ändern!',
                ephemeral: true
            });
            return;
        }

        try {
            const voiceChannel = (intr.member as GuildMember).voice.channel as VoiceChannel;
            const textChannel = intr.guild!.channels.cache.get(tempChannelData.textChannelId) as TextChannel;
            
            const oldName = voiceChannel.name;
            
            // Update channel names
            await voiceChannel.setName(newName);
            if (textChannel) {
                await textChannel.setName(`💬${newName}`);
            }

            // Log name change
            await (tempVoiceModule as any).updateTempChannelActivity(intr.guildId!, voiceChannel.id, 'name_changed', intr.user.id);

            const embed = new EmbedBuilder()
                .setTitle('✏️ Channel umbenannt!')
                .setDescription(`Der Channel wurde erfolgreich umbenannt!`)
                .addFields(
                    { name: '📝 Alter Name', value: oldName, inline: true },
                    { name: '✨ Neuer Name', value: newName, inline: true },
                    { name: '👤 Geändert von', value: `${intr.user}`, inline: true }
                )
                .setColor(0x3498db)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Channel Rename • MongoDB' });

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
// src/commands/chat/tempvoice-commands.ts - Teil 2/8
// Sichtbarkeit, Sperrung und Sicherheits-Commands

// 5. /byvoicehide - Channel verstecken
export class TempVoiceHideCommand implements Command {
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
                content: '❌ Nur der Channel-Besitzer kann die Sichtbarkeit ändern!',
                ephemeral: true
            });
            return;
        }

        if (!tempChannelData.isVisible) {
            await intr.reply({
                content: '❌ Der Channel ist bereits versteckt!',
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
                        ViewChannel: false // verstecken
                    });
                    
                    // Kleine Pause zwischen Updates um Rate-Limits zu vermeiden
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    Logger.warn(`Warnung: Konnte Permission für ${id} nicht setzen: ${error}`);
                }
            }

            // Update in MongoDB
            tempChannelData.isVisible = false;
            await (tempVoiceModule as any).setTempChannel(intr.guildId!, voiceChannel.id, tempChannelData);

            // Log visibility change
            await (tempVoiceModule as any).updateTempChannelActivity(intr.guildId!, voiceChannel.id, 'channel_hidden', intr.user.id);

            const embed = new EmbedBuilder()
                .setTitle('🙈 Channel versteckt!')
                .setDescription('Voice-Channel ist jetzt vor anderen Nutzern versteckt!')
                .addFields(
                    { name: '👁️ Sichtbarkeit', value: 'Versteckt', inline: true },
                    { name: '👤 Geändert von', value: `${intr.user}`, inline: true },
                    { name: '💡 Hinweis', value: 'Nutzer können den Channel nicht mehr sehen, aber bereits verbundene Nutzer bleiben verbunden.', inline: false }
                )
                .setColor(0x95a5a6)
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
                content: '❌ Nur der Channel-Besitzer kann die Sichtbarkeit ändern!',
                ephemeral: true
            });
            return;
        }

        if (tempChannelData.isVisible) {
            await intr.reply({
                content: '❌ Der Channel ist bereits sichtbar!',
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
                        ViewChannel: true // sichtbar machen
                    });
                    
                    // Kleine Pause zwischen Updates um Rate-Limits zu vermeiden
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    Logger.warn(`Warnung: Konnte Permission für ${id} nicht setzen: ${error}`);
                }
            }

            // Update in MongoDB
            tempChannelData.isVisible = true;
            await (tempVoiceModule as any).setTempChannel(intr.guildId!, voiceChannel.id, tempChannelData);

            // Log visibility change
            await (tempVoiceModule as any).updateTempChannelActivity(intr.guildId!, voiceChannel.id, 'channel_shown', intr.user.id);

            const embed = new EmbedBuilder()
                .setTitle('👁️ Channel sichtbar!')
                .setDescription('Voice-Channel ist jetzt wieder für alle sichtbar!')
                .addFields(
                    { name: '👁️ Sichtbarkeit', value: 'Sichtbar', inline: true },
                    { name: '👤 Geändert von', value: `${intr.user}`, inline: true },
                    { name: '💡 Hinweis', value: 'Alle Nutzer können den Channel jetzt wieder sehen und beitreten.', inline: false }
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
            const voiceChannel = (intr.member as GuildMember).voice.channel as VoiceChannel;
            
            // Sammle alle Permission IDs EINMAL
            const permissionIds = Array.from(voiceChannel.permissionOverwrites.cache.keys());
            
            // Bearbeite alle Permissions sequenziell
            for (const id of permissionIds) {
                if (id === tempChannelData.ownerId) {
                    // Owner-Permissions nicht ändern - kann immer beitreten
                    continue;
                }
                
                try {
                    await voiceChannel.permissionOverwrites.edit(id, {
                        Connect: false // sperren
                    });
                    
                    // Kleine Pause zwischen Updates um Rate-Limits zu vermeiden
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    Logger.warn(`Warnung: Konnte Permission für ${id} nicht setzen: ${error}`);
                }
            }

            // Update in MongoDB
            tempChannelData.isLocked = true;
            await (tempVoiceModule as any).setTempChannel(intr.guildId!, voiceChannel.id, tempChannelData);

            // Log lock change
            await (tempVoiceModule as any).updateTempChannelActivity(intr.guildId!, voiceChannel.id, 'channel_locked', intr.user.id);

            const embed = new EmbedBuilder()
                .setTitle('🔒 Channel gesperrt!')
                .setDescription('Voice-Channel ist jetzt für neue Nutzer gesperrt!')
                .addFields(
                    { name: '🔒 Status', value: 'Gesperrt', inline: true },
                    { name: '👤 Gesperrt von', value: `${intr.user}`, inline: true },
                    { name: '💡 Hinweis', value: 'Bereits verbundene Nutzer bleiben verbunden, aber neue Nutzer können nicht beitreten.', inline: false }
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
            const voiceChannel = (intr.member as GuildMember).voice.channel as VoiceChannel;
            
            // Sammle alle Permission IDs EINMAL
            const permissionIds = Array.from(voiceChannel.permissionOverwrites.cache.keys());
            
            // Bearbeite alle Permissions sequenziell
            for (const id of permissionIds) {
                if (id === tempChannelData.ownerId) {
                    // Owner-Permissions nicht ändern
                    continue;
                }
                
                try {
                    await voiceChannel.permissionOverwrites.edit(id, {
                        Connect: true // entsperren
                    });
                    
                    // Kleine Pause zwischen Updates um Rate-Limits zu vermeiden
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    Logger.warn(`Warnung: Konnte Permission für ${id} nicht setzen: ${error}`);
                }
            }

            // Update in MongoDB
            tempChannelData.isLocked = false;
            await (tempVoiceModule as any).setTempChannel(intr.guildId!, voiceChannel.id, tempChannelData);

            // Log unlock change
            await (tempVoiceModule as any).updateTempChannelActivity(intr.guildId!, voiceChannel.id, 'channel_unlocked', intr.user.id);

            const embed = new EmbedBuilder()
                .setTitle('🔓 Channel entsperrt!')
                .setDescription('Voice-Channel ist jetzt wieder für alle Nutzer offen!')
                .addFields(
                    { name: '🔒 Status', value: 'Offen', inline: true },
                    { name: '👤 Entsperrt von', value: `${intr.user}`, inline: true },
                    { name: '💡 Hinweis', value: 'Alle Nutzer können jetzt wieder dem Channel beitreten.', inline: false }
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
        const tempChannelData = (tempVoiceModule as any).isInTempChannel(intr);
        if (!tempChannelData) {
            await intr.reply({
                content: '❌ Du bist nicht in einem temporären Voice-Channel!',
                ephemeral: true
            });
            return;
        }

        // Check if user is already the owner
        if (tempChannelData.ownerId === intr.user.id) {
            await intr.reply({
                content: '❌ Du bist bereits der Besitzer dieses Channels!',
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
// src/commands/chat/tempvoice-commands.ts - Teil 3/8
// Moderation und Status-Commands

// 10. /byvoiceban - Nutzer verbannen
export class TempVoiceBanCommand implements Command {
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
                .setDescription('Nutzer der verbannt werden soll')
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

        if (tempChannelData.bannedUsers.includes(targetUser.id)) {
            await intr.reply({
                content: '❌ Dieser Nutzer ist bereits verbannt!',
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
            const voiceChannel = (intr.member as GuildMember).voice.channel as VoiceChannel;
            
            // Add to banned list in MongoDB
            tempChannelData.bannedUsers.push(targetUser.id);
            await (tempVoiceModule as any).setTempChannel(intr.guildId!, voiceChannel.id, tempChannelData);

            // Set channel permissions to deny access
            await voiceChannel.permissionOverwrites.create(targetMember, {
                ViewChannel: false,
                Connect: false,
                Speak: false
            });

            // Kick user if they're currently in the channel
            if (voiceChannel.members.has(targetUser.id)) {
                await targetMember.voice.disconnect('Aus TempVoice-Channel verbannt');
            }

            // Log ban action with reason
            await (tempVoiceModule as any).updateTempChannelActivity(
                intr.guildId!, 
                voiceChannel.id, 
                'user_banned', 
                targetUser.id, 
                { reason, bannedBy: intr.user.id }
            );

            // Try to send DM to banned user
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('🚫 Aus TempVoice-Channel verbannt')
                    .setDescription(`Du wurdest aus einem temporären Voice-Channel verbannt.`)
                    .addFields(
                        { name: '📢 Server', value: intr.guild!.name, inline: true },
                        { name: '👤 Verbannt von', value: (intr.member as GuildMember).displayName, inline: true },
                        { name: '📝 Grund', value: reason, inline: false }
                    )
                    .setColor(0xff0000)
                    .setTimestamp();
                
                await targetUser.send({ embeds: [dmEmbed] });
            } catch (error) {
                // DM failed - user has DMs disabled or blocked bot
                Logger.warn(`Konnte DM nicht an verbannten Nutzer ${targetUser.tag} senden`);
            }

            const embed = new EmbedBuilder()
                .setTitle('🚫 Nutzer verbannt')
                .setDescription(`**${targetMember.displayName}** wurde aus dem Channel verbannt!`)
                .addFields(
                    { name: '👤 Verbannter Nutzer', value: `${targetMember}`, inline: true },
                    { name: '👑 Verbannt von', value: `${intr.user}`, inline: true },
                    { name: '📝 Grund', value: reason, inline: false },
                    { name: '📊 Gebannte Nutzer', value: `${tempChannelData.bannedUsers.length}`, inline: true },
                    { name: '⏰ Verbannt', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
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

// 11. /byvoiceunban - Nutzer entbannen
export class TempVoiceUnbanCommand implements Command {
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
                .setDescription('Nutzer der entbannt werden soll')
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

            // Try to send DM to unbanned user
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('✅ TempVoice-Channel Entbannung')
                    .setDescription(`Du wurdest aus einem temporären Voice-Channel entbannt.`)
                    .addFields(
                        { name: '📢 Server', value: intr.guild!.name, inline: true },
                        { name: '👤 Entbannt von', value: (intr.member as GuildMember).displayName, inline: true },
                        { name: '💡 Status', value: 'Du kannst dem Channel jetzt wieder beitreten!', inline: false }
                    )
                    .setColor(0x00ff00)
                    .setTimestamp();
                
                await targetUser.send({ embeds: [dmEmbed] });
            } catch (error) {
                // DM failed - user has DMs disabled or blocked bot
                Logger.warn(`Konnte DM nicht an entbannten Nutzer ${targetUser.tag} senden`);
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Nutzer entbannt')
                .setDescription(`**${targetMember.displayName}** wurde entbannt!`)
                .addFields(
                    { name: '👤 Entbannter Nutzer', value: `${targetMember}`, inline: true },
                    { name: '👑 Entbannt von', value: `${intr.user}`, inline: true },
                    { name: '📊 Gebannte Nutzer', value: `${tempChannelData.bannedUsers.length}`, inline: true },
                    { name: '⏰ Entbannt', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
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

// 12. /byvoicekick - Nutzer rauswerfen
export class TempVoiceKickCommand implements Command {
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
                .setDescription('Nutzer der rausgeworfen werden soll')
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
                content: '❌ Nutzer nicht auf diesem Server gefunden!',
                ephemeral: true
            });
            return;
        }

        const voiceChannel = (intr.member as GuildMember).voice.channel as VoiceChannel;
        if (!voiceChannel.members.has(targetUser.id)) {
            await intr.reply({
                content: '❌ Dieser Nutzer ist nicht im Voice-Channel!',
                ephemeral: true
            });
            return;
        }
        
        try {
            // Kick user from voice channel
            await targetMember.voice.disconnect(reason);

            // Log kick action
            await (tempVoiceModule as any).updateTempChannelActivity(
                intr.guildId!, 
                voiceChannel.id, 
                'user_kicked', 
                targetUser.id, 
                { reason, kickedBy: intr.user.id }
            );

            // Try to send DM to kicked user
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('🦶 Aus TempVoice-Channel entfernt')
                    .setDescription(`Du wurdest aus einem temporären Voice-Channel entfernt.`)
                    .addFields(
                        { name: '📢 Server', value: intr.guild!.name, inline: true },
                        { name: '👤 Entfernt von', value: (intr.member as GuildMember).displayName, inline: true },
                        { name: '📝 Grund', value: reason, inline: false },
                        { name: '💡 Hinweis', value: 'Du kannst dem Channel wieder beitreten, es sei denn du wurdest verbannt.', inline: false }
                    )
                    .setColor(0xffa500)
                    .setTimestamp();
                
                await targetUser.send({ embeds: [dmEmbed] });
            } catch (error) {
                // DM failed - user has DMs disabled or blocked bot
                Logger.warn(`Konnte DM nicht an gekickten Nutzer ${targetUser.tag} senden`);
            }

            const embed = new EmbedBuilder()
                .setTitle('🦶 Nutzer entfernt')
                .setDescription(`**${targetMember.displayName}** wurde aus dem Channel entfernt!`)
                .addFields(
                    { name: '👤 Entfernter Nutzer', value: `${targetMember}`, inline: true },
                    { name: '👑 Entfernt von', value: `${intr.user}`, inline: true },
                    { name: '📝 Grund', value: reason, inline: false },
                    { name: '⏰ Entfernt', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                )
                .setColor(0xffa500)
                .setTimestamp()
                .setFooter({ text: 'TempVoice • User Kick • MongoDB' });

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

// 13. /byvoicestatus - Channel-Status anzeigen
export class TempVoiceStatusCommand implements Command {
    public metadata = {
        name: 'byvoicestatus',
        description: 'Zeigt detaillierte Informationen über den temporären Voice-Channel',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicestatus')
        .setDescription('Zeigt detaillierte Informationen über den temporären Voice-Channel');

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
            const channel = (intr.member as GuildMember).voice.channel as VoiceChannel;
            const textChannel = intr.guild!.channels.cache.get(tempChannelData.textChannelId) as TextChannel;
            
            // Calculate channel lifetime
            const lifetimeMs = Date.now() - tempChannelData.createdAt.getTime();
            const lifetimeMinutes = Math.floor(lifetimeMs / 60000);
            
            // Get connected users
            const connectedUsers = channel.members.map(member => member.displayName).join('\n') || 'Keine Nutzer verbunden';
            
            // Get banned users with names
            const bannedUserNames = tempChannelData.bannedUsers.length > 0 
                ? await Promise.all(
                    tempChannelData.bannedUsers.map(async userId => {
                        try {
                            const user = await intr.client.users.fetch(userId);
                            return user.username;
                        } catch {
                            return `Unknown User (${userId})`;
                        }
                    })
                ).then(names => names.join('\n'))
                : 'Keine verbannten Nutzer';

            // Status indicators
            const visibilityIcon = tempChannelData.isVisible ? '👁️' : '🙈';
            const lockIcon = tempChannelData.isLocked ? '🔒' : '🔓';
            const statusText = `${tempChannelData.isVisible ? 'Sichtbar' : 'Versteckt'} • ${tempChannelData.isLocked ? 'Gesperrt' : 'Offen'}`;

            const embed = new EmbedBuilder()
                .setTitle(`📊 Channel-Status: ${channel.name}`)
                .setDescription(`Detaillierte Informationen über deinen temporären Voice-Channel`)
                .setColor(0x3498db)
                .addFields(
                    { name: '👑 Besitzer', value: `${tempChannelData.ownerName}`, inline: true },
                    { name: '👥 Max. Nutzer', value: `${tempChannelData.maxUsers === 0 ? 
                        'Unbegrenzt' : tempChannelData.maxUsers}`, inline: true },
                    { name: `${visibilityIcon} Sichtbarkeit`, value: tempChannelData.isVisible ? 'Sichtbar' : 'Versteckt', inline: true },
                    { name: `${lockIcon} Zugang`, value: tempChannelData.isLocked ? 'Gesperrt' : 'Offen', inline: true },
                    { name: '📊 Status', value: statusText, inline: true },
                    { name: '🔢 Aktuelle Nutzer', value: `${channel.members.size}/${tempChannelData.maxUsers === 0 ? '∞' : tempChannelData.maxUsers}`, inline: true },
                    { name: '⏱️ Lebensdauer', value: `${lifetimeMinutes} Minuten`, inline: true },
                    { name: '🗄️ Speicher', value: 'MongoDB', inline: true },
                    { name: '📝 Text-Channel', value: textChannel ? `${textChannel}` : 'Nicht gefunden', inline: true },
                    { name: '⏰ Erstellt', value: `<t:${Math.floor(tempChannelData.createdAt.getTime() / 1000)}:R>`, inline: false },
                    { name: '👥 Verbundene Nutzer', value: connectedUsers, inline: false },
                    { name: '🚫 Verbannte Nutzer', value: bannedUserNames, inline: false }
                )
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Channel Status • MongoDB • Automatische Löschung bei Leere' });

            // Activity Log (last 5 activities) if available
            const activityLog = await (tempVoiceModule as any).getChannelActivity(intr.guildId!, channel.id, 5);
            if (activityLog && activityLog.length > 0) {
                const recentActivities = activityLog
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
        } catch (error) {
            Logger.error('Fehler beim Abrufen des Channel-Status', error);
            await intr.reply({
                content: '❌ Fehler beim Abrufen des Channel-Status!',
                ephemeral: true
            });
        }
    }
}
// src/commands/chat/tempvoice-commands.ts - Teil 4/8
// Admin-Commands und Statistiken

// 14. /byvoicelist - Admin Command: Alle aktiven Temp-Channels anzeigen
export class TempVoiceListCommand implements Command {
    public metadata = {
        name: 'byvoicelist',
        description: 'Zeigt alle aktiven temporären Voice-Channels (Admin)',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
        defaultMemberPermissions: PermissionFlagsBits.Administrator,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicelist')
        .setDescription('Zeigt alle aktiven temporären Voice-Channels (Admin)')
        .addBooleanOption(option =>
            option.setName('detailed')
                .setDescription('Zeigt detaillierte Informationen an')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        await intr.deferReply({ ephemeral: true });
        
        const detailed = intr.options.getBoolean('detailed') ?? false;
        
        try {
            const allChannels = await (tempVoiceModule as any).getAllTempChannels(intr.guildId!);
            
            if (allChannels.length === 0) {
                await intr.editReply({
                    content: '📭 Keine aktiven temporären Voice-Channels gefunden!'
                });
                return;
            }

            // Count active channels (channels with users)
            let activeCount = 0;
            const channelInfos: string[] = [];
            
            for (const channelData of allChannels) {
                const voiceChannel = intr.guild!.channels.cache.get(channelData.voiceChannelId) as VoiceChannel;
                if (!voiceChannel) continue;
                
                const isActive = voiceChannel.members.size > 0;
                if (isActive) activeCount++;
                
                const lifetimeMinutes = Math.floor((Date.now() - channelData.createdAt.getTime()) / 60000);
                const statusEmoji = isActive ? '🟢' : '🔴';
                const visibilityEmoji = channelData.isVisible ? '👁️' : '🙈';
                const lockEmoji = channelData.isLocked ? '🔒' : '🔓';
                
                if (detailed) {
                    channelInfos.push(
                        `${statusEmoji} **${voiceChannel.name}** (${voiceChannel.members.size}/${channelData.maxUsers === 0 ? '∞' : channelData.maxUsers})\n` +
                        `   👑 ${channelData.ownerName} ${visibilityEmoji}${lockEmoji} | ${lifetimeMinutes}min | 🚫${channelData.bannedUsers.length}`
                    );
                } else {
                    channelInfos.push(
                        `${statusEmoji} **${voiceChannel.name}** - ${channelData.ownerName} (${voiceChannel.members.size}/${channelData.maxUsers === 0 ? '∞' : channelData.maxUsers})`
                    );
                }
            }

            // Split into multiple embeds if too long
            const maxFieldLength = 1024;
            const chunks: string[] = [];
            let currentChunk = '';
            
            for (const info of channelInfos) {
                if ((currentChunk + info).length > maxFieldLength) {
                    chunks.push(currentChunk);
                    currentChunk = info;
                } else {
                    currentChunk += (currentChunk ? '\n' : '') + info;
                }
            }
            if (currentChunk) chunks.push(currentChunk);

            const embed = new EmbedBuilder()
                .setTitle('📋 Aktive TempVoice-Channels')
                .setDescription(`Übersicht aller temporären Voice-Channels auf diesem Server`)
                .setColor(0x3498db)
                .addFields(
                    { name: '📊 Zusammenfassung', value: 
                        `**${allChannels.length}** Channels gesamt\n` +
                        `**${activeCount}** aktive Channels\n` +
                        `**${allChannels.length - activeCount}** leere Channels`, inline: false }
                );

            // Add channel lists
            chunks.forEach((chunk, index) => {
                embed.addFields({
                    name: index === 0 ? '📢 Channel-Liste' : `📢 Channel-Liste (${index + 1})`,
                    value: chunk,
                    inline: false
                });
            });

            if (detailed) {
                embed.addFields({
                    name: '🔍 Legende',
                    value: '🟢 Aktiv | 🔴 Leer | 👁️ Sichtbar | 🙈 Versteckt | 🔒 Gesperrt | 🔓 Offen | 🚫 Verbannte',
                    inline: false
                });
            }

            embed
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

// 15. /byvoicestats - Erweiterte Channel-Statistiken
export class TempVoiceStatsCommand implements Command {
    public metadata = {
        name: 'byvoicestats',
        description: 'Zeigt erweiterte TempVoice-Statistiken (Admin)',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
        defaultMemberPermissions: PermissionFlagsBits.Administrator,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicestats')
        .setDescription('Zeigt erweiterte TempVoice-Statistiken (Admin)')
        .addStringOption(option =>
            option.setName('timeframe')
                .setDescription('Zeitraum für Statistiken')
                .setRequired(false)
                .addChoices(
                    { name: 'Heute', value: 'today' },
                    { name: 'Diese Woche', value: 'week' },
                    { name: 'Dieser Monat', value: 'month' },
                    { name: 'Alle Zeit', value: 'all' }
                ))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        await intr.deferReply({ ephemeral: true });
        
        const timeframe = intr.options.getString('timeframe') ?? 'all';
        
        try {
            const stats = await (tempVoiceModule as any).getDetailedStats(intr.guildId!, timeframe);
            
            const embed = new EmbedBuilder()
                .setTitle('📊 TempVoice Statistiken')
                .setDescription(`Erweiterte Statistiken für ${this.getTimeframeText(timeframe)}`)
                .setColor(0x3498db)
                .setTimestamp();

            // Basis-Statistiken
            embed.addFields(
                { name: '📈 Channels gesamt', value: `${stats.totalChannels}`, inline: true },
                { name: '🟢 Aktuell aktiv', value: `${stats.activeChannels}`, inline: true },
                { name: '📅 Neue Channels', value: `${stats.channelsInTimeframe}`, inline: true },
                { name: '🧠 Im Speicher', value: `${stats.memoryChannels}`, inline: true },
                { name: '⏱️ Ø Lebensdauer', value: `${Math.round(stats.avgChannelLifetime / 60000)} Min`, inline: true },
                { name: '👥 Ø Nutzer/Channel', value: `${stats.avgUsersPerChannel.toFixed(1)}`, inline: true }
            );

            // Performance-Statistiken
            embed.addFields(
                { name: '📊 Performance', value: 
                    `**${stats.totalBans}** Bans\n` +
                    `**${stats.totalKicks}** Kicks\n` +
                    `**${stats.totalClaims}** Claims\n` +
                    `**${stats.cleanupOperations}** Cleanups`, inline: true },
                { name: '🎯 Aktivitäten', value: 
                    `**${stats.totalNameChanges}** Umbenennungen\n` +
                    `**${stats.totalLimitChanges}** Limit-Änderungen\n` +
                    `**${stats.totalLockChanges}** Sperr-Änderungen\n` +
                    `**${stats.totalVisibilityChanges}** Sichtbarkeits-Änderungen`, inline: true },
                { name: '🗄️ System', value: 
                    `**MongoDB** Datenbank\n` +
                    `**${stats.databaseSize}** MB Speicher\n` +
                    `**${stats.indexedChannels}** Indiziert\n` +
                    `**${stats.orphanedChannels}** Verwaist`, inline: true }
            );

            // Top Channel-Ersteller
            if (stats.topOwners && stats.topOwners.length > 0) {
                const topOwnersList = stats.topOwners
                    .slice(0, 5)
                    .map((owner, index) => 
                        `${index + 1}. **${owner.ownerName}**: ${owner.count} Channels`
                    ).join('\n');
                
                embed.addFields({
                    name: '👑 Top Channel-Ersteller',
                    value: topOwnersList,
                    inline: false
                });
            }

            // Trending Activities (if available)
            if (stats.trendingActivities && stats.trendingActivities.length > 0) {
                const trendingList = stats.trendingActivities
                    .slice(0, 3)
                    .map((activity, index) => 
                        `${index + 1}. **${activity.type}**: ${activity.count}x`
                    ).join('\n');
                
                embed.addFields({
                    name: '📈 Trending Aktivitäten',
                    value: trendingList,
                    inline: true
                });
            }

            // Peak Times (if available)
            if (stats.peakHours && stats.peakHours.length > 0) {
                const peakHoursList = stats.peakHours
                    .slice(0, 3)
                    .map((hour, index) => 
                        `${index + 1}. **${hour.hour}:00**: ${hour.count} Channels`
                    ).join('\n');
                
                embed.addFields({
                    name: '⏰ Peak-Zeiten',
                    value: peakHoursList,
                    inline: true
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

// 16. /byvoicecleanup - Admin Cleanup Command
export class TempVoiceCleanupCommand implements Command {
    public metadata = {
        name: 'byvoicecleanup',
        description: 'Bereinigt leere temporäre Voice-Channels (Admin)',
        type: ApplicationCommandType.ChatInput,
        dmPermission: false,
        defaultMemberPermissions: PermissionFlagsBits.Administrator,
    };

    public data = new SlashCommandBuilder()
        .setName('byvoicecleanup')
        .setDescription('Bereinigt leere temporäre Voice-Channels (Admin)')
        .addBooleanOption(option =>
            option.setName('force')
                .setDescription('Erzwingt Cleanup auch für nicht-leere Channels')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('older_than')
                .setDescription('Nur Channels älter als X Minuten bereinigen')
                .setRequired(false)
                .setMinValue(5)
                .setMaxValue(1440))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    public async execute(intr: ChatInputCommandInteraction): Promise<void> {
        await intr.deferReply({ ephemeral: true });
        
        const force = intr.options.getBoolean('force') ?? false;
        const olderThanMinutes = intr.options.getInteger('older_than') ?? 0;
        
        try {
            const beforeCleanup = await (tempVoiceModule as any).getAllTempChannels(intr.guildId!);
            const beforeCount = beforeCleanup.length;
            
            let cleanedChannels = 0;
            let errorChannels = 0;
            const cleanedChannelNames: string[] = [];
            
            for (const channelData of beforeCleanup) {
                try {
                    const voiceChannel = intr.guild!.channels.cache.get(channelData.voiceChannelId) as VoiceChannel;
                    if (!voiceChannel) {
                        // Channel doesn't exist anymore, remove from database
                        await (tempVoiceModule as any).deleteTempChannel(intr.guildId!, channelData.voiceChannelId);
                        cleanedChannels++;
                        cleanedChannelNames.push(`${channelData.voiceChannelId} (nicht gefunden)`);
                        continue;
                    }
                    
                    // Check age requirement
                    if (olderThanMinutes > 0) {
                        const channelAgeMinutes = (Date.now() - channelData.createdAt.getTime()) / 60000;
                        if (channelAgeMinutes < olderThanMinutes) {
                            continue;
                        }
                    }
                    
                    // Check if channel should be cleaned
                    const isEmpty = voiceChannel.members.size === 0;
                    if (isEmpty || force) {
                        await (tempVoiceModule as any).deleteEmptyTempChannel(intr.guild!, channelData.voiceChannelId);
                        cleanedChannels++;
                        cleanedChannelNames.push(voiceChannel.name);
                        
                        // Log cleanup action
                        await (tempVoiceModule as any).updateTempChannelActivity(
                            intr.guildId!, 
                            channelData.voiceChannelId, 
                            'admin_cleanup', 
                            intr.user.id,
                            { force, olderThanMinutes }
                        );
                    }
                } catch (error) {
                    Logger.error(`Fehler beim Bereinigen von Channel ${channelData.voiceChannelId}`, error);
                    errorChannels++;
                }
            }

            const afterCleanup = await (tempVoiceModule as any).getAllTempChannels(intr.guildId!);
            const afterCount = afterCleanup.length;
            
            const embed = new EmbedBuilder()
                .setTitle('🧹 Cleanup abgeschlossen!')
                .setDescription(`Bereinigungs-Operation erfolgreich durchgeführt`)
                .setColor(cleanedChannels > 0 ? 0x00ff00 : 0x95a5a6)
                .addFields(
                    { name: '📊 Ergebnis', value: 
                        `**${beforeCount}** Channels vorher\n` +
                        `**${afterCount}** Channels nachher\n` +
                        `**${cleanedChannels}** bereinigt\n` +
                        `**${errorChannels}** Fehler`, inline: true },
                    { name: '⚙️ Parameter', value: 
                        `**Force:** ${force ? 'Ja' : 'Nein'}\n` +
                        `**Min. Alter:** ${olderThanMinutes > 0 ? `${olderThanMinutes}min` : 'Keins'}\n` +
                        `**Operator:** ${(intr.member as GuildMember).displayName}`, inline: true },
                    { name: '🗄️ System', value: 
                        `**MongoDB** Datenbank\n` +
                        `**Konsistent** nach Cleanup\n` +
                        `**${Date.now()}** Timestamp`, inline: true }
                );

            if (cleanedChannelNames.length > 0) {
                const channelList = cleanedChannelNames
                    .slice(0, 10)
                    .join('\n') + 
                    (cleanedChannelNames.length > 10 ? `\n... und ${cleanedChannelNames.length - 10} weitere` : '');
                
                embed.addFields({
                    name: '🗑️ Bereinigte Channels',
                    value: channelList,
                    inline: false
                });
            }

            embed
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Admin Cleanup • MongoDB • Operation abgeschlossen' });

            await intr.editReply({ embeds: [embed] });
            
            Logger.info(`✅ Admin Cleanup: ${cleanedChannels} Channels bereinigt von ${(intr.member as GuildMember).displayName}`);
        } catch (error) {
            Logger.error('Fehler beim Cleanup', error);
            await intr.editReply({
                content: '❌ Fehler beim Bereinigen der Channels!'
            });
        }
    }
}

// 17. /byvoiceconfig - Server-Konfiguration
export class TempVoiceConfigCommand implements Command {
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
            
            const creatorChannelList = config.creatorChannels.length > 0
                ? await Promise.all(
                    config.creatorChannels.map(async (channelId: string) => {
                        const channel = intr.guild!.channels.cache.get(channelId);
                        return channel ? `${channel.name} (${channelId})` : `Gelöscht (${channelId})`;
                    })
                ).then(channels => channels.join('\n'))
                : 'Keine Creator-Channels konfiguriert';

            const embed = new EmbedBuilder()
                .setTitle('⚙️ TempVoice-Konfiguration')
                .setDescription(`Aktuelle Einstellungen für **${intr.guild!.name}**`)
                .setColor(0x3498db)
                .addFields(
                    { name: '👥 Standard Max-Users', value: `${config.defaultMaxUsers}`, inline: true },
                    { name: '🧹 Cleanup-Intervall', value: `${config.cleanupInterval / 1000}s`, inline: true },
                    { name: '📢 Creator-Channels', value: `${config.creatorChannels.length}`, inline: true },
                    { name: '🗄️ Datenbank', value: 'MongoDB', inline: true },
                    { name: '🆔 Guild ID', value: config.guildId, inline: true },
                    { name: '📊 Status', value: 'Aktiv', inline: true },
                    { name: '📋 Creator-Channel Liste', value: creatorChannelList, inline: false }
                )
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Server Config • MongoDB' });

            await intr.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            Logger.error('Fehler beim Anzeigen der Konfiguration', error);
            await intr.reply({
                content: '❌ Fehler beim Anzeigen der Konfiguration!',
                ephemeral: true
            });
        }
    }

    private async setConfig(intr: ChatInputCommandInteraction): Promise<void> {
        try {
            const defaultMaxUsers = intr.options.getInteger('default_max_users');
            const cleanupInterval = intr.options.getInteger('cleanup_interval');
            const autoDeleteText = intr.options.getBoolean('auto_delete_text');

            const config = (tempVoiceModule as any).getGuildConfig(intr.guildId!);
            let changes: string[] = [];

            if (defaultMaxUsers !== null) {
                config.defaultMaxUsers = defaultMaxUsers;
                changes.push(`**Max-Users:** ${defaultMaxUsers}`);
            }

            if (cleanupInterval !== null) {
                config.cleanupInterval = cleanupInterval * 1000; // Convert to milliseconds
                changes.push(`**Cleanup-Intervall:** ${cleanupInterval}s`);
            }

            if (autoDeleteText !== null) {
                config.autoDeleteText = autoDeleteText;
                changes.push(`**Auto-Delete Text:** ${autoDeleteText ? 'Aktiviert' : 'Deaktiviert'}`);
            }

            if (changes.length === 0) {
                await intr.reply({
                    content: '❌ Keine Änderungen angegeben!',
                    ephemeral: true
                });
                return;
            }

            // Save configuration
            const success = await (tempVoiceModule as any).saveGuildConfig(intr.guildId!, config);
            
            if (!success) {
                await intr.reply({
                    content: '❌ Fehler beim Speichern der Konfiguration!',
                    ephemeral: true
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Konfiguration aktualisiert!')
                .setDescription(`Die TempVoice-Einstellungen wurden erfolgreich geändert`)
                .setColor(0x00ff00)
                .addFields(
                    { name: '🔄 Änderungen', value: changes.join('\n'), inline: false },
                    { name: '👤 Geändert von', value: `${intr.user}`, inline: true },
                    { name: '⏰ Zeitpunkt', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Config Update • MongoDB' });

            await intr.reply({ embeds: [embed], ephemeral: true });
            
            Logger.info(`⚙️ Config Update: ${changes.join(', ')} von ${(intr.member as GuildMember).displayName}`);
        } catch (error) {
            Logger.error('Fehler beim Setzen der Konfiguration', error);
            await intr.reply({
                content: '❌ Fehler beim Ändern der Konfiguration!',
                ephemeral: true
            });
        }
    }

    private async resetConfig(intr: ChatInputCommandInteraction): Promise<void> {
        try {
            const defaultConfig = {
                guildId: intr.guildId!,
                creatorChannels: [],
                defaultMaxUsers: 5,
                cleanupInterval: 300000, // 5 minutes
                autoDeleteText: true
            };

            const success = await (tempVoiceModule as any).saveGuildConfig(intr.guildId!, defaultConfig);
            
            if (!success) {
                await intr.reply({
                    content: '❌ Fehler beim Zurücksetzen der Konfiguration!',
                    ephemeral: true
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('🔄 Konfiguration zurückgesetzt!')
                .setDescription(`Die TempVoice-Einstellungen wurden auf Standard zurückgesetzt`)
                .setColor(0xffa500)
                .addFields(
                    { name: '⚙️ Standard-Werte', value: 
                        `**Max-Users:** 5\n` +
                        `**Cleanup-Intervall:** 300s\n` +
                        `**Auto-Delete Text:** Aktiviert\n` +
                        `**Creator-Channels:** Gelöscht`, inline: false },
                    { name: '👤 Zurückgesetzt von', value: `${intr.user}`, inline: true },
                    { name: '⏰ Zeitpunkt', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'TempVoice • Config Reset • MongoDB' });

            await intr.reply({ embeds: [embed], ephemeral: true });
            
            Logger.info(`🔄 Config Reset von ${(intr.member as GuildMember).displayName}`);
        } catch (error) {
            Logger.error('Fehler beim Zurücksetzen der Konfiguration', error);
            await intr.reply({
                content: '❌ Fehler beim Zurücksetzen der Konfiguration!',
                ephemeral: true
            });
        }
    }
}