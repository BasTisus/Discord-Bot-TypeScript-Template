// src/modules/tempvoice/index.ts - Mit MongoDB Fallback für Testing
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
    lastActivity?: Date;
    activityLog?: Array<{
        activity: string;
        userId: string;
        timestamp: Date;
    }>;
}

interface GuildConfig {
    guildId: string;
    creatorChannels: string[];
    defaultMaxUsers: number;
    cleanupInterval: number;
    createdAt?: Date;
    updatedAt?: Date;
}

export class TempVoiceModule {
    public description = 'Temporäre Voice-Kanäle mit anpassbaren Einstellungen';
    public version = '2.0.0';
    
    // Memory-Only für Testing (ohne MongoDB)
    private tempChannels = new Map<string, Map<string, TempChannelData>>();
    private guildConfigs = new Map<string, GuildConfig>();
    private mongoEnabled = false;
    
    constructor() {
        this.initMemoryMode();
    }

    private initMemoryMode(): void {
        Logger.info('✅ TempVoice-Modul: Memory-Modus aktiviert (Testing ohne MongoDB)');
        this.mongoEnabled = false;
    }

    private getGuildConfig(guildId: string): GuildConfig {
        let config = this.guildConfigs.get(guildId);
        if (!config) {
            config = {
                guildId,
                creatorChannels: [],
                defaultMaxUsers: 3,
                cleanupInterval: 30000,
                createdAt: new Date(),
                updatedAt: new Date()
            };
            this.guildConfigs.set(guildId, config);
        }
        return config;
    }

    private saveGuildConfig(guildId: string, configData: Partial<GuildConfig>): boolean {
        try {
            const updateData = {
                ...configData,
                guildId,
                updatedAt: new Date()
            } as GuildConfig;
            
            this.guildConfigs.set(guildId, updateData);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Speichern der TempVoice Config', error);
            return false;
        }
    }

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

    private getAllTempChannels(guildId: string): TempChannelData[] {
        const guildChannels = this.tempChannels.get(guildId);
        return guildChannels ? Array.from(guildChannels.values()) : [];
    }

    private isCreatorChannel(guildId: string, channelId: string): boolean {
        const config = this.getGuildConfig(guildId);
        return config.creatorChannels.includes(channelId);
    }

    private async createTempChannel(guild: Guild, member: GuildMember, creatorChannel: VoiceChannel): Promise<{ voiceChannel: VoiceChannel; textChannel: TextChannel }> {
        try {
            const config = this.getGuildConfig(guild.id);
            const category = creatorChannel.parent as CategoryChannel | null;
            const maxUsers = config.defaultMaxUsers || 3;

            // Erstelle Voice Channel
            const voiceChannel = await guild.channels.create({
                name: `${member.displayName}'s Channel`,
                type: ChannelType.GuildVoice,
                parent: category,
                userLimit: maxUsers,
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