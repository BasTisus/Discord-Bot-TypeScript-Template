// src/modules/tempvoice/enhanced.ts - Teil 7/8
// Enhanced TempVoice Module mit vollständiger Integration

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
    private client: Client | null = null;
    
    // Rate Limiting
    private userCooldowns = new Map<string, number>();
    private creationLimiter = new Map<string, number[]>();
    
    constructor(connectionString?: string) {
        super(connectionString);
        
        this.eventEmitter = new EventEmitter();
        this.performanceMetrics = this.initializeMetrics();
        this.cacheManager = this.initializeCacheManager();
        this.systemLimits = this.initializeSystemLimits();
        
        Logger.info('🚀 Enhanced TempVoice-Modul initialisiert');
    }

    private initializeMetrics(): PerformanceMetrics {
        return {
            channelsCreated: 0,
            channelsDeleted: 0,
            userActions: 0,
            databaseOperations: 0,
            errorCount: 0,
            averageResponseTime: 0,
            lastResetTime: new Date()
        };
    }

    private initializeCacheManager(): CacheManager {
        return {
            channelData: new Map(),
            guildConfigs: new Map(),
            userPermissions: new Map(),
            lastCleanup: new Date(),
            maxCacheAge: 300000 // 5 minutes
        };
    }

    private initializeSystemLimits(): SystemLimits {
        return {
            maxChannelsPerGuild: 50,
            maxChannelsPerUser: 3,
            maxActivityLogSize: 100,
            maxBannedUsersPerChannel: 50,
            commandCooldown: 3000, // 3 seconds
            creationRateLimit: 5 // 5 channels per minute
        };
    }

    // Enhanced Initialization
    public init(client: Client): void {
        this.client = client;
        
        // Voice State Update Handler
        client.on('voiceStateUpdate', async (oldState, newState) => {
            const startTime = Date.now();
            try {
                await this.handleVoiceStateUpdate(oldState, newState, client);
                this.updateMetrics('voiceStateUpdate', Date.now() - startTime);
            } catch (error) {
                this.handleError('voiceStateUpdate', error);
            }
        });

        // Guild Join/Leave Handlers
        client.on('guildCreate', async (guild) => {
            await this.initializeGuild(guild);
        });

        client.on('guildDelete', async (guild) => {
            await this.cleanupGuild(guild);
        });

        // Channel Delete Handler
        client.on('channelDelete', async (channel) => {
            if (channel.isVoiceBased()) {
                await this.handleChannelDelete(channel as VoiceChannel);
            }
        });

        // Setup intervals
        this.setupCleanupInterval();
        this.setupMetricsInterval();
        this.setupCacheCleanup();

        // Event listeners for custom events
        this.setupEventListeners();

        Logger.info('✅ Enhanced TempVoice-Modul erfolgreich initialisiert');
        Logger.info('🔄 Automatische Routinen aktiviert (Cleanup, Metriken, Cache)');
        Logger.info('📊 Performance-Monitoring aktiviert');
    }

    private setupEventListeners(): void {
        // Channel Creation Event
        this.eventEmitter.on('channelCreated', (data) => {
            Logger.info(`📢 Event: Channel erstellt - ${data.channelName} von ${data.ownerName}`);
            this.performanceMetrics.channelsCreated++;
        });

        // Channel Deletion Event
        this.eventEmitter.on('channelDeleted', (data) => {
            Logger.info(`🗑️ Event: Channel gelöscht - ${data.channelId} (${data.reason})`);
            this.performanceMetrics.channelsDeleted++;
        });

        // User Action Event
        this.eventEmitter.on('userAction', (data) => {
            Logger.debug(`👤 Event: User-Aktion - ${data.action} von ${data.userId}`);
            this.performanceMetrics.userActions++;
        });

        // Error Event
        this.eventEmitter.on('error', (error) => {
            Logger.error('❌ Event: TempVoice Error', error);
            this.performanceMetrics.errorCount++;
        });
    }

    // Enhanced Channel Creation with Rate Limiting
    public async createTempChannelEnhanced(
        guild: Guild, 
        member: GuildMember, 
        creatorChannel: VoiceChannel
    ): Promise<{ voiceChannel: VoiceChannel; textChannel: TextChannel } | null> {
        const startTime = Date.now();
        
        try {
            // Rate Limiting Checks
            if (!await this.checkRateLimits(guild.id, member.id)) {
                Logger.warn(`⚠️ Rate-Limit erreicht für ${member.displayName} in ${guild.name}`);
                return null;
            }

            // System Limits Check
            if (!await this.checkSystemLimits(guild.id, member.id)) {
                Logger.warn(`⚠️ System-Limits erreicht für ${member.displayName}`);
                return null;
            }

            const config = this.getGuildConfig(guild.id);
            const result = await this.createTempChannel(guild, member, creatorChannel, config);
            
            if (result) {
                // Update rate limiting
                this.updateRateLimiting(guild.id, member.id);
                
                // Emit event
                this.eventEmitter.emit('channelCreated', {
                    guildId: guild.id,
                    channelId: result.voiceChannel.id,
                    channelName: result.voiceChannel.name,
                    ownerId: member.id,
                    ownerName: member.displayName,
                    createdAt: new Date()
                });
                
                // Cache the channel data
                this.cacheChannelData(guild.id, result.voiceChannel.id, {
                    voiceChannelId: result.voiceChannel.id,
                    textChannelId: result.textChannel.id,
                    ownerId: member.id,
                    ownerName: member.displayName,
                    createdAt: new Date()
                });
            }
            
            this.updateMetrics('channelCreation', Date.now() - startTime);
            return result;
            
        } catch (error) {
            this.handleError('createTempChannelEnhanced', error);
            return null;
        }
    }

    private async checkRateLimits(guildId: string, userId: string): Promise<boolean> {
        const now = Date.now();
        const cooldownKey = `${guildId}:${userId}`;
        
        // Command cooldown check
        const lastCommand = this.userCooldowns.get(cooldownKey);
        if (lastCommand && (now - lastCommand) < this.systemLimits.commandCooldown) {
            return false;
        }
        
        // Creation rate limit check
        const creationKey = `creation:${guildId}:${userId}`;
        const creationTimes = this.creationLimiter.get(creationKey) || [];
        const recentCreations = creationTimes.filter(time => (now - time) < 60000); // Last minute
        
        if (recentCreations.length >= this.systemLimits.creationRateLimit) {
            return false;
        }
        
        return true;
    }

    private async checkSystemLimits(guildId: string, userId: string): Promise<boolean> {
        // Check max channels per guild
        const guildChannels = await this.getAllTempChannels(guildId);
        if (guildChannels.length >= this.systemLimits.maxChannelsPerGuild) {
            return false;
        }
        
        // Check max channels per user
        const userChannels = guildChannels.filter(channel => channel.ownerId === userId);
        if (userChannels.length >= this.systemLimits.maxChannelsPerUser) {
            return false;
        }
        
        return true;
    }

    private updateRateLimiting(guildId: string, userId: string): void {
        const now = Date.now();
        const cooldownKey = `${guildId}:${userId}`;
        const creationKey = `creation:${guildId}:${userId}`;
        
        // Update cooldown
        this.userCooldowns.set(cooldownKey, now);
        
        // Update creation rate limiting
        const creationTimes = this.creationLimiter.get(creationKey) || [];
        creationTimes.push(now);
        this.creationLimiter.set(creationKey, creationTimes.filter(time => (now - time) < 60000));
    }

    // Enhanced Channel Deletion
    public async deleteEmptyTempChannelEnhanced(guild: Guild, channelId: string, reason: string = 'empty'): Promise<boolean> {
        const startTime = Date.now();
        
        try {
            const success = await this.deleteEmptyTempChannel(guild, channelId);
            
            if (success) {
                // Emit event
                this.eventEmitter.emit('channelDeleted', {
                    guildId: guild.id,
                    channelId,
                    reason,
                    deletedAt: new Date()
                });
                
                // Remove from cache
                this.removeCachedChannelData(guild.id, channelId);
            }
            
            this.updateMetrics('channelDeletion', Date.now() - startTime);
            return success;
            
        } catch (error) {
            this.handleError('deleteEmptyTempChannelEnhanced', error);
            return false;
        }
    }

    // Cache Management
    private cacheChannelData(guildId: string, channelId: string, data: any): void {
        const cacheKey = `${guildId}:${channelId}`;
        this.cacheManager.channelData.set(cacheKey, {
            data,
            timestamp: Date.now()
        });
    }

    private getCachedChannelData(guildId: string, channelId: string): any | null {
        const cacheKey = `${guildId}:${channelId}`;
        const cached = this.cacheManager.channelData.get(cacheKey);
        
        if (!cached) return null;
        
        // Check if cache is still valid
        const age = Date.now() - cached.timestamp;
        if (age > this.cacheManager.maxCacheAge) {
            this.cacheManager.channelData.delete(cacheKey);
            return null;
        }
        
        return cached.data;
    }

    private removeCachedChannelData(guildId: string, channelId: string): void {
        const cacheKey = `${guildId}:${channelId}`;
        this.cacheManager.channelData.delete(cacheKey);
    }

    // Enhanced Voice State Handler
    public async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState, client: Client): Promise<void> {
        try {
            await super.handleVoiceStateUpdate(oldState, newState, client);
            
            // Additional enhanced handling
            const member = newState.member || oldState.member;
            if (!member || member.user.bot) return;

            // Emit user action event
            this.eventEmitter.emit('userAction', {
                action: this.determineVoiceAction(oldState, newState),
                userId: member.id,
                guildId: (newState.guild || oldState.guild).id,
                timestamp: new Date()
            });

        } catch (error) {
            this.handleError('handleVoiceStateUpdate', error);
        }
    }

    private determineVoiceAction(oldState: VoiceState, newState: VoiceState): string {
        if (!oldState.channel && newState.channel) return 'joined';
        if (oldState.channel && !newState.channel) return 'left';
        if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) return 'moved';
        return 'updated';
    }

    // Channel Delete Handler
    private async handleChannelDelete(channel: VoiceChannel): Promise<void> {
        try {
            const tempChannelData = this.getTempChannel(channel.guild.id, channel.id);
            if (tempChannelData) {
                await this.deleteTempChannel(channel.guild.id, channel.id);
                Logger.info(`🗑️ Temp-Channel aus DB entfernt: ${channel.id} (Discord-Channel gelöscht)`);
            }
        } catch (error) {
            this.handleError('handleChannelDelete', error);
        }
    }

    // Guild Management
    private async initializeGuild(guild: Guild): Promise<void> {
        try {
            Logger.info(`🏰 Initialisiere TempVoice für neue Guild: ${guild.name} (${guild.id})`);
            
            // Create default config
            const defaultConfig = {
                guildId: guild.id,
                creatorChannels: [],
                defaultMaxUsers: 5,
                cleanupInterval: 300000,
                autoDeleteText: true
            };
            
            await this.saveGuildConfig(guild.id, defaultConfig);
            Logger.info(`✅ Standard-Konfiguration für ${guild.name} erstellt`);
            
        } catch (error) {
            this.handleError('initializeGuild', error);
        }
    }

    private async cleanupGuild(guild: Guild): Promise<void> {
        try {
            Logger.info(`🧹 Bereinige TempVoice-Daten für verlassene Guild: ${guild.name} (${guild.id})`);
            
            // Get all channels for this guild
            const guildChannels = await this.getAllTempChannels(guild.id);
            
            // Delete all temp channels from database
            for (const channelData of guildChannels) {
                await this.deleteTempChannel(guild.id, channelData.voiceChannelId);
            }
            
            // Clean cache
            for (const [cacheKey] of this.cacheManager.channelData) {
                if (cacheKey.startsWith(`${guild.id}:`)) {
                    this.cacheManager.channelData.delete(cacheKey);
                }
            }
            
            Logger.info(`✅ TempVoice-Daten für ${guild.name} bereinigt (${guildChannels.length} Channels entfernt)`);
            
        } catch (error) {
            this.handleError('cleanupGuild', error);
        }
    }

    // Interval Setups
    private setupCleanupInterval(): void {
        this.cleanupInterval = setInterval(async () => {
            try {
                await this.performScheduledCleanup();
            } catch (error) {
                this.handleError('scheduledCleanup', error);
            }
        }, 300000); // 5 minutes
    }

    private setupMetricsInterval(): void {
        this.metricsInterval = setInterval(() => {
            this.logPerformanceMetrics();
            this.resetMetricsIfNeeded();
        }, 600000); // 10 minutes
    }

    private setupCacheCleanup(): void {
        setInterval(() => {
            this.cleanupExpiredCache();
        }, 180000); // 3 minutes
    }

    private async performScheduledCleanup(): Promise<void> {
        if (!this.client) return;
        
        Logger.debug('🔄 Starte geplante TempVoice-Bereinigung...');
        
        try {
            await this.cleanupEmptyChannels(this.client);
            await this.cleanupExpiredRateLimits();
            await this.cleanupOldChannels(86400000); // 24 hours
            
            Logger.debug('✅ Geplante Bereinigung abgeschlossen');
        } catch (error) {
            Logger.error('Fehler bei geplanter Bereinigung', error);
        }
    }

    private cleanupExpiredRateLimits(): void {
        const now = Date.now();
        
        // Cleanup user cooldowns
        for (const [key, timestamp] of this.userCooldowns) {
            if ((now - timestamp) > this.systemLimits.commandCooldown * 2) {
                this.userCooldowns.delete(key);
            }
        }
        
        // Cleanup creation limiters
        for (const [key, times] of this.creationLimiter) {
            const recentTimes = times.filter(time => (now - time) < 120000); // Keep 2 minutes
            if (recentTimes.length === 0) {
                this.creationLimiter.delete(key);
            } else {
                this.creationLimiter.set(key, recentTimes);
            }
        }
    }

    private cleanupExpiredCache(): void {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [key, cached] of this.cacheManager.channelData) {
            if ((now - cached.timestamp) > this.cacheManager.maxCacheAge) {
                this.cacheManager.channelData.delete(key);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            Logger.debug(`🧹 Cache bereinigt: ${cleanedCount} veraltete Einträge entfernt`);
        }
    }

    // Metrics and Performance
    private updateMetrics(operation: string, responseTime: number): void {
        this.performanceMetrics.databaseOperations++;
        
        // Update average response time
        const currentAvg = this.performanceMetrics.averageResponseTime;
        const operations = this.performanceMetrics.databaseOperations;
        this.performanceMetrics.averageResponseTime = ((currentAvg * (operations - 1)) + responseTime) / operations;
    }

    private logPerformanceMetrics(): void {
        const metrics = this.performanceMetrics;
        const uptime = Date.now() - metrics.lastResetTime.getTime();
        
        Logger.info('📊 TempVoice Performance-Metriken:');
        Logger.info(`   Channels erstellt: ${metrics.channelsCreated}`);
        Logger.info(`   Channels gelöscht: ${metrics.channelsDeleted}`);
        Logger.info(`   User-Aktionen: ${metrics.userActions}`);
        Logger.info(`   DB-Operationen: ${metrics.databaseOperations}`);
        Logger.info(`   Fehler: ${metrics.errorCount}`);
        Logger.info(`   Ø Antwortzeit: ${metrics.averageResponseTime.toFixed(2)}ms`);
        Logger.info(`   Uptime: ${Math.floor(uptime / 60000)}min`);
        Logger.info(`   Cache-Größe: ${this.cacheManager.channelData.size} Einträge`);
    }

    private resetMetricsIfNeeded(): void {
        const uptime = Date.now() - this.performanceMetrics.lastResetTime.getTime();
        
        // Reset metrics every 24 hours
        if (uptime > 86400000) {
            Logger.info('🔄 Performance-Metriken werden zurückgesetzt (24h erreicht)');
            this.performanceMetrics = this.initializeMetrics();
        }
    }

    private handleError(operation: string, error: any): void {
        Logger.error(`❌ TempVoice Error in ${operation}:`, error);
        this.eventEmitter.emit('error', { operation, error, timestamp: new Date() });
    }

    // Public API for metrics
    public getPerformanceMetrics(): PerformanceMetrics {
        return { ...this.performanceMetrics };
    }

    public getCacheStats(): { size: number; maxAge: number; lastCleanup: Date } {
        return {
            size: this.cacheManager.channelData.size,
            maxAge: this.cacheManager.maxCacheAge,
            lastCleanup: this.cacheManager.lastCleanup
        };
    }

    public getSystemLimits(): SystemLimits {
        return { ...this.systemLimits };
    }

    public updateSystemLimits(newLimits: Partial<SystemLimits>): void {
        this.systemLimits = { ...this.systemLimits, ...newLimits };
        Logger.info('⚙️ System-Limits aktualisiert', newLimits);
    }

    // Enhanced Cleanup
    public async cleanup(): Promise<void> {
        Logger.info('🧹 Enhanced TempVoice-Modul wird bereinigt...');
        
        try {
            // Clear intervals
            if (this.cleanupInterval) clearInterval(this.cleanupInterval);
            if (this.metricsInterval) clearInterval(this.metricsInterval);
            
            // Log final metrics
            this.logPerformanceMetrics();
            
            // Clear caches and rate limiters
            this.cacheManager.channelData.clear();
            this.userCooldowns.clear();
            this.creationLimiter.clear();
            
            // Call parent cleanup
            await super.cleanup();
            
            Logger.info('✅ Enhanced TempVoice-Modul erfolgreich bereinigt');
        } catch (error) {
            Logger.error('Fehler beim Enhanced TempVoice Cleanup', error);
        }
    }
}

// Export the enhanced module instance
export const enhancedTempVoiceModule = new EnhancedTempVoiceModule(process.env.MONGODB_URI);