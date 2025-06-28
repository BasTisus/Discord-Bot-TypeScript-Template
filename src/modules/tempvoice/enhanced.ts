// src/modules/tempvoice/enhanced.ts - Korrigierte Enhanced TempVoice Module

import { Client, Guild, GuildMember, VoiceChannel, TextChannel, VoiceState } from 'discord.js';
import { Logger } from '../../services/index.js';
import { MongoDBStorage } from './storage.js';
import { EventEmitter } from 'events';

interface PerformanceMetrics {
    channelsCreated: number;
    channelsDeleted: number;
    userActions: number;
    databaseOperations: number;
    errorCount: number;
    averageResponseTime: number;
    lastResetTime: Date;
}

interface CacheManager {
    channelData: Map<string, any>;
    guildConfigs: Map<string, any>;
    userPermissions: Map<string, any>;
    lastCleanup: Date;
    maxCacheAge: number;
}

interface SystemLimits {
    maxChannelsPerGuild: number;
    maxChannelsPerUser: number;
    maxActivityLogSize: number;
    maxBannedUsersPerChannel: number;
    commandCooldown: number;
    creationRateLimit: number;
}

export class EnhancedTempVoiceModule extends MongoDBStorage {
    public description = 'Erweiterte temporäre Voice-Kanäle mit MongoDB und Performance-Optimierung';
    public version = '3.0.0';
    
    private eventEmitter: EventEmitter;
    private performanceMetrics: PerformanceMetrics;
    private cacheManager: CacheManager;
    private systemLimits: SystemLimits;
    private cleanupInterval: NodeJS.Timeout | null = null;
    private metricsInterval: NodeJS.Timeout | null = null;
    private discordClient: Client | null = null; // Renamed to avoid conflict with MongoDB client
    
    // Rate Limiting
    private userCooldowns = new Map<string, number>();
    private creationLimiter = new Map<string, number[]>();
    
    constructor(connectionString?: string, databaseName?: string) {
        super(connectionString, databaseName);
        
        this.eventEmitter = new EventEmitter();
        this.initializeMetrics();
        this.initializeCache();
        this.initializeSystemLimits();
        this.setupEventHandlers();
    }

    private initializeMetrics(): void {
        this.performanceMetrics = {
            channelsCreated: 0,
            channelsDeleted: 0,
            userActions: 0,
            databaseOperations: 0,
            errorCount: 0,
            averageResponseTime: 0,
            lastResetTime: new Date()
        };
    }

    private initializeCache(): void {
        this.cacheManager = {
            channelData: new Map(),
            guildConfigs: new Map(),
            userPermissions: new Map(),
            lastCleanup: new Date(),
            maxCacheAge: 5 * 60 * 1000 // 5 minutes
        };
    }

    private initializeSystemLimits(): void {
        this.systemLimits = {
            maxChannelsPerGuild: 50,
            maxChannelsPerUser: 3,
            maxActivityLogSize: 100,
            maxBannedUsersPerChannel: 20,
            commandCooldown: 3000,
            creationRateLimit: 5 // per minute
        };
    }

    private setupEventHandlers(): void {
        // Enhanced event handling with performance tracking
        this.eventEmitter.on('channelCreated', (data) => {
            this.performanceMetrics.channelsCreated++;
            if (Logger.info) { // Check if method exists
                Logger.info(`👤 Event: User-Aktion - ${data.action} von ${data.userId}`);
            }
        });

        this.eventEmitter.on('channelDeleted', (data) => {
            this.performanceMetrics.channelsDeleted++;
        });

        this.eventEmitter.on('userAction', (data) => {
            this.performanceMetrics.userActions++;
        });

        this.eventEmitter.on('error', (error) => {
            this.performanceMetrics.errorCount++;
            Logger.error('Enhanced TempVoice Error', error);
        });
    }

    // Enhanced initialization with client reference
    public async initialize(client: Client): Promise<void> {
        try {
            this.discordClient = client;
            await this.connect();
            
            // Setup scheduled cleanup
            this.startScheduledCleanup();
            
            // Setup metrics collection
            this.startMetricsCollection();

            Logger.info('✅ Enhanced TempVoice Module initialized successfully');
        } catch (error) {
            Logger.error('❌ Failed to initialize Enhanced TempVoice Module', error);
            throw error;
        }
    }

    // Enhanced channel creation with rate limiting and validation
    public async createTempChannel(guild: Guild, member: GuildMember, creatorChannel: VoiceChannel, config: any): Promise<any> {
        const startTime = Date.now();
        
        try {
            // Rate limiting check
            if (!this.checkRateLimit(member.id)) {
                return { 
                    success: false, 
                    message: 'Rate limit erreicht. Bitte warte einen Moment.' 
                };
            }

            // System limits check
            const userChannelCount = await this.getUserChannelCount(guild.id, member.id);
            if (userChannelCount >= this.systemLimits.maxChannelsPerUser) {
                return { 
                    success: false, 
                    message: `Du kannst maximal ${this.systemLimits.maxChannelsPerUser} Channels haben.` 
                };
            }

            const guildChannelCount = await this.getGuildChannelCount(guild.id);
            if (guildChannelCount >= this.systemLimits.maxChannelsPerGuild) {
                return { 
                    success: false, 
                    message: `Maximale Anzahl von Channels erreicht (${this.systemLimits.maxChannelsPerGuild}).` 
                };
            }

            // Create channel using parent method (corrected method name)
            const result = await this.createTempChannel(guild, member, creatorChannel, config);
            
            if (result) {
                // Emit event
                this.eventEmitter.emit('channelCreated', {
                    action: 'channel_created',
                    userId: member.id,
                    guildId: guild.id,
                    channelId: result.voiceChannel.id
                });

                // Update rate limiting
                this.updateRateLimit(member.id);

                // Track performance
                const responseTime = Date.now() - startTime;
                this.updateAverageResponseTime(responseTime);

                return { 
                    success: true, 
                    voiceChannel: result.voiceChannel,
                    textChannel: result.textChannel 
                };
            }

            return { success: false, message: 'Fehler beim Erstellen des Channels.' };
        } catch (error) {
            this.eventEmitter.emit('error', error);
            return { success: false, message: 'Unerwarteter Fehler beim Erstellen des Channels.' };
        }
    }

    // Enhanced voice state update handler
    public async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
        try {
            if (!this.discordClient) {
                Logger.warn('Discord client not set, skipping voice state update');
                return;
            }

            // Call parent method with correct signature
            await super.handleVoiceStateUpdate(oldState, newState, this.discordClient);

            // Additional enhanced handling
            const member = newState.member || oldState.member;
            if (!member || member.user.bot) return;

            // Track user activity for analytics
            this.eventEmitter.emit('userAction', {
                action: 'voice_state_change',
                userId: member.id,
                guildId: (newState.guild || oldState.guild).id,
                timestamp: new Date()
            });

        } catch (error) {
            this.eventEmitter.emit('error', error);
        }
    }

    // Enhanced cleanup with better logic
    public async cleanupEmptyChannels(client: Client): Promise<number> {
        try {
            let cleanedCount = 0;
            const guilds = client.guilds.cache;

            for (const guild of guilds.values()) {
                const tempChannels = await this.getAllTempChannels(guild.id);
                
                for (const channelData of tempChannels) {
                    const channel = guild.channels.cache.get(channelData.voiceChannelId);
                    
                    if (!channel) {
                        // Channel doesn't exist anymore, clean up data
                        await this.deleteTempChannel(guild.id, channelData.voiceChannelId);
                        cleanedCount++;
                        continue;
                    }

                    if (channel.isVoiceBased() && channel.members.size === 0) {
                        // Check if channel has been empty for more than cleanup interval
                        const lastActivity = channelData.lastActivity ? new Date(channelData.lastActivity) : new Date(channelData.createdAt);
                        const timeSinceActivity = Date.now() - lastActivity.getTime();
                        
                        if (timeSinceActivity > 5 * 60 * 1000) { // 5 minutes
                            const success = await this.deleteEmptyTempChannel(guild, channelData.voiceChannelId);
                            if (success) {
                                cleanedCount++;
                                this.performanceMetrics.channelsDeleted++;
                            }
                        }
                    }
                }
            }

            return cleanedCount;
        } catch (error) {
            Logger.error('Fehler beim Cleanup der leeren Channels', error);
            return 0;
        }
    }

    // Scheduled cleanup
    private startScheduledCleanup(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        this.cleanupInterval = setInterval(async () => {
            if (Logger.info) { // Check if method exists
                Logger.info('🔄 Starte geplante TempVoice-Bereinigung...');
            }
            
            if (this.discordClient) {
                const cleanedCount = await this.cleanupEmptyChannels(this.discordClient);
                
                if (Logger.info) { // Check if method exists
                    Logger.info('✅ Geplante Bereinigung abgeschlossen');
                }
            }
        }, 5 * 60 * 1000); // Every 5 minutes
    }

    // Metrics collection
    private startMetricsCollection(): void {
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
        }

        this.metricsInterval = setInterval(() => {
            this.cleanupCache();
        }, 60 * 1000); // Every minute
    }

    // Cache management
    private cleanupCache(): void {
        const now = Date.now();
        let cleanedCount = 0;

        // Clean channel data cache
        for (const [key, data] of this.cacheManager.channelData.entries()) {
            if (now - data.lastAccessed > this.cacheManager.maxCacheAge) {
                this.cacheManager.channelData.delete(key);
                cleanedCount++;
            }
        }

        // Clean guild configs cache
        for (const [key, data] of this.cacheManager.guildConfigs.entries()) {
            if (now - data.lastAccessed > this.cacheManager.maxCacheAge) {
                this.cacheManager.guildConfigs.delete(key);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0 && Logger.info) { // Check if method exists
            Logger.info(`🧹 Cache bereinigt: ${cleanedCount} veraltete Einträge entfernt`);
        }
    }

    // Rate limiting helpers
    private checkRateLimit(userId: string): boolean {
        const now = Date.now();
        const userLimits = this.creationLimiter.get(userId) || [];
        
        // Remove old entries (older than 1 minute)
        const recentLimits = userLimits.filter(time => now - time < 60000);
        
        return recentLimits.length < this.systemLimits.creationRateLimit;
    }

    private updateRateLimit(userId: string): void {
        const now = Date.now();
        const userLimits = this.creationLimiter.get(userId) || [];
        userLimits.push(now);
        this.creationLimiter.set(userId, userLimits);
    }

    // Performance tracking
    private updateAverageResponseTime(responseTime: number): void {
        const currentAvg = this.performanceMetrics.averageResponseTime;
        const totalOperations = this.performanceMetrics.channelsCreated + this.performanceMetrics.userActions;
        
        if (totalOperations === 0) {
            this.performanceMetrics.averageResponseTime = responseTime;
        } else {
            this.performanceMetrics.averageResponseTime = 
                (currentAvg * (totalOperations - 1) + responseTime) / totalOperations;
        }
    }

    // Helper methods for system limits
    private async getUserChannelCount(guildId: string, userId: string): Promise<number> {
        try {
            const allChannels = await this.getAllTempChannels(guildId);
            return allChannels.filter(ch => ch.ownerId === userId).length;
        } catch (error) {
            Logger.error('Fehler beim Abrufen der User-Channel-Anzahl', error);
            return 0;
        }
    }

    private async getGuildChannelCount(guildId: string): Promise<number> {
        try {
            const allChannels = await this.getAllTempChannels(guildId);
            return allChannels.length;
        } catch (error) {
            Logger.error('Fehler beim Abrufen der Guild-Channel-Anzahl', error);
            return 0;
        }
    }

    // Enhanced statistics
    public getPerformanceMetrics(): PerformanceMetrics {
        return { ...this.performanceMetrics };
    }

    public getCacheStats(): { size: number; maxAge: number; lastCleanup: Date } {
        return {
            size: this.cacheManager.channelData.size + this.cacheManager.guildConfigs.size,
            maxAge: this.cacheManager.maxCacheAge,
            lastCleanup: this.cacheManager.lastCleanup
        };
    }

    // Cleanup methods
    public async stop(): Promise<void> {
        try {
            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
                this.cleanupInterval = null;
            }

            if (this.metricsInterval) {
                clearInterval(this.metricsInterval);
                this.metricsInterval = null;
            }

            await this.disconnect();
            
            Logger.info('✅ Enhanced TempVoice Module stopped successfully');
        } catch (error) {
            Logger.error('❌ Error stopping Enhanced TempVoice Module', error);
        }
    }

    // Event emitter access for external listeners
    public on(event: string, listener: (...args: any[]) => void): void {
        this.eventEmitter.on(event, listener);
    }

    public off(event: string, listener: (...args: any[]) => void): void {
        this.eventEmitter.off(event, listener);
    }

    public emit(event: string, ...args: any[]): boolean {
        return this.eventEmitter.emit(event, ...args);
    }
}