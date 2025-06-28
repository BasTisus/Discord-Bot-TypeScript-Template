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
    User,
    Collection
} from 'discord.js';
import { Logger } from '../../services/index.js';
import { createRequire } from 'node:module';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);

// MongoDB Support (optional)
let MongoClient: any = null;
let mongoEnabled = false;

try {
    const mongodb = require('mongodb');
    MongoClient = mongodb.MongoClient;
    mongoEnabled = true;
    Logger.info('✅ MongoDB Support aktiviert');
} catch (error) {
    Logger.warn('⚠️ MongoDB nicht verfügbar - läuft im Memory-Modus');
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
        metadata?: any;
    }>;
}

interface GuildConfig {
    guildId: string;
    creatorChannels: string[];
    defaultMaxUsers: number;
    cleanupInterval: number;
    autoDeleteText: boolean;
    logChannelId?: string;
    logActions: boolean;
    collectStats: boolean;
    createdAt?: Date;
    updatedAt?: Date;
    settings: {
        allowUserLimit: boolean;
        allowRename: boolean;
        allowVisibilityToggle: boolean;
        allowLocking: boolean;
        maxBannedUsers: number;
        maxChannelLifetime: number;
    };
}

interface ChannelStats {
    totalChannels: number;
    activeChannels: number;
    channelsCreatedToday: number;
    avgChannelLifetime: number;
    avgUsersPerChannel: number;
    totalBans: number;
    totalKicks: number;
    totalClaims: number;
    lastCleanup: Date;
}

interface CleanupResult {
    deletedChannels: number;
    cleanedRecords: number;
    orphanedChannels: number;
    emptyChannels: number;
    errorChannels: number;
    processingTime: number;
}

export class TempVoiceModule extends EventEmitter {
    public description = 'Temporäre Voice-Kanäle mit anpassbaren Einstellungen und MongoDB-Support';
    public version = '2.1.0';
    
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
    
    // Performance & Cleanup
    private cleanupInterval: NodeJS.Timeout | null = null;
    private discordClient: Client | null = null;
    private isInitialized = false;
    
    // Rate Limiting
    private userCooldowns = new Map<string, number>();
    private rateLimitWindow = 60000; // 1 minute
    private maxActionsPerWindow = 5;
    
    constructor(connectionString?: string, databaseName?: string) {
        super();
        this.mongoUri = connectionString || process.env.MONGODB_URI || 'mongodb://localhost:27017';
        this.dbName = databaseName || process.env.MONGODB_DB_NAME || 'borety_bot';
        
        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        this.on('error', (error) => {
            Logger.error('TempVoice Module Error:', error);
        });

        this.on('channelCreated', (data) => {
            Logger.info(`📢 Temp-Channel erstellt: ${data.channelName} von ${data.ownerName}`);
        });

        this.on('channelDeleted', (data) => {
            Logger.info(`🗑️ Temp-Channel gelöscht: ${data.channelName}`);
        });
    }

    // Initialize the module
    public async initialize(client: Client): Promise<void> {
        if (this.isInitialized) {
            Logger.warn('TempVoice Module bereits initialisiert');
            return;
        }

        try {
            this.discordClient = client;
            await this.initStorage();
            this.setupVoiceStateListener(client);
            this.startCleanupInterval();
            
            this.isInitialized = true;
            Logger.info('✅ TempVoice Module erfolgreich initialisiert');
        } catch (error) {
            Logger.error('❌ Fehler bei TempVoice Module Initialisierung:', error);
            throw error;
        }
    }

    private async initStorage(): Promise<void> {
        if (mongoEnabled) {
            try {
                await this.initMongoDB();
                Logger.info('✅ TempVoice: MongoDB-Verbindung hergestellt');
            } catch (error) {
                Logger.warn('⚠️ MongoDB-Initialisierung fehlgeschlagen, verwende Memory-Modus:', error);
                this.initMemoryMode();
            }
        } else {
            this.initMemoryMode();
        }
    }

    private async initMongoDB(): Promise<void> {
        if (!MongoClient) {
            throw new Error('MongoDB Client nicht verfügbar');
        }

        try {
            this.mongoClient = new MongoClient(this.mongoUri, {
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
            });

            await this.mongoClient.connect();
            await this.mongoClient.db('admin').command({ ping: 1 });
            
            this.db = this.mongoClient.db(this.dbName);
            this.configCollection = this.db.collection(this.configCollectionName);
            this.tempChannelsCollection = this.db.collection(this.tempChannelsCollectionName);
            
            // Create indexes for better performance
            await this.createIndexes();
            
            // Load existing temp channels from DB
            await this.loadTempChannelsFromDB();
            
            this.usingMongoDB = true;
            Logger.info('✅ TempVoice: MongoDB erfolgreich konfiguriert');
        } catch (error) {
            Logger.error('❌ TempVoice: MongoDB-Verbindungsfehler:', error);
            throw error;
        }
    }

    private async createIndexes(): Promise<void> {
        if (!this.configCollection || !this.tempChannelsCollection) return;

        try {
            // Guild Config indexes
            await this.configCollection.createIndex({ guildId: 1 }, { unique: true });
            
            // Temp Channels indexes
            await this.tempChannelsCollection.createIndex({ guildId: 1, voiceChannelId: 1 }, { unique: true });
            await this.tempChannelsCollection.createIndex({ guildId: 1 });
            await this.tempChannelsCollection.createIndex({ ownerId: 1 });
            await this.tempChannelsCollection.createIndex({ createdAt: 1 });
            
            // TTL Index for automatic cleanup (24 hours)
            await this.tempChannelsCollection.createIndex(
                { createdAt: 1 }, 
                { expireAfterSeconds: 86400 }
            );
            
            Logger.info('✅ TempVoice: MongoDB-Indizes erstellt');
        } catch (error) {
            Logger.error('❌ TempVoice: Fehler beim Erstellen der Indizes:', error);
        }
    }

    private initMemoryMode(): void {
        this.usingMongoDB = false;
        Logger.info('✅ TempVoice: Memory-Modus aktiviert (ohne MongoDB)');
    }

    private async loadTempChannelsFromDB(): Promise<void> {
        if (!this.usingMongoDB || !this.tempChannelsCollection) return;
        
        try {
            const tempChannels = await this.tempChannelsCollection.find({}).toArray();
            
            for (const channelData of tempChannels) {
                const guildId = channelData.guildId;
                const voiceChannelId = channelData.voiceChannelId;
                
                if (!this.tempChannels.has(guildId)) {
                    this.tempChannels.set(guildId, new Map());
                }
                
                this.tempChannels.get(guildId)!.set(voiceChannelId, {
                    voiceChannelId: channelData.voiceChannelId,
                    textChannelId: channelData.textChannelId,
                    ownerId: channelData.ownerId,
                    ownerName: channelData.ownerName,
                    maxUsers: channelData.maxUsers,
                    isVisible: channelData.isVisible,
                    isLocked: channelData.isLocked,
                    bannedUsers: channelData.bannedUsers || [],
                    createdAt: channelData.createdAt,
                    guildId: channelData.guildId,
                    lastActivity: channelData.lastActivity,
                    activityLog: channelData.activityLog || []
                });
            }
            
            Logger.info(`✅ TempVoice: ${tempChannels.length} Temp-Channels aus DB geladen`);
        } catch (error) {
            Logger.error('❌ TempVoice: Fehler beim Laden der Channels aus DB:', error);
        }
    }

    private setupVoiceStateListener(client: Client): void {
        client.on('voiceStateUpdate', async (oldState: VoiceState, newState: VoiceState) => {
            try {
                await this.handleVoiceStateUpdate(oldState, newState);
            } catch (error) {
                Logger.error('Fehler beim Voice State Update:', error);
                this.emit('error', error);
            }
        });
    }

    private async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
        const guild = newState.guild || oldState.guild;
        const member = newState.member || oldState.member;
        
        if (!guild || !member || member.user.bot) return;

        // User joined a channel
        if (!oldState.channel && newState.channel) {
            await this.handleUserJoinedChannel(newState.channel, member);
        }
        
        // User left a channel
        if (oldState.channel && !newState.channel) {
            await this.handleUserLeftChannel(oldState.channel, member);
        }
        
        // User moved between channels
        if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
            await this.handleUserLeftChannel(oldState.channel, member);
            await this.handleUserJoinedChannel(newState.channel, member);
        }
    }

    private async handleUserJoinedChannel(channel: VoiceChannel, member: GuildMember): Promise<void> {
        const config = await this.getGuildConfig(channel.guild.id);
        
        // Check if this is a creator channel
        if (config.creatorChannels.includes(channel.id)) {
            await this.createTempChannel(channel.guild, member, channel, config);
            return;
        }

        // Update activity for existing temp channels
        const tempChannelData = this.getTempChannelData(channel.guild.id, channel.id);
        if (tempChannelData) {
            await this.updateChannelActivity(channel.guild.id, channel.id, {
                activity: 'user_joined',
                userId: member.id,
                timestamp: new Date()
            });
        }
    }

    private async handleUserLeftChannel(channel: VoiceChannel, member: GuildMember): Promise<void> {
        const tempChannelData = this.getTempChannelData(channel.guild.id, channel.id);
        if (!tempChannelData) return;

        // Update activity
        await this.updateChannelActivity(channel.guild.id, channel.id, {
            activity: 'user_left',
            userId: member.id,
            timestamp: new Date()
        });

        // Check if channel should be deleted (empty)
        if (channel.members.size === 0) {
            setTimeout(async () => {
                // Double check after delay
                const channelCheck = channel.guild.channels.cache.get(channel.id) as VoiceChannel;
                if (channelCheck && channelCheck.members.size === 0) {
                    await this.deleteTempChannel(channel.guild.id, channel.id, 'auto_cleanup_empty');
                }
            }, 5000); // 5 second delay to handle quick rejoins
        }
    }

    // Guild Configuration Methods
    public async getGuildConfig(guildId: string): Promise<GuildConfig> {
        // Try memory first
        if (this.guildConfigs.has(guildId)) {
            return this.guildConfigs.get(guildId)!;
        }

        // Try MongoDB
        if (this.usingMongoDB && this.configCollection) {
            try {
                const dbConfig = await this.configCollection.findOne({ guildId });
                if (dbConfig) {
                    const config: GuildConfig = {
                        guildId: dbConfig.guildId,
                        creatorChannels: dbConfig.creatorChannels || [],
                        defaultMaxUsers: dbConfig.defaultMaxUsers || 0,
                        cleanupInterval: dbConfig.cleanupInterval || 300,
                        autoDeleteText: dbConfig.autoDeleteText || false,
                        logChannelId: dbConfig.logChannelId,
                        logActions: dbConfig.logActions || false,
                        collectStats: dbConfig.collectStats || true,
                        createdAt: dbConfig.createdAt,
                        updatedAt: dbConfig.updatedAt,
                        settings: dbConfig.settings || {
                            allowUserLimit: true,
                            allowRename: true,
                            allowVisibilityToggle: true,
                            allowLocking: true,
                            maxBannedUsers: 10,
                            maxChannelLifetime: 86400000 // 24 hours
                        }
                    };
                    
                    this.guildConfigs.set(guildId, config);
                    return config;
                }
            } catch (error) {
                Logger.error('Fehler beim Laden der Guild-Config aus MongoDB:', error);
            }
        }

        // Return default config
        const defaultConfig: GuildConfig = {
            guildId,
            creatorChannels: [],
            defaultMaxUsers: 0,
            cleanupInterval: 300,
            autoDeleteText: false,
            logActions: false,
            collectStats: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            settings: {
                allowUserLimit: true,
                allowRename: true,
                allowVisibilityToggle: true,
                allowLocking: true,
                maxBannedUsers: 10,
                maxChannelLifetime: 86400000
            }
        };

        this.guildConfigs.set(guildId, defaultConfig);
        await this.saveGuildConfig(defaultConfig);
        
        return defaultConfig;
    }

    public async saveGuildConfig(config: GuildConfig): Promise<void> {
        try {
            config.updatedAt = new Date();
            this.guildConfigs.set(config.guildId, config);

            if (this.usingMongoDB && this.configCollection) {
                await this.configCollection.replaceOne(
                    { guildId: config.guildId },
                    config,
                    { upsert: true }
                );
            }
        } catch (error) {
            Logger.error('Fehler beim Speichern der Guild-Config:', error);
            throw error;
        }
    }

    // Temp Channel Management Methods
    public async createTempChannel(
        guild: Guild, 
        member: GuildMember, 
        creatorChannel: VoiceChannel,
        config: GuildConfig
    ): Promise<{ voiceChannel: VoiceChannel; textChannel: TextChannel } | null> {
        try {
            // Rate limiting check
            if (!this.checkRateLimit(member.id)) {
                return null;
            }

            const channelName = `${member.displayName}'s Channel`;
            
            // Create voice channel
            const voiceChannel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildVoice,
                parent: creatorChannel.parent,
                userLimit: config.defaultMaxUsers,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
                    },
                    {
                        id: member.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.Connect,
                            PermissionFlagsBits.Speak,
                            PermissionFlagsBits.ManageChannels,
                            PermissionFlagsBits.MoveMembers
                        ],
                    }
                ],
            });

            // Create text channel if configured
            let textChannel: TextChannel | null = null;
            if (config.autoDeleteText) {
                textChannel = await guild.channels.create({
                    name: `${member.displayName}-chat`,
                    type: ChannelType.GuildText,
                    parent: creatorChannel.parent,
                    permissionOverwrites: [
                        {
                            id: guild.roles.everyone.id,
                            deny: [PermissionFlagsBits.ViewChannel],
                        },
                        {
                            id: member.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory,
                                PermissionFlagsBits.ManageChannels
                            ],
                        }
                    ],
                });
            }

            // Store channel data
            const tempChannelData: TempChannelData = {
                voiceChannelId: voiceChannel.id,
                textChannelId: textChannel?.id || '',
                ownerId: member.id,
                ownerName: member.displayName,
                maxUsers: config.defaultMaxUsers,
                isVisible: true,
                isLocked: false,
                bannedUsers: [],
                createdAt: new Date(),
                guildId: guild.id,
                lastActivity: new Date(),
                activityLog: [{
                    activity: 'channel_created',
                    userId: member.id,
                    timestamp: new Date(),
                    metadata: { channelName }
                }]
            };

            await this.saveTempChannelData(tempChannelData);

            // Move member to new channel
            try {
                await member.voice.setChannel(voiceChannel);
            } catch (error) {
                Logger.warn('Konnte Member nicht in neuen Channel verschieben:', error);
            }

            this.emit('channelCreated', {
                channelId: voiceChannel.id,
                channelName,
                ownerId: member.id,
                ownerName: member.displayName,
                guildId: guild.id
            });

            return { voiceChannel, textChannel: textChannel! };
        } catch (error) {
            Logger.error('Fehler beim Erstellen des Temp-Channels:', error);
            this.emit('error', error);
            return null;
        }
    }
private checkRateLimit(userId: string): boolean {
        const now = Date.now();
        const userActions = this.userCooldowns.get(userId) || 0;
        
        if (now - userActions < this.rateLimitWindow) {
            return false;
        }
        
        this.userCooldowns.set(userId, now);
        return true;
    }

    public async deleteTempChannel(guildId: string, voiceChannelId: string, reason: string = 'manual'): Promise<boolean> {
        try {
            const tempChannelData = this.getTempChannelData(guildId, voiceChannelId);
            if (!tempChannelData) {
                Logger.warn(`Temp-Channel ${voiceChannelId} nicht gefunden für Löschung`);
                return false;
            }

            const guild = this.discordClient?.guilds.cache.get(guildId);
            if (!guild) {
                Logger.warn(`Guild ${guildId} nicht gefunden für Channel-Löschung`);
                return false;
            }

            // Delete voice channel
            const voiceChannel = guild.channels.cache.get(voiceChannelId);
            if (voiceChannel) {
                await voiceChannel.delete(`TempVoice: ${reason}`);
            }

            // Delete text channel if exists
            if (tempChannelData.textChannelId) {
                const textChannel = guild.channels.cache.get(tempChannelData.textChannelId);
                if (textChannel) {
                    await textChannel.delete(`TempVoice: ${reason}`);
                }
            }

            // Remove from storage
            await this.removeTempChannelData(guildId, voiceChannelId);

            this.emit('channelDeleted', {
                channelId: voiceChannelId,
                channelName: `${tempChannelData.ownerName}'s Channel`,
                reason,
                guildId
            });

            return true;
        } catch (error) {
            Logger.error('Fehler beim Löschen des Temp-Channels:', error);
            this.emit('error', error);
            return false;
        }
    }

    // Data Management Methods
    public getTempChannelData(guildId: string, voiceChannelId: string): TempChannelData | null {
        const guildChannels = this.tempChannels.get(guildId);
        if (!guildChannels) return null;
        
        return guildChannels.get(voiceChannelId) || null;
    }

    public async saveTempChannelData(data: TempChannelData): Promise<void> {
        try {
            // Save to memory
            if (!this.tempChannels.has(data.guildId)) {
                this.tempChannels.set(data.guildId, new Map());
            }
            this.tempChannels.get(data.guildId)!.set(data.voiceChannelId, data);

            // Save to MongoDB if available
            if (this.usingMongoDB && this.tempChannelsCollection) {
                await this.tempChannelsCollection.replaceOne(
                    { guildId: data.guildId, voiceChannelId: data.voiceChannelId },
                    data,
                    { upsert: true }
                );
            }
        } catch (error) {
            Logger.error('Fehler beim Speichern der Temp-Channel-Daten:', error);
            throw error;
        }
    }

    public async removeTempChannelData(guildId: string, voiceChannelId: string): Promise<void> {
        try {
            // Remove from memory
            const guildChannels = this.tempChannels.get(guildId);
            if (guildChannels) {
                guildChannels.delete(voiceChannelId);
                if (guildChannels.size === 0) {
                    this.tempChannels.delete(guildId);
                }
            }

            // Remove from MongoDB if available
            if (this.usingMongoDB && this.tempChannelsCollection) {
                await this.tempChannelsCollection.deleteOne({
                    guildId,
                    voiceChannelId
                });
            }
        } catch (error) {
            Logger.error('Fehler beim Entfernen der Temp-Channel-Daten:', error);
            throw error;
        }
    }

    public async updateChannelActivity(guildId: string, voiceChannelId: string, activity: any): Promise<void> {
        try {
            const tempChannelData = this.getTempChannelData(guildId, voiceChannelId);
            if (!tempChannelData) return;

            tempChannelData.lastActivity = new Date();
            
            if (!tempChannelData.activityLog) {
                tempChannelData.activityLog = [];
            }
            
            tempChannelData.activityLog.push(activity);
            
            // Keep only last 50 activities to prevent memory bloat
            if (tempChannelData.activityLog.length > 50) {
                tempChannelData.activityLog = tempChannelData.activityLog.slice(-50);
            }

            await this.saveTempChannelData(tempChannelData);
        } catch (error) {
            Logger.error('Fehler beim Aktualisieren der Channel-Aktivität:', error);
        }
    }

    // Channel Modification Methods
    public async setChannelOwner(guildId: string, voiceChannelId: string, newOwnerId: string, newOwnerName: string): Promise<boolean> {
        try {
            const tempChannelData = this.getTempChannelData(guildId, voiceChannelId);
            if (!tempChannelData) return false;

            const guild = this.discordClient?.guilds.cache.get(guildId);
            if (!guild) return false;

            const voiceChannel = guild.channels.cache.get(voiceChannelId) as VoiceChannel;
            const textChannel = tempChannelData.textChannelId ? guild.channels.cache.get(tempChannelData.textChannelId) as TextChannel : null;

            if (!voiceChannel) return false;

            // Update permissions
            await voiceChannel.permissionOverwrites.edit(tempChannelData.ownerId, {
                ManageChannels: null,
                MoveMembers: null
            });

            await voiceChannel.permissionOverwrites.edit(newOwnerId, {
                ViewChannel: true,
                Connect: true,
                Speak: true,
                ManageChannels: true,
                MoveMembers: true
            });

            if (textChannel) {
                await textChannel.permissionOverwrites.edit(tempChannelData.ownerId, {
                    ManageChannels: null
                });

                await textChannel.permissionOverwrites.edit(newOwnerId, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true,
                    ManageChannels: true
                });
            }

            // Update data
            tempChannelData.ownerId = newOwnerId;
            tempChannelData.ownerName = newOwnerName;
            
            await this.updateChannelActivity(guildId, voiceChannelId, {
                activity: 'owner_changed',
                userId: newOwnerId,
                timestamp: new Date(),
                metadata: { previousOwner: tempChannelData.ownerId, newOwner: newOwnerId }
            });

            await this.saveTempChannelData(tempChannelData);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Setzen des Channel-Owners:', error);
            return false;
        }
    }

    public async setChannelLimit(guildId: string, voiceChannelId: string, limit: number): Promise<boolean> {
        try {
            const tempChannelData = this.getTempChannelData(guildId, voiceChannelId);
            if (!tempChannelData) return false;

            const guild = this.discordClient?.guilds.cache.get(guildId);
            if (!guild) return false;

            const voiceChannel = guild.channels.cache.get(voiceChannelId) as VoiceChannel;
            if (!voiceChannel) return false;

            await voiceChannel.setUserLimit(limit);
            tempChannelData.maxUsers = limit;

            await this.updateChannelActivity(guildId, voiceChannelId, {
                activity: 'limit_changed',
                userId: tempChannelData.ownerId,
                timestamp: new Date(),
                metadata: { newLimit: limit }
            });

            await this.saveTempChannelData(tempChannelData);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Setzen des Channel-Limits:', error);
            return false;
        }
    }

    public async renameChannel(guildId: string, voiceChannelId: string, newName: string): Promise<boolean> {
        try {
            const tempChannelData = this.getTempChannelData(guildId, voiceChannelId);
            if (!tempChannelData) return false;

            const guild = this.discordClient?.guilds.cache.get(guildId);
            if (!guild) return false;

            const voiceChannel = guild.channels.cache.get(voiceChannelId) as VoiceChannel;
            if (!voiceChannel) return false;

            const sanitizedName = newName.substring(0, 100); // Discord limit
            await voiceChannel.setName(sanitizedName);

            if (tempChannelData.textChannelId) {
                const textChannel = guild.channels.cache.get(tempChannelData.textChannelId) as TextChannel;
                if (textChannel) {
                    await textChannel.setName(`${sanitizedName}-chat`);
                }
            }

            await this.updateChannelActivity(guildId, voiceChannelId, {
                activity: 'channel_renamed',
                userId: tempChannelData.ownerId,
                timestamp: new Date(),
                metadata: { newName: sanitizedName }
            });

            await this.saveTempChannelData(tempChannelData);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Umbenennen des Channels:', error);
            return false;
        }
    }

    public async setChannelVisibility(guildId: string, voiceChannelId: string, isVisible: boolean): Promise<boolean> {
        try {
            const tempChannelData = this.getTempChannelData(guildId, voiceChannelId);
            if (!tempChannelData) return false;

            const guild = this.discordClient?.guilds.cache.get(guildId);
            if (!guild) return false;

            const voiceChannel = guild.channels.cache.get(voiceChannelId) as VoiceChannel;
            if (!voiceChannel) return false;

            await voiceChannel.permissionOverwrites.edit(guild.roles.everyone.id, {
                ViewChannel: isVisible
            });

            if (tempChannelData.textChannelId) {
                const textChannel = guild.channels.cache.get(tempChannelData.textChannelId) as TextChannel;
                if (textChannel) {
                    await textChannel.permissionOverwrites.edit(guild.roles.everyone.id, {
                        ViewChannel: isVisible
                    });
                }
            }

            tempChannelData.isVisible = isVisible;

            await this.updateChannelActivity(guildId, voiceChannelId, {
                activity: isVisible ? 'channel_shown' : 'channel_hidden',
                userId: tempChannelData.ownerId,
                timestamp: new Date()
            });

            await this.saveTempChannelData(tempChannelData);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Setzen der Channel-Sichtbarkeit:', error);
            return false;
        }
    }

    public async setChannelLock(guildId: string, voiceChannelId: string, isLocked: boolean): Promise<boolean> {
        try {
            const tempChannelData = this.getTempChannelData(guildId, voiceChannelId);
            if (!tempChannelData) return false;

            const guild = this.discordClient?.guilds.cache.get(guildId);
            if (!guild) return false;

            const voiceChannel = guild.channels.cache.get(voiceChannelId) as VoiceChannel;
            if (!voiceChannel) return false;

            await voiceChannel.permissionOverwrites.edit(guild.roles.everyone.id, {
                Connect: !isLocked
            });

            tempChannelData.isLocked = isLocked;

            await this.updateChannelActivity(guildId, voiceChannelId, {
                activity: isLocked ? 'channel_locked' : 'channel_unlocked',
                userId: tempChannelData.ownerId,
                timestamp: new Date()
            });

            await this.saveTempChannelData(tempChannelData);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Setzen des Channel-Locks:', error);
            return false;
        }
    }

    // User Management Methods
    public async banUserFromChannel(guildId: string, voiceChannelId: string, userId: string, reason?: string): Promise<boolean> {
        try {
            const tempChannelData = this.getTempChannelData(guildId, voiceChannelId);
            if (!tempChannelData) return false;

            const guild = this.discordClient?.guilds.cache.get(guildId);
            if (!guild) return false;

            const voiceChannel = guild.channels.cache.get(voiceChannelId) as VoiceChannel;
            if (!voiceChannel) return false;

            // Add to banned users
            if (!tempChannelData.bannedUsers.includes(userId)) {
                tempChannelData.bannedUsers.push(userId);
            }

            // Set channel permissions to deny access
            await voiceChannel.permissionOverwrites.edit(userId, {
                ViewChannel: false,
                Connect: false
            });

            if (tempChannelData.textChannelId) {
                const textChannel = guild.channels.cache.get(tempChannelData.textChannelId) as TextChannel;
                if (textChannel) {
                    await textChannel.permissionOverwrites.edit(userId, {
                        ViewChannel: false,
                        SendMessages: false
                    });
                }
            }

            // Disconnect user if currently in channel
            const member = guild.members.cache.get(userId);
            if (member?.voice.channelId === voiceChannelId) {
                await member.voice.disconnect(`TempVoice Ban: ${reason || 'No reason provided'}`);
            }

            await this.updateChannelActivity(guildId, voiceChannelId, {
                activity: 'user_banned',
                userId: tempChannelData.ownerId,
                timestamp: new Date(),
                metadata: { bannedUserId: userId, reason }
            });

            await this.saveTempChannelData(tempChannelData);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Bannen des Users:', error);
            return false;
        }
    }

    public async unbanUserFromChannel(guildId: string, voiceChannelId: string, userId: string): Promise<boolean> {
        try {
            const tempChannelData = this.getTempChannelData(guildId, voiceChannelId);
            if (!tempChannelData) return false;

            const guild = this.discordClient?.guilds.cache.get(guildId);
            if (!guild) return false;

            const voiceChannel = guild.channels.cache.get(voiceChannelId) as VoiceChannel;
            if (!voiceChannel) return false;

            // Remove from banned users
            tempChannelData.bannedUsers = tempChannelData.bannedUsers.filter(id => id !== userId);

            // Reset channel permissions
            await voiceChannel.permissionOverwrites.delete(userId);

            if (tempChannelData.textChannelId) {
                const textChannel = guild.channels.cache.get(tempChannelData.textChannelId) as TextChannel;
                if (textChannel) {
                    await textChannel.permissionOverwrites.delete(userId);
                }
            }

            await this.updateChannelActivity(guildId, voiceChannelId, {
                activity: 'user_unbanned',
                userId: tempChannelData.ownerId,
                timestamp: new Date(),
                metadata: { unbannedUserId: userId }
            });

            await this.saveTempChannelData(tempChannelData);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Entbannen des Users:', error);
            return false;
        }
    }

    public async kickUserFromChannel(guildId: string, voiceChannelId: string, userId: string, reason?: string): Promise<boolean> {
        try {
            const tempChannelData = this.getTempChannelData(guildId, voiceChannelId);
            if (!tempChannelData) return false;

            const guild = this.discordClient?.guilds.cache.get(guildId);
            if (!guild) return false;

            const member = guild.members.cache.get(userId);
            if (!member || member.voice.channelId !== voiceChannelId) {
                return false;
            }

            await member.voice.disconnect(`TempVoice Kick: ${reason || 'No reason provided'}`);

            await this.updateChannelActivity(guildId, voiceChannelId, {
                activity: 'user_kicked',
                userId: tempChannelData.ownerId,
                timestamp: new Date(),
                metadata: { kickedUserId: userId, reason }
            });

            await this.saveTempChannelData(tempChannelData);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Kicken des Users:', error);
            return false;
        }
    }

    // Statistics and Info Methods
    public async getChannelStats(guildId?: string): Promise<ChannelStats> {
        try {
            let totalChannels = 0;
            let activeChannels = 0;
            let channelsCreatedToday = 0;
            let totalLifetime = 0;
            let totalUsers = 0;
            let userCount = 0;
            let totalBans = 0;
            let totalKicks = 0;
            let totalClaims = 0;

            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            const processGuildChannels = (guildChannels: Map<string, TempChannelData>) => {
                for (const [channelId, data] of guildChannels) {
                    totalChannels++;
                    
                    if (this.discordClient) {
                        const guild = this.discordClient.guilds.cache.get(data.guildId);
                        const channel = guild?.channels.cache.get(channelId) as VoiceChannel;
                        if (channel && channel.members.size > 0) {
                            activeChannels++;
                            totalUsers += channel.members.size;
                            userCount++;
                        }
                    }

                    if (data.createdAt >= todayStart) {
                        channelsCreatedToday++;
                    }

                    const lifetime = now.getTime() - data.createdAt.getTime();
                    totalLifetime += lifetime;

                    // Count activities
                    if (data.activityLog) {
                        totalBans += data.activityLog.filter(log => log.activity === 'user_banned').length;
                        totalKicks += data.activityLog.filter(log => log.activity === 'user_kicked').length;
                        totalClaims += data.activityLog.filter(log => log.activity === 'owner_changed').length;
                    }
                }
            };

            if (guildId) {
                const guildChannels = this.tempChannels.get(guildId);
                if (guildChannels) {
                    processGuildChannels(guildChannels);
                }
            } else {
                for (const [, guildChannels] of this.tempChannels) {
                    processGuildChannels(guildChannels);
                }
            }

            return {
                totalChannels,
                activeChannels,
                channelsCreatedToday,
                avgChannelLifetime: totalChannels > 0 ? totalLifetime / totalChannels : 0,
                avgUsersPerChannel: userCount > 0 ? totalUsers / userCount : 0,
                totalBans,
                totalKicks,
                totalClaims,
                lastCleanup: this.getLastCleanupTime()
            };
        } catch (error) {
            Logger.error('Fehler beim Abrufen der Channel-Statistiken:', error);
            return {
                totalChannels: 0,
                activeChannels: 0,
                channelsCreatedToday: 0,
                avgChannelLifetime: 0,
                avgUsersPerChannel: 0,
                totalBans: 0,
                totalKicks: 0,
                totalClaims: 0,
                lastCleanup: new Date()
            };
        }
    }

    public getActiveChannelsForGuild(guildId: string): TempChannelData[] {
        const guildChannels = this.tempChannels.get(guildId);
        if (!guildChannels) return [];

        return Array.from(guildChannels.values());
    }

    public getChannelsByOwner(guildId: string, ownerId: string): TempChannelData[] {
        const guildChannels = this.tempChannels.get(guildId);
        if (!guildChannels) return [];

        return Array.from(guildChannels.values()).filter(channel => channel.ownerId === ownerId);
    }

    // Cleanup Methods
    private startCleanupInterval(): void {
        // Run cleanup every 5 minutes
        this.cleanupInterval = setInterval(async () => {
            try {
                await this.performCleanup();
            } catch (error) {
                Logger.error('Fehler beim automatischen Cleanup:', error);
            }
        }, 5 * 60 * 1000);

        Logger.info('✅ TempVoice: Automatisches Cleanup aktiviert (alle 5 Minuten)');
    }

    public async performCleanup(guildId?: string): Promise<CleanupResult> {
        const startTime = Date.now();
        let deletedChannels = 0;
        let cleanedRecords = 0;
        let orphanedChannels = 0;
        let emptyChannels = 0;
        let errorChannels = 0;

        try {
            const guildsToProcess = guildId ? [guildId] : Array.from(this.tempChannels.keys());

            for (const processGuildId of guildsToProcess) {
                const guildChannels = this.tempChannels.get(processGuildId);
                if (!guildChannels) continue;

                const guild = this.discordClient?.guilds.cache.get(processGuildId);
                if (!guild) {
                    // Guild not found, remove all channels for this guild
                    this.tempChannels.delete(processGuildId);
                    cleanedRecords += guildChannels.size;
                    continue;
                }

                const channelsToDelete: string[] = [];

                for (const [channelId, channelData] of guildChannels) {
                    try {
                        const voiceChannel = guild.channels.cache.get(channelId) as VoiceChannel;

                        if (!voiceChannel) {
                            // Channel doesn't exist anymore
                            channelsToDelete.push(channelId);
                            orphanedChannels++;
                            continue;
                        }

                        // Check if channel is empty
                        if (voiceChannel.members.size === 0) {
                            const config = await this.getGuildConfig(processGuildId);
                            const maxLifetime = config.settings.maxChannelLifetime;
                            const channelAge = Date.now() - channelData.createdAt.getTime();

                            // Delete if older than max lifetime or empty for more than 5 minutes
                            const emptyTime = channelData.lastActivity ? Date.now() - channelData.lastActivity.getTime() : channelAge;
                            
                            if (channelAge > maxLifetime || emptyTime > 5 * 60 * 1000) {
                                await this.deleteTempChannel(processGuildId, channelId, 'auto_cleanup');
                                deletedChannels++;
                                emptyChannels++;
                            }
                        }
                    } catch (error) {
                        Logger.error(`Fehler beim Cleanup von Channel ${channelId}:`, error);
                        channelsToDelete.push(channelId);
                        errorChannels++;
                    }
                }

                // Clean up orphaned records
                for (const channelId of channelsToDelete) {
                    await this.removeTempChannelData(processGuildId, channelId);
                    cleanedRecords++;
                }
            }

            const processingTime = Date.now() - startTime;
            
            Logger.info(`🧹 TempVoice Cleanup abgeschlossen: ${deletedChannels} Channels gelöscht, ${cleanedRecords} Records bereinigt in ${processingTime}ms`);

            return {
                deletedChannels,
                cleanedRecords,
                orphanedChannels,
                emptyChannels,
                errorChannels,
                processingTime
            };
        } catch (error) {
            Logger.error('Fehler beim Cleanup:', error);
            return {
                deletedChannels: 0,
                cleanedRecords: 0,
                orphanedChannels: 0,
                emptyChannels: 0,
                errorChannels: 0,
                processingTime: Date.now() - startTime
            };
        }
    }

    private getLastCleanupTime(): Date {
        // This would be stored in config or separate collection in production
        return new Date();
    }
// Utility Methods
    public async claimChannel(guildId: string, voiceChannelId: string, newOwnerId: string): Promise<boolean> {
        try {
            const tempChannelData = this.getTempChannelData(guildId, voiceChannelId);
            if (!tempChannelData) return false;

            const guild = this.discordClient?.guilds.cache.get(guildId);
            if (!guild) return false;

            const voiceChannel = guild.channels.cache.get(voiceChannelId) as VoiceChannel;
            if (!voiceChannel) return false;

            // Check if current owner is still in the channel
            const currentOwner = guild.members.cache.get(tempChannelData.ownerId);
            if (currentOwner && currentOwner.voice.channelId === voiceChannelId) {
                return false; // Current owner is still present, can't claim
            }

            // Check if new owner is in the channel
            const newOwner = guild.members.cache.get(newOwnerId);
            if (!newOwner || newOwner.voice.channelId !== voiceChannelId) {
                return false; // New owner must be in the channel
            }

            return await this.setChannelOwner(guildId, voiceChannelId, newOwnerId, newOwner.displayName);
        } catch (error) {
            Logger.error('Fehler beim Claimen des Channels:', error);
            return false;
        }
    }

    public async resetGuildConfig(guildId: string): Promise<boolean> {
        try {
            const defaultConfig: GuildConfig = {
                guildId,
                creatorChannels: [],
                defaultMaxUsers: 0,
                cleanupInterval: 300,
                autoDeleteText: false,
                logActions: false,
                collectStats: true,
                createdAt: new Date(),
                updatedAt: new Date(),
                settings: {
                    allowUserLimit: true,
                    allowRename: true,
                    allowVisibilityToggle: true,
                    allowLocking: true,
                    maxBannedUsers: 10,
                    maxChannelLifetime: 86400000 // 24 hours
                }
            };

            await this.saveGuildConfig(defaultConfig);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Zurücksetzen der Guild-Config:', error);
            return false;
        }
    }

    public async addCreatorChannel(guildId: string, channelId: string): Promise<boolean> {
        try {
            const config = await this.getGuildConfig(guildId);
            
            if (!config.creatorChannels.includes(channelId)) {
                config.creatorChannels.push(channelId);
                await this.saveGuildConfig(config);
                return true;
            }
            
            return false; // Already exists
        } catch (error) {
            Logger.error('Fehler beim Hinzufügen des Creator-Channels:', error);
            return false;
        }
    }

    public async removeCreatorChannel(guildId: string, channelId: string): Promise<boolean> {
        try {
            const config = await this.getGuildConfig(guildId);
            
            const index = config.creatorChannels.indexOf(channelId);
            if (index > -1) {
                config.creatorChannels.splice(index, 1);
                await this.saveGuildConfig(config);
                return true;
            }
            
            return false; // Not found
        } catch (error) {
            Logger.error('Fehler beim Entfernen des Creator-Channels:', error);
            return false;
        }
    }

    public isCreatorChannel(guildId: string, channelId: string): boolean {
        const config = this.guildConfigs.get(guildId);
        return config ? config.creatorChannels.includes(channelId) : false;
    }

    public isTempChannel(guildId: string, channelId: string): boolean {
        const guildChannels = this.tempChannels.get(guildId);
        return guildChannels ? guildChannels.has(channelId) : false;
    }

    public isChannelOwner(guildId: string, channelId: string, userId: string): boolean {
        const channelData = this.getTempChannelData(guildId, channelId);
        return channelData ? channelData.ownerId === userId : false;
    }

    public isUserBanned(guildId: string, channelId: string, userId: string): boolean {
        const channelData = this.getTempChannelData(guildId, channelId);
        return channelData ? channelData.bannedUsers.includes(userId) : false;
    }

    public getUserChannelCount(guildId: string, userId: string): number {
        const guildChannels = this.tempChannels.get(guildId);
        if (!guildChannels) return 0;

        let count = 0;
        for (const [, channelData] of guildChannels) {
            if (channelData.ownerId === userId) {
                count++;
            }
        }
        return count;
    }

    // Advanced Statistics Methods
    public async getDetailedStats(guildId?: string): Promise<any> {
        try {
            const stats = await this.getChannelStats(guildId);
            
            // Additional detailed stats
            const topOwners = this.getTopChannelOwners(guildId, 10);
            const hourlyActivity = this.getHourlyActivity(guildId);
            const channelLifetimes = this.getChannelLifetimeDistribution(guildId);

            return {
                ...stats,
                topOwners,
                hourlyActivity,
                channelLifetimes,
                memoryUsage: this.getMemoryUsage(),
                databaseStats: await this.getDatabaseStats()
            };
        } catch (error) {
            Logger.error('Fehler beim Abrufen der detaillierten Statistiken:', error);
            return null;
        }
    }

    private getTopChannelOwners(guildId?: string, limit: number = 10): Array<{ ownerName: string; count: number; ownerId: string }> {
        const ownerCounts = new Map<string, { name: string; count: number }>();

        const processGuildChannels = (guildChannels: Map<string, TempChannelData>) => {
            for (const [, channelData] of guildChannels) {
                const current = ownerCounts.get(channelData.ownerId) || { name: channelData.ownerName, count: 0 };
                current.count++;
                ownerCounts.set(channelData.ownerId, current);
            }
        };

        if (guildId) {
            const guildChannels = this.tempChannels.get(guildId);
            if (guildChannels) {
                processGuildChannels(guildChannels);
            }
        } else {
            for (const [, guildChannels] of this.tempChannels) {
                processGuildChannels(guildChannels);
            }
        }

        return Array.from(ownerCounts.entries())
            .map(([ownerId, data]) => ({ ownerId, ownerName: data.name, count: data.count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, limit);
    }

    private getHourlyActivity(guildId?: string): Array<{ hour: number; count: number }> {
        const hourCounts = new Array(24).fill(0);

        const processGuildChannels = (guildChannels: Map<string, TempChannelData>) => {
            for (const [, channelData] of guildChannels) {
                const hour = channelData.createdAt.getHours();
                hourCounts[hour]++;
            }
        };

        if (guildId) {
            const guildChannels = this.tempChannels.get(guildId);
            if (guildChannels) {
                processGuildChannels(guildChannels);
            }
        } else {
            for (const [, guildChannels] of this.tempChannels) {
                processGuildChannels(guildChannels);
            }
        }

        return hourCounts.map((count, hour) => ({ hour, count }));
    }

    private getChannelLifetimeDistribution(guildId?: string): any {
        const lifetimes: number[] = [];
        const now = Date.now();

        const processGuildChannels = (guildChannels: Map<string, TempChannelData>) => {
            for (const [, channelData] of guildChannels) {
                const lifetime = now - channelData.createdAt.getTime();
                lifetimes.push(lifetime);
            }
        };

        if (guildId) {
            const guildChannels = this.tempChannels.get(guildId);
            if (guildChannels) {
                processGuildChannels(guildChannels);
            }
        } else {
            for (const [, guildChannels] of this.tempChannels) {
                processGuildChannels(guildChannels);
            }
        }

        if (lifetimes.length === 0) {
            return { min: 0, max: 0, avg: 0, median: 0 };
        }

        lifetimes.sort((a, b) => a - b);
        const median = lifetimes[Math.floor(lifetimes.length / 2)];
        const avg = lifetimes.reduce((sum, lifetime) => sum + lifetime, 0) / lifetimes.length;

        return {
            min: lifetimes[0],
            max: lifetimes[lifetimes.length - 1],
            avg,
            median,
            count: lifetimes.length
        };
    }

    private getMemoryUsage(): any {
        let totalChannels = 0;
        let totalGuilds = this.guildConfigs.size;
        let totalActivityLogs = 0;

        for (const [, guildChannels] of this.tempChannels) {
            totalChannels += guildChannels.size;
            for (const [, channelData] of guildChannels) {
                totalActivityLogs += channelData.activityLog?.length || 0;
            }
        }

        return {
            totalGuilds,
            totalChannels,
            totalActivityLogs,
            cooldownEntries: this.userCooldowns.size
        };
    }

    private async getDatabaseStats(): Promise<any> {
        if (!this.usingMongoDB || !this.db) {
            return { connected: false };
        }

        try {
            const stats = await this.db.stats();
            const tempChannelsCount = await this.tempChannelsCollection?.countDocuments() || 0;
            const configsCount = await this.configCollection?.countDocuments() || 0;

            return {
                connected: true,
                totalSize: stats.storageSize,
                dataSize: stats.dataSize,
                indexSize: stats.indexSize,
                collections: stats.collections,
                tempChannelsCount,
                configsCount
            };
        } catch (error) {
            Logger.error('Fehler beim Abrufen der Datenbankstatistiken:', error);
            return { connected: false, error: error.message };
        }
    }

    // Export/Import Methods (for backup/restore)
    public async exportGuildData(guildId: string): Promise<any> {
        try {
            const config = await this.getGuildConfig(guildId);
            const channels = this.getActiveChannelsForGuild(guildId);

            return {
                version: this.version,
                exportDate: new Date(),
                guildId,
                config,
                channels,
                stats: await this.getChannelStats(guildId)
            };
        } catch (error) {
            Logger.error('Fehler beim Exportieren der Guild-Daten:', error);
            return null;
        }
    }

    public async importGuildData(data: any): Promise<boolean> {
        try {
            if (!data.guildId || !data.config) {
                throw new Error('Ungültige Import-Daten');
            }

            // Import config
            await this.saveGuildConfig(data.config);

            // Import channels (if they still exist)
            if (data.channels && Array.isArray(data.channels)) {
                for (const channelData of data.channels) {
                    // Verify channel still exists
                    const guild = this.discordClient?.guilds.cache.get(data.guildId);
                    const channel = guild?.channels.cache.get(channelData.voiceChannelId);
                    
                    if (channel) {
                        await this.saveTempChannelData(channelData);
                    }
                }
            }

            Logger.info(`✅ Guild-Daten für ${data.guildId} erfolgreich importiert`);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Importieren der Guild-Daten:', error);
            return false;
        }
    }

    // Health Check Methods
    public async healthCheck(): Promise<any> {
        const health = {
            status: 'healthy',
            timestamp: new Date(),
            version: this.version,
            initialized: this.isInitialized,
            mongodb: {
                connected: this.usingMongoDB,
                status: 'unknown'
            },
            discord: {
                connected: !!this.discordClient?.isReady(),
                guilds: this.discordClient?.guilds.cache.size || 0
            },
            memory: this.getMemoryUsage(),
            performance: {
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage()
            }
        };

        // Test MongoDB connection
        if (this.usingMongoDB && this.mongoClient) {
            try {
                await this.mongoClient.db('admin').command({ ping: 1 });
                health.mongodb.status = 'connected';
            } catch (error) {
                health.mongodb.status = 'disconnected';
                health.status = 'degraded';
            }
        }

        return health;
    }

    // Graceful Shutdown Methods
    public async stop(): Promise<void> {
        try {
            Logger.info('🛑 TempVoice Module shutdown gestartet...');

            // Stop cleanup interval
            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
                this.cleanupInterval = null;
                Logger.info('✅ Cleanup-Intervall gestoppt');
            }

            // Perform final cleanup
            await this.performCleanup();
            Logger.info('✅ Finales Cleanup durchgeführt');

            // Disconnect from MongoDB
            if (this.mongoClient) {
                await this.mongoClient.close();
                this.mongoClient = null;
                this.db = null;
                this.configCollection = null;
                this.tempChannelsCollection = null;
                this.usingMongoDB = false;
                Logger.info('✅ MongoDB-Verbindung geschlossen');
            }

            // Clear memory
            this.tempChannels.clear();
            this.guildConfigs.clear();
            this.userCooldowns.clear();

            this.isInitialized = false;
            Logger.info('✅ TempVoice Module erfolgreich gestoppt');
        } catch (error) {
            Logger.error('❌ Fehler beim Stoppen des TempVoice Modules:', error);
            throw error;
        }
    }

    // Event Listener Management
    public addListener(event: string, listener: (...args: any[]) => void): this {
        return super.addListener(event, listener);
    }

    public removeListener(event: string, listener: (...args: any[]) => void): this {
        return super.removeListener(event, listener);
    }

    public removeAllListeners(event?: string): this {
        return super.removeAllListeners(event);
    }

    // Validation Methods
    public validateChannelName(name: string): { valid: boolean; reason?: string } {
        if (!name || name.trim().length === 0) {
            return { valid: false, reason: 'Name darf nicht leer sein' };
        }

        if (name.length > 100) {
            return { valid: false, reason: 'Name zu lang (max. 100 Zeichen)' };
        }

        // Discord channel name restrictions
        const invalidChars = /[^a-zA-Z0-9\-_\s]/g;
        if (invalidChars.test(name)) {
            return { valid: false, reason: 'Name enthält ungültige Zeichen' };
        }

        return { valid: true };
    }

    public validateUserLimit(limit: number): { valid: boolean; reason?: string } {
        if (limit < 0) {
            return { valid: false, reason: 'Limit darf nicht negativ sein' };
        }

        if (limit > 99) {
            return { valid: false, reason: 'Discord-Limit ist 99 Benutzer' };
        }

        return { valid: true };
    }

    // Getter Methods for External Access
    public get isConnected(): boolean {
        return this.isInitialized;
    }

    public get databaseConnected(): boolean {
        return this.usingMongoDB;
    }

    public get totalChannels(): number {
        let total = 0;
        for (const [, guildChannels] of this.tempChannels) {
            total += guildChannels.size;
        }
        return total;
    }

    public get totalGuilds(): number {
        return this.tempChannels.size;
    }

    public get moduleVersion(): string {
        return this.version;
    }

    public get moduleDescription(): string {
        return this.description;
    }
}

// Export the module
export default TempVoiceModule;

// Also export the interfaces for external use
export type {
    TempChannelData,
    GuildConfig,
    ChannelStats,
    CleanupResult
};