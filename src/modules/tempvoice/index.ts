// src/modules/tempvoice/index.ts - Vollständiges TempVoice-Modul mit MongoDB
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

// MongoDB Support (optional)
let MongoClient: any = null;
let mongoEnabled = false;

try {
    const mongodb = require('mongodb');
    MongoClient = mongodb.MongoClient;
    mongoEnabled = true;
} catch (error) {
    Logger.warn('MongoDB nicht verfügbar - läuft im Memory-Modus');
}

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
    
    // MongoDB Configuration
    private mongoUri: string;
    private dbName: string;
    private configCollectionName = 'tempvoice_configs';
    private tempChannelsCollectionName = 'tempvoice_channels';
    
    private mongoClient: any = null;
    private db: any = null;
    private configCollection: any = null;
    private tempChannelsCollection: any = null;
    
    // Memory-Storage als Fallback
    private tempChannels = new Map<string, Map<string, TempChannelData>>();
    private guildConfigs = new Map<string, GuildConfig>();
    private usingMongoDB = false;
    
    constructor() {
        this.mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
        this.dbName = process.env.MONGODB_DB_NAME || 'borety_bot';
        this.initStorage();
    }

    private async initStorage(): Promise<void> {
        if (mongoEnabled) {
            try {
                await this.initMongoDB();
            } catch (error) {
                Logger.warn('MongoDB-Initialisierung fehlgeschlagen, verwende Memory-Modus');
                this.initMemoryMode();
            }
        } else {
            this.initMemoryMode();
        }
    }

    private async initMongoDB(): Promise<void> {
        try {
            this.mongoClient = new MongoClient(this.mongoUri);
            await this.mongoClient.connect();
            this.db = this.mongoClient.db(this.dbName);
            this.configCollection = this.db.collection(this.configCollectionName);
            this.tempChannelsCollection = this.db.collection(this.tempChannelsCollectionName);
            
            // Indices für bessere Performance
            await this.configCollection.createIndex({ guildId: 1 }, { unique: true });
            await this.tempChannelsCollection.createIndex({ guildId: 1, voiceChannelId: 1 }, { unique: true });
            await this.tempChannelsCollection.createIndex({ guildId: 1 });
            await this.tempChannelsCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 });
            
            // Lade bestehende Temp-Channels in Memory
            await this.loadTempChannelsFromDB();
            
            this.usingMongoDB = true;
            Logger.info('✅ TempVoice-Modul: MongoDB-Verbindung hergestellt');
        } catch (error) {
            Logger.error('❌ TempVoice-Modul: MongoDB-Verbindungsfehler', error);
            throw error;
        }
    }

    private initMemoryMode(): void {
        this.usingMongoDB = false;
        Logger.info('✅ TempVoice-Modul: Memory-Modus aktiviert (ohne MongoDB)');
    }

    private async loadTempChannelsFromDB(): Promise<void> {
        if (!this.usingMongoDB) return;
        
        try {
            const tempChannels = await this.tempChannelsCollection.find({}).toArray();
            
            for (const channelData of tempChannels) {
                const guildId = channelData.guildId;
                const voiceChannelId = channelData.voiceChannelId;
                
                if (!this.tempChannels.has(guildId)) {
                    this.tempChannels.set(guildId, new Map());
                }
                
                this.tempChannels.get(guildId)!.set(voiceChannelId, channelData);
            }
            
            Logger.info(`🔄 ${tempChannels.length} Temp-Channels aus DB geladen`);
        } catch (error) {
            Logger.error('Fehler beim Laden der Temp-Channels aus DB', error);
        }
    }

    // Guild Config Management
    public async getGuildConfig(guildId: string): Promise<GuildConfig> {
        if (this.usingMongoDB) {
            try {
                const config = await this.configCollection.findOne({ guildId });
                
                if (!config) {
                    const defaultConfig: GuildConfig = {
                        guildId,
                        creatorChannels: [],
                        defaultMaxUsers: 3,
                        cleanupInterval: 30000,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    };
                    
                    await this.configCollection.insertOne(defaultConfig);
                    return defaultConfig;
                }
                
                return config;
            } catch (error) {
                Logger.error('Fehler beim Lesen der TempVoice Config', error);
            }
        }
        
        // Memory Fallback
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

    public async saveGuildConfig(guildId: string, configData: Partial<GuildConfig>): Promise<boolean> {
        if (this.usingMongoDB) {
            try {
                const updateData = {
                    ...configData,
                    guildId,
                    updatedAt: new Date()
                };
                
                const result = await this.configCollection.replaceOne(
                    { guildId },
                    updateData,
                    { upsert: true }
                );
                
                // Update Memory Cache
                this.guildConfigs.set(guildId, updateData as GuildConfig);
                
                return result.acknowledged;
            } catch (error) {
                Logger.error('Fehler beim Speichern der TempVoice Config', error);
                return false;
            }
        }
        
        // Memory Fallback
        try {
            const updateData = { ...configData, guildId, updatedAt: new Date() } as GuildConfig;
            this.guildConfigs.set(guildId, updateData);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Speichern der TempVoice Config', error);
            return false;
        }
    }

    // Channel Management
    private getTempChannel(guildId: string, channelId: string): TempChannelData | null {
        const guildChannels = this.tempChannels.get(guildId);
        return guildChannels ? guildChannels.get(channelId) || null : null;
    }

    private async setTempChannel(guildId: string, channelId: string, data: TempChannelData): Promise<boolean> {
        if (this.usingMongoDB) {
            try {
                const channelData = {
                    ...data,
                    guildId,
                    voiceChannelId: channelId,
                    updatedAt: new Date()
                };
                
                await this.tempChannelsCollection.replaceOne(
                    { guildId, voiceChannelId: channelId },
                    channelData,
                    { upsert: true }
                );
            } catch (error) {
                Logger.error('Fehler beim Speichern des Temp-Channels in DB', error);
            }
        }
        
        // Update Memory (always)
        if (!this.tempChannels.has(guildId)) {
            this.tempChannels.set(guildId, new Map());
        }
        this.tempChannels.get(guildId)!.set(channelId, data);
        
        return true;
    }

    private async deleteTempChannel(guildId: string, channelId: string): Promise<boolean> {
        if (this.usingMongoDB) {
            try {
                await this.tempChannelsCollection.deleteOne({
                    guildId,
                    voiceChannelId: channelId
                });
            } catch (error) {
                Logger.error('Fehler beim Löschen des Temp-Channels aus DB', error);
            }
        }
        
        // Delete from Memory (always)
        const guildChannels = this.tempChannels.get(guildId);
        if (guildChannels) {
            guildChannels.delete(channelId);
            if (guildChannels.size === 0) {
                this.tempChannels.delete(guildId);
            }
        }
        
        return true;
    }

    public getAllTempChannels(guildId: string): TempChannelData[] {
        const guildChannels = this.tempChannels.get(guildId);
        return guildChannels ? Array.from(guildChannels.values()) : [];
    }

    private async isCreatorChannel(guildId: string, channelId: string): Promise<boolean> {
        const config = await this.getGuildConfig(guildId);
        return config.creatorChannels.includes(channelId);
    }

    // Activity Logging
    private async updateTempChannelActivity(guildId: string, channelId: string, activity: string, userId: string): Promise<void> {
        const tempChannelData = this.getTempChannel(guildId, channelId);
        if (!tempChannelData) return;

        if (!tempChannelData.activityLog) {
            tempChannelData.activityLog = [];
        }

        tempChannelData.activityLog.push({
            activity,
            userId,
            timestamp: new Date()
        });

        // Keep only last 20 activities
        if (tempChannelData.activityLog.length > 20) {
            tempChannelData.activityLog = tempChannelData.activityLog.slice(-20);
        }

        tempChannelData.lastActivity = new Date();
        await this.setTempChannel(guildId, channelId, tempChannelData);
    }
// Channel Creation & Management (TEIL 2/3)

    private async updateOwnerPermissions(voiceChannel: VoiceChannel, textChannel: TextChannel | null, newOwner: GuildMember, oldOwnerId?: string): Promise<void> {
        try {
            // Entferne alte Owner-Permissions
            if (oldOwnerId) {
                const oldOwner = voiceChannel.guild.members.cache.get(oldOwnerId);
                if (oldOwner) {
                    await voiceChannel.permissionOverwrites.delete(oldOwner);
                    if (textChannel) {
                        await textChannel.permissionOverwrites.delete(oldOwner);
                    }
                }
            }

            // Gebe neue Owner-Permissions
            await voiceChannel.permissionOverwrites.create(newOwner, {
                ManageChannels: true,
                MuteMembers: true,
                DeafenMembers: true,
                MoveMembers: true
            });
            
            if (textChannel) {
                await textChannel.permissionOverwrites.create(newOwner, {
                    ViewChannel: true,
                    SendMessages: true,
                    ManageMessages: true,
                    EmbedLinks: true,
                    AttachFiles: true
                });
            }
        } catch (error) {
            Logger.error('Fehler beim Update der Owner-Permissions', error);
        }
    }

    private async createTempChannel(guild: Guild, member: GuildMember, creatorChannel: VoiceChannel): Promise<{ voiceChannel: VoiceChannel; textChannel: TextChannel }> {
        try {
            const config = await this.getGuildConfig(guild.id);
            const category = creatorChannel.parent as CategoryChannel | null;
            const maxUsers = config.defaultMaxUsers || 3;
            
            // Basis-Permissions von der Kategorie kopieren (NUR für Voice-Channel)
            let basePermissions: any[] = [];
            if (category && category.permissionOverwrites) {
                basePermissions = category.permissionOverwrites.cache.map(overwrite => ({
                    id: overwrite.id,
                    allow: overwrite.allow.toArray(),
                    deny: overwrite.deny.toArray(),
                    type: overwrite.type
                }));
            }
            
            // Füge Owner-Permissions hinzu
            const ownerPermissionIndex = basePermissions.findIndex(perm => perm.id === member.id);
            const ownerPermissions = {
                id: member.id,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.Connect,
                    PermissionsBitField.Flags.ManageChannels, 
                    PermissionsBitField.Flags.MuteMembers, 
                    PermissionsBitField.Flags.DeafenMembers,
                    PermissionsBitField.Flags.MoveMembers
                ],
                deny: [],
                type: 1
            };
            
            if (ownerPermissionIndex >= 0) {
                basePermissions[ownerPermissionIndex] = ownerPermissions;
            } else {
                basePermissions.push(ownerPermissions);
            }

            // Erstelle Voice Channel
            const voiceChannel = await guild.channels.create({
                name: `${member.displayName}'s Channel`,
                type: ChannelType.GuildVoice,
                parent: category,
                userLimit: maxUsers,
                permissionOverwrites: basePermissions
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
                            PermissionsBitField.Flags.ManageMessages,
                            PermissionsBitField.Flags.EmbedLinks,
                            PermissionsBitField.Flags.AttachFiles,
                            PermissionsBitField.Flags.ReadMessageHistory
                        ],
                        deny: [],
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
                guildId: guild.id,
                activityLog: []
            };

            await this.setTempChannel(guild.id, voiceChannel.id, tempChannelData);

            // Move User zu seinem Channel
            if (member.voice.channel) {
                await member.voice.setChannel(voiceChannel);
            }

            // Sende Info-Nachricht
            await this.sendChannelInfo(textChannel, tempChannelData, member);

            Logger.info(`✅ Temp-Channel erstellt: ${voiceChannel.name} (${voiceChannel.id})`);
            return { voiceChannel, textChannel };
        } catch (error) {
            Logger.error('Fehler beim Erstellen des Temp-Channels', error);
            throw error;
        }
    }

    private async sendChannelInfo(textChannel: TextChannel, channelData: TempChannelData, owner: GuildMember): Promise<void> {
        const embed = new EmbedBuilder()
            .setTitle('🎤 Dein temporärer Voice-Channel')
            .setDescription(`Willkommen in deinem persönlichen Voice-Channel, ${owner}!`)
            .setColor(0x00ff00)
            .addFields(
                { name: '👑 Besitzer', value: `<@${channelData.ownerId}>`, inline: true },
                { name: '👥 Max. Nutzer', value: `${channelData.maxUsers === 0 ? 'Unbegrenzt' : channelData.maxUsers}`, inline: true },
                { name: '👁️ Sichtbar', value: channelData.isVisible ? 'Ja' : 'Nein', inline: true },
                { name: '🔒 Status', value: channelData.isLocked ? 'Gesperrt' : 'Offen', inline: true },
                { name: '⏰ Erstellt', value: `<t:${Math.floor(channelData.createdAt.getTime() / 1000)}:R>`, inline: true },
                { name: '🗑️ Auto-Löschung', value: 'Wird automatisch gelöscht wenn leer', inline: true },
                {
                    name: '🛠️ Verfügbare Commands',
                    value: `/byvoicesetowner - Besitzer ändern\n` +
                           `/byvoicesetlimit - Nutzer-Limit setzen\n` +
                           `/byvoicesetvisible - Sichtbarkeit ändern\n` +
                           `/byvoicelock - Channel sperren/entsperren\n` +
                           `/byvoiceclaim - Channel beanspruchen\n` +
                           `/byvoicesetname - Channel-Name ändern\n` +
                           `/byvoicekick - Nutzer kicken\n` +
                           `/byvoiceban - Nutzer bannen\n` +
                           `/byvoiceunban - Nutzer entbannen\n` +
                           `/byvoicestatus - Channel-Status anzeigen`,
                    inline: false
                }
            )
            .setFooter({ text: `Temp-Voice System • ${this.usingMongoDB ? 'MongoDB' : 'Memory'} • Automatische Löschung bei Leere` })
            .setTimestamp();

        await textChannel.send({ embeds: [embed] });
    }

    // Voice State Update Handler - HAUPTLOGIK
    public async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState, client: Client): Promise<void> {
        const guild = newState.guild || oldState.guild;

        // 1. User joined a CREATOR channel → Create temp channel
        if (newState.channel && await this.isCreatorChannel(guild.id, newState.channel.id)) {
            try {
                Logger.info(`👤 ${newState.member?.displayName} joined creator channel ${newState.channel.name}`);
                await this.createTempChannel(guild, newState.member!, newState.channel as VoiceChannel);
            } catch (error) {
                Logger.error('Fehler beim Erstellen des Temp-Channels', error);
            }
            return;
        }

        // 2. User joined a TEMP channel → Give permissions
        if (newState.channel) {
            const tempChannelData = this.getTempChannel(guild.id, newState.channel.id);
            if (tempChannelData) {
                // Check if user is banned
                if (tempChannelData.bannedUsers.includes(newState.member!.id)) {
                    try {
                        Logger.info(`🚫 Gebannter User ${newState.member?.displayName} versucht beizutreten - wird gekickt`);
                        await newState.member!.voice.disconnect();
                        return;
                    } catch (error) {
                        Logger.error('Fehler beim Kicken des gebannten Users', error);
                    }
                }

                // Check if channel is locked
                if (tempChannelData.isLocked && tempChannelData.ownerId !== newState.member!.id) {
                    try {
                        Logger.info(`🔒 ${newState.member?.displayName} versucht gesperrten Channel zu betreten - wird gekickt`);
                        await newState.member!.voice.disconnect();
                        return;
                    } catch (error) {
                        Logger.error('Fehler beim Kicken wegen gesperrtem Channel', error);
                    }
                }

                // Give access to text channel
                const textChannel = guild.channels.cache.get(tempChannelData.textChannelId) as TextChannel;
                if (textChannel) {
                    try {
                        await textChannel.permissionOverwrites.create(newState.member!, {
                            ViewChannel: true,
                            SendMessages: true,
                            ReadMessageHistory: true,
                            EmbedLinks: true,
                            AttachFiles: true
                        });
                        Logger.info(`✅ ${newState.member?.displayName} hat Zugang zu Text-Channel erhalten`);
                    } catch (error) {
                        Logger.error('Fehler beim Gewähren von Text-Channel Zugang', error);
                    }
                }

                await this.updateTempChannelActivity(guild.id, newState.channel.id, 'user_joined', newState.member!.id);
            }
        }

        // 3. User left a TEMP channel → Remove permissions & check if empty
        if (oldState.channel) {
            const tempChannelData = this.getTempChannel(guild.id, oldState.channel.id);
            if (tempChannelData) {
                // Remove access from text channel
                const textChannel = guild.channels.cache.get(tempChannelData.textChannelId) as TextChannel;
                if (textChannel) {
                    try {
                        await textChannel.permissionOverwrites.delete(oldState.member!);
                        Logger.info(`❌ ${oldState.member?.displayName} Text-Channel Zugang entfernt`);
                    } catch (error) {
                        Logger.error('Fehler beim Entfernen von Text-Channel Zugang', error);
                    }
                }

                await this.updateTempChannelActivity(guild.id, oldState.channel.id, 'user_left', oldState.member!.id);

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

            await this.deleteTempChannel(guild.id, voiceChannelId);
            Logger.info(`✅ Temp-Channel komplett gelöscht: ${voiceChannelId}`);
        } catch (error) {
            Logger.error('Fehler beim Löschen des Temp-Channels', error);
        }
    }
}