// src/modules/tempvoice/index.ts - Vollständiges TempVoice-Modul (Testing-Version)
import { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ChannelType, 
    PermissionsBitField,
    Guild,
    GuildMember,
    VoiceChannel,
    TextChannel,
    CategoryChannel,
    VoiceState,
    Client,
    CommandInteraction,
    User
} from 'discord.js';
import { Logger } from '../../services/index.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface TempChannelData {
    voiceChannelId: string;
    textChannelId: string;
    ownerId: string;
    ownerName: string;
    maxUsers: number;
    isVisible: boolean;
    isLocked: boolean;
    bannedUsers: string[];
    createdAt: Date;
    guildId: string;
}

interface GuildConfig {
    guildId: string;
    creatorChannels: string[];
    defaultMaxUsers: number;
    cleanupInterval: number;
}

export class TempVoiceModule {
    public description = 'Temporäre Voice-Kanäle mit anpassbaren Einstellungen';
    public version = '2.0.0';
    
    // Memory-Only für Testing (ohne MongoDB)
    private tempChannels = new Map<string, Map<string, TempChannelData>>();
    private guildConfigs = new Map<string, GuildConfig>();
    
    constructor() {
        Logger.info('✅ TempVoice-Modul: Memory-Modus aktiviert (Testing ohne MongoDB)');
    }

    // Config-Management
    public getGuildConfig(guildId: string): GuildConfig {
        let config = this.guildConfigs.get(guildId);
        if (!config) {
            config = {
                guildId,
                creatorChannels: [],
                defaultMaxUsers: 5,
                cleanupInterval: 30000
            };
            this.guildConfigs.set(guildId, config);
        }
        return config;
    }

    public saveGuildConfig(guildId: string, configData: Partial<GuildConfig>): boolean {
        try {
            const updateData = { ...configData, guildId } as GuildConfig;
            this.guildConfigs.set(guildId, updateData);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Speichern der TempVoice Config', error);
            return false;
        }
    }

    // Channel-Management
    private getTempChannel(guildId: string, channelId: string): TempChannelData | null {
        const guildChannels = this.tempChannels.get(guildId);
        return guildChannels ? guildChannels.get(channelId) || null : null;
    }

    private setTempChannel(guildId: string, channelId: string, data: TempChannelData): boolean {
        try {
            if (!this.tempChannels.has(guildId)) {
                this.tempChannels.set(guildId, new Map());
            }
            this.tempChannels.get(guildId)!.set(channelId, data);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Speichern des Temp-Channels', error);
            return false;
        }
    }

    private deleteTempChannel(guildId: string, channelId: string): boolean {
        try {
            const guildChannels = this.tempChannels.get(guildId);
            if (guildChannels) {
                guildChannels.delete(channelId);
                if (guildChannels.size === 0) {
                    this.tempChannels.delete(guildId);
                }
            }
            return true;
        } catch (error) {
            Logger.error('Fehler beim Löschen des Temp-Channels', error);
            return false;
        }
    }

    public getAllTempChannels(guildId: string): TempChannelData[] {
        const guildChannels = this.tempChannels.get(guildId);
        return guildChannels ? Array.from(guildChannels.values()) : [];
    }

    private isCreatorChannel(guildId: string, channelId: string): boolean {
        const config = this.getGuildConfig(guildId);
        return config.creatorChannels.includes(channelId);
    }

    // Channel-Erstellung
    private async createTempChannel(guild: Guild, member: GuildMember, creatorChannel: VoiceChannel): Promise<void> {
        try {
            const config = this.getGuildConfig(guild.id);
            const category = creatorChannel.parent as CategoryChannel | null;
            const maxUsers = config.defaultMaxUsers || 5;

            // Erstelle Voice Channel
            const voiceChannel = await guild.channels.create({
                name: `${member.displayName}'s Channel`,
                type: ChannelType.GuildVoice,
                parent: category,
                userLimit: maxUsers,
                permissionOverwrites: [
                    {
                        id: member.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.Connect,
                            PermissionsBitField.Flags.ManageChannels,
                            PermissionsBitField.Flags.MuteMembers
                        ],
                        type: 1
                    }
                ]
            });

            // Erstelle Text Channel
            const textChannel = await guild.channels.create({
                name: `📝-${member.displayName.toLowerCase().replace(/\s+/g, '-')}`,
                type: ChannelType.GuildText,
                parent: category,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionsBitField.Flags.ViewChannel],
                        type: 0
                    },
                    {
                        id: member.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel, 
                            PermissionsBitField.Flags.SendMessages, 
                            PermissionsBitField.Flags.ManageMessages
                        ],
                        type: 1
                    }
                ]
            });

            // Speichere Channel-Daten
            const tempChannelData: TempChannelData = {
                voiceChannelId: voiceChannel.id,
                textChannelId: textChannel.id,
                ownerId: member.id,
                ownerName: member.displayName,
                maxUsers: maxUsers,
                isVisible: true,
                isLocked: false,
                bannedUsers: [],
                createdAt: new Date(),
                guildId: guild.id
            };

            this.setTempChannel(guild.id, voiceChannel.id, tempChannelData);

            // Move User zu seinem Channel
            if (member.voice.channel) {
                await member.voice.setChannel(voiceChannel);
            }

            // Sende Info-Nachricht
            await this.sendChannelInfo(textChannel, tempChannelData, member);

            Logger.info(`✅ Temp-Channel erstellt: ${voiceChannel.name} (${voiceChannel.id})`);
        } catch (error) {
            Logger.error('Fehler beim Erstellen des Temp-Channels', error);
        }
    }

    private async sendChannelInfo(textChannel: TextChannel, channelData: TempChannelData, owner: GuildMember): Promise<void> {
        const embed = new EmbedBuilder()
            .setTitle('🎤 Dein temporärer Voice-Channel')
            .setDescription(`Willkommen in deinem persönlichen Voice-Channel, ${owner}!`)
            .setColor(0x00ff00)
            .addFields(
                { name: '👑 Besitzer', value: `<@${channelData.ownerId}>`, inline: true },
                { name: '👥 Max. Nutzer', value: `${channelData.maxUsers}`, inline: true },
                { name: '⏰ Erstellt', value: `<t:${Math.floor(channelData.createdAt.getTime() / 1000)}:R>`, inline: true },
                { name: '🗑️ Auto-Löschung', value: 'Wird automatisch gelöscht wenn leer', inline: false },
                { name: '🛠️ Commands', value: '`/tempvoicestatus` - Channel-Status anzeigen', inline: false }
            )
            .setFooter({ text: 'TempVoice System • Testing Version • Memory Storage' })
            .setTimestamp();

        await textChannel.send({ embeds: [embed] });
    }

    // Voice State Handler - HAUPTLOGIK
    public async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState, client: Client): Promise<void> {
        const guild = newState.guild || oldState.guild;

        // 1. User joined a CREATOR channel → Create temp channel
        if (newState.channel && this.isCreatorChannel(guild.id, newState.channel.id)) {
            try {
                Logger.info(`👤 ${newState.member?.displayName} joined creator channel ${newState.channel.name}`);
                await this.createTempChannel(guild, newState.member!, newState.channel as VoiceChannel);
            } catch (error) {
                Logger.error('Fehler beim Erstellen des Temp-Channels', error);
            }
            return;
        }

        // 2. User joined a TEMP channel → Give text channel access
        if (newState.channel) {
            const tempChannelData = this.getTempChannel(guild.id, newState.channel.id);
            if (tempChannelData) {
                const textChannel = guild.channels.cache.get(tempChannelData.textChannelId) as TextChannel;
                if (textChannel) {
                    try {
                        await textChannel.permissionOverwrites.create(newState.member!, {
                            ViewChannel: true,
                            SendMessages: true,
                            ReadMessageHistory: true
                        });
                        Logger.info(`✅ ${newState.member?.displayName} hat Zugang zu Text-Channel erhalten`);
                    } catch (error) {
                        Logger.error('Fehler beim Gewähren von Text-Channel Zugang', error);
                    }
                }
            }
        }

        // 3. User left a TEMP channel → Remove access & check if empty
        if (oldState.channel) {
            const tempChannelData = this.getTempChannel(guild.id, oldState.channel.id);
            if (tempChannelData) {
                // Remove text channel access
                const textChannel = guild.channels.cache.get(tempChannelData.textChannelId) as TextChannel;
                if (textChannel) {
                    try {
                        await textChannel.permissionOverwrites.delete(oldState.member!);
                        Logger.info(`❌ ${oldState.member?.displayName} Text-Channel Zugang entfernt`);
                    } catch (error) {
                        Logger.error('Fehler beim Entfernen von Text-Channel Zugang', error);
                    }
                }

                // Check if voice channel is now empty → AUTO DELETE
                if (oldState.channel.members.size === 0) {
                    Logger.info(`🗑️ Channel ${oldState.channel.name} ist leer - wird gelöscht`);
                    setTimeout(() => {
                        this.deleteEmptyTempChannel(guild, oldState.channel!.id);
                    }, 1000);
                }
            }
        }
    }

    private async deleteEmptyTempChannel(guild: Guild, voiceChannelId: string): Promise<void> {
        const tempChannelData = this.getTempChannel(guild.id, voiceChannelId);
        if (!tempChannelData) return;

        try {
            const voiceChannel = guild.channels.cache.get(voiceChannelId) as VoiceChannel;
            if (voiceChannel && voiceChannel.members.size > 0) {
                Logger.warn(`⚠️ Channel ${voiceChannel.name} ist nicht leer - Löschung abgebrochen`);
                return;
            }

            if (voiceChannel) {
                await voiceChannel.delete('Temporärer Channel ist leer');
                Logger.info(`🗑️ Voice-Channel gelöscht: ${voiceChannel.name}`);
            }

            const textChannel = guild.channels.cache.get(tempChannelData.textChannelId) as TextChannel;
            if (textChannel) {
                await textChannel.delete('Temporärer Channel ist leer');
                Logger.info(`🗑️ Text-Channel gelöscht: ${textChannel.name}`);
            }

            this.deleteTempChannel(guild.id, voiceChannelId);
            Logger.info(`✅ Temp-Channel komplett gelöscht: ${voiceChannelId}`);
        } catch (error) {
            Logger.error('Fehler beim Löschen des Temp-Channels', error);
        }
    }

    // Helper-Methoden
    public isChannelOwner(guildId: string, channelId: string, userId: string): boolean {
        const tempChannelData = this.getTempChannel(guildId, channelId);
        return tempChannelData ? tempChannelData.ownerId === userId : false;
    }

    public isInTempChannel(interaction: CommandInteraction): TempChannelData | null {
        const member = interaction.member as GuildMember;
        if (!member?.voice.channel) return null;
        
        return this.getTempChannel(interaction.guildId!, member.voice.channel.id);
    }

    // Cleanup-Funktionen
    public async cleanupEmptyChannels(client: Client): Promise<void> {
        try {
            for (const [guildId, guildChannels] of this.tempChannels) {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) {
                    this.tempChannels.delete(guildId);
                    continue;
                }

                for (const [channelId, channelData] of guildChannels) {
                    const voiceChannel = guild.channels.cache.get(channelId) as VoiceChannel;
                    if (!voiceChannel || voiceChannel.members.size === 0) {
                        Logger.info(`🧹 Cleanup: Lösche leeren Channel ${channelId}`);
                        await this.deleteEmptyTempChannel(guild, channelId);
                    }
                }
            }
        } catch (error) {
            Logger.error('Fehler beim Cleanup leerer Channels', error);
        }
    }

    public async cleanup(client: Client): Promise<void> {
        Logger.info('🧹 TempVoice-Modul wird bereinigt...');
        try {
            this.tempChannels.clear();
            this.guildConfigs.clear();
        } catch (error) {
            Logger.error('Fehler beim TempVoice Cleanup', error);
        }
    }

    // Initialisierung
    public init(client: Client): void {
        // Voice State Update Handler
        client.on('voiceStateUpdate', (oldState, newState) => {
            this.handleVoiceStateUpdate(oldState, newState, client);
        });

        // Cleanup Timer - alle 5 Minuten
        setInterval(() => {
            this.cleanupEmptyChannels(client);
        }, 300000);

        Logger.info('✅ TempVoice-Modul erfolgreich initialisiert (Testing-Version)');
        Logger.info('🔄 Automatische Cleanup-Routine aktiviert (5min Intervall)');
        Logger.info('⚡ Memory-Storage für Testing ohne MongoDB');
    }
}

// Export der TempVoice-Modul Instanz
export const tempVoiceModule = new TempVoiceModule();