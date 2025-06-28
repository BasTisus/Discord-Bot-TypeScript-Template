// src/modules/tempvoice/storage.ts - Korrigierte MongoDB Storage Implementation

import { MongoClient, Db, Collection } from 'mongodb';
import { Logger } from '../../services/index.js';
import { TempVoiceCore } from './cote.js'; // Korrigierter Import

interface TempChannelDocument {
    _id?: string;
    guildId: string;
    voiceChannelId: string;
    textChannelId: string;
    ownerId: string;
    ownerName: string;
    maxUsers: number;
    isVisible: boolean;
    isLocked: boolean;
    bannedUsers: string[];
    createdAt: Date;
    lastActivity: Date;
    activityLog: ActivityLogEntry[];
    metadata?: any;
}

interface GuildConfigDocument {
    _id?: string;
    guildId: string;
    creatorChannels: string[];
    defaultMaxUsers: number;
    cleanupInterval: number;
    autoDeleteText: boolean;
    logChannelId?: string;
    logActions: boolean;
    collectStats: boolean;
    lastCleanup: Date;
    settings: {
        allowUserLimit: boolean;
        allowRename: boolean;
        allowVisibilityToggle: boolean;
        allowLocking: boolean;
        maxBannedUsers: number;
        maxChannelLifetime: number;
    };
}

interface ActivityLogEntry {
    timestamp: Date;
    activity: string;
    userId: string;
    metadata?: any;
}

interface DatabaseStats {
    totalDocuments: number;
    totalSize: number;
    avgDocumentSize: number;
    indexCount: number;
    dataSize: number;
    storageSize: number;
}

export class MongoDBStorage extends TempVoiceCore {
    private mongoClient: MongoClient | null = null; // Renamed to avoid conflict
    private db: Db | null = null;
    private tempChannelsCollection: Collection<TempChannelDocument> | null = null;
    private guildConfigsCollection: Collection<GuildConfigDocument> | null = null;
    private isConnected: boolean = false;
    private connectionString: string;
    private databaseName: string;

    // Fallback Memory Storage
    private memoryChannels = new Map<string, Map<string, TempChannelDocument>>();
    private memoryConfigs = new Map<string, GuildConfigDocument>();

    constructor(connectionString?: string, databaseName?: string) {
        super();
        this.connectionString = connectionString || process.env.MONGODB_URI || 'mongodb://localhost:27017';
        this.databaseName = databaseName || process.env.MONGODB_DB_NAME || 'borety_bot';
    }

    // Connection management
    public async connect(): Promise<void> {
        try {
            this.mongoClient = new MongoClient(this.connectionString);
            await this.mongoClient.connect();
            
            this.db = this.mongoClient.db(this.databaseName);
            this.tempChannelsCollection = this.db.collection<TempChannelDocument>('tempChannels');
            this.guildConfigsCollection = this.db.collection<GuildConfigDocument>('guildConfigs');

            // Create indexes for better performance
            await this.createIndexes();
            
            this.isConnected = true;
            Logger.info('✅ MongoDB Storage connected successfully');
        } catch (error) {
            Logger.error('❌ MongoDB connection failed, falling back to memory storage', error);
            this.isConnected = false;
        }
    }

    public async disconnect(): Promise<void> {
        try {
            if (this.mongoClient) {
                await this.mongoClient.close();
                this.mongoClient = null;
                this.db = null;
                this.tempChannelsCollection = null;
                this.guildConfigsCollection = null;
                this.isConnected = false;
                Logger.info('✅ MongoDB Storage disconnected');
            }
        } catch (error) {
            Logger.error('❌ Error disconnecting from MongoDB', error);
        }
    }

    private async createIndexes(): Promise<void> {
        try {
            if (!this.tempChannelsCollection || !this.guildConfigsCollection) return;

            // TempChannels indexes
            await this.tempChannelsCollection.createIndex({ guildId: 1, voiceChannelId: 1 }, { unique: true });
            await this.tempChannelsCollection.createIndex({ guildId: 1 });
            await this.tempChannelsCollection.createIndex({ ownerId: 1 });
            await this.tempChannelsCollection.createIndex({ createdAt: 1 });
            await this.tempChannelsCollection.createIndex({ lastActivity: 1 });

            // GuildConfigs indexes
            await this.guildConfigsCollection.createIndex({ guildId: 1 }, { unique: true });

            Logger.info('✅ MongoDB indexes created successfully');
        } catch (error) {
            Logger.error('❌ Error creating MongoDB indexes', error);
        }
    }

    // Implementation of abstract methods from TempVoiceCore
    protected getTempChannel(guildId: string, channelId: string): TempChannelDocument | null {
        if (this.isConnected) {
            // For real-time access, we use memory cache
            // Database queries would be too slow for frequent access
            return this.getTempChannelFromMemory(guildId, channelId);
        } else {
            return this.getTempChannelFromMemory(guildId, channelId);
        }
    }

    private getTempChannelFromMemory(guildId: string, channelId: string): TempChannelDocument | null {
        const guildChannels = this.memoryChannels.get(guildId);
        if (!guildChannels) return null;
        return guildChannels.get(channelId) || null;
    }

    protected async setTempChannel(guildId: string, channelId: string, data: TempChannelDocument): Promise<void> {
        if (this.isConnected) {
            await this.setTempChannelInDatabase(guildId, channelId, data);
        } else {
            await this.setTempChannelInMemory(guildId, channelId, data);
        }
    }

    private async setTempChannelInDatabase(guildId: string, channelId: string, data: TempChannelDocument): Promise<void> {
        try {
            if (!this.tempChannelsCollection) throw new Error('TempChannels collection not initialized');

            const document: TempChannelDocument = {
                ...data,
                guildId,
                voiceChannelId: channelId,
                lastActivity: new Date()
            };

            await this.tempChannelsCollection.replaceOne(
                { guildId, voiceChannelId: channelId },
                document,
                { upsert: true }
            );

            // Update memory cache for quick access
            this.setTempChannelInMemory(guildId, channelId, data);
        } catch (error) {
            Logger.error('Fehler beim Speichern des TempChannels in MongoDB', error);
            // Fallback to memory
            await this.setTempChannelInMemory(guildId, channelId, data);
        }
    }

    private async setTempChannelInMemory(guildId: string, channelId: string, data: TempChannelDocument): Promise<void> {
        if (!this.memoryChannels.has(guildId)) {
            this.memoryChannels.set(guildId, new Map());
        }
        this.memoryChannels.get(guildId)!.set(channelId, data);
    }

    protected async deleteTempChannel(guildId: string, channelId: string): Promise<void> {
        if (this.isConnected) {
            await this.deleteTempChannelFromDatabase(guildId, channelId);
        } else {
            await this.deleteTempChannelFromMemory(guildId, channelId);
        }
    }

    private async deleteTempChannelFromDatabase(guildId: string, channelId: string): Promise<void> {
        try {
            if (!this.tempChannelsCollection) throw new Error('TempChannels collection not initialized');

            await this.tempChannelsCollection.deleteOne({ guildId, voiceChannelId: channelId });
            
            // Also remove from memory
            await this.deleteTempChannelFromMemory(guildId, channelId);
        } catch (error) {
            Logger.error('Fehler beim Löschen des TempChannels aus MongoDB', error);
            // Still try to remove from memory
            await this.deleteTempChannelFromMemory(guildId, channelId);
        }
    }

    private async deleteTempChannelFromMemory(guildId: string, channelId: string): Promise<void> {
        const guildChannels = this.memoryChannels.get(guildId);
        if (guildChannels) {
            guildChannels.delete(channelId);
            if (guildChannels.size === 0) {
                this.memoryChannels.delete(guildId);
            }
        }
    }

    protected async getAllTempChannels(guildId: string): Promise<TempChannelDocument[]> {
        if (this.isConnected) {
            return await this.getAllTempChannelsFromDatabase(guildId);
        } else {
            return this.getAllTempChannelsFromMemory(guildId);
        }
    }

    private async getAllTempChannelsFromDatabase(guildId: string): Promise<TempChannelDocument[]> {
        try {
            if (!this.tempChannelsCollection) throw new Error('TempChannels collection not initialized');

            const channels = await this.tempChannelsCollection.find({ guildId }).toArray();
            
            // Also update memory cache
            for (const channel of channels) {
                this.setTempChannelInMemory(guildId, channel.voiceChannelId, channel);
            }
            
            return channels;
        } catch (error) {
            Logger.error('Fehler beim Abrufen aller TempChannels aus MongoDB', error);
            return this.getAllTempChannelsFromMemory(guildId);
        }
    }

    private getAllTempChannelsFromMemory(guildId: string): TempChannelDocument[] {
        const guildChannels = this.memoryChannels.get(guildId);
        return guildChannels ? Array.from(guildChannels.values()) : [];
    }

    protected getGuildConfig(guildId: string): GuildConfigDocument {
        if (this.isConnected) {
            // Use memory cache for quick access
            return this.getGuildConfigFromMemory(guildId);
        } else {
            return this.getGuildConfigFromMemory(guildId);
        }
    }

    private getGuildConfigFromMemory(guildId: string): GuildConfigDocument {
        const existing = this.memoryConfigs.get(guildId);
        if (existing) return existing;

        // Return default config
        const defaultConfig: GuildConfigDocument = {
            guildId,
            creatorChannels: [],
            defaultMaxUsers: 0,
            cleanupInterval: 300, // 5 minutes
            autoDeleteText: false,
            logActions: false,
            collectStats: true,
            lastCleanup: new Date(),
            settings: {
                allowUserLimit: true,
                allowRename: true,
                allowVisibilityToggle: true,
                allowLocking: true,
                maxBannedUsers: 20,
                maxChannelLifetime: 86400000 // 24 hours
            }
        };

        this.memoryConfigs.set(guildId, defaultConfig);
        return defaultConfig;
    }

    protected async saveGuildConfig(guildId: string, config: GuildConfigDocument): Promise<boolean> {
        try {
            if (this.isConnected && this.guildConfigsCollection) {
                await this.guildConfigsCollection.replaceOne(
                    { guildId },
                    config,
                    { upsert: true }
                );
            }
            
            // Always update memory
            this.memoryConfigs.set(guildId, config);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Speichern der Guild-Konfiguration', error);
            return false;
        }
    }

    // Additional utility methods
    public async loadGuildConfigFromDatabase(guildId: string): Promise<void> {
        if (!this.isConnected || !this.guildConfigsCollection) return;

        try {
            const config = await this.guildConfigsCollection.findOne({ guildId });
            if (config) {
                this.memoryConfigs.set(guildId, config);
            }
        } catch (error) {
            Logger.error('Fehler beim Laden der Guild-Konfiguration aus MongoDB', error);
        }
    }

    public async cleanupOldChannels(maxAge: number = 86400000): Promise<number> {
        try {
            const cutoffTime = new Date(Date.now() - maxAge);
            let cleanedCount = 0;

            if (this.isConnected && this.tempChannelsCollection) {
                const result = await this.tempChannelsCollection.deleteMany({
                    lastActivity: { $lt: cutoffTime }
                });
                cleanedCount += result.deletedCount || 0;
            }

            // Also clean memory
            for (const [guildId, guildChannels] of this.memoryChannels.entries()) {
                for (const [channelId, channelData] of guildChannels.entries()) {
                    const lastActivity = channelData.lastActivity || channelData.createdAt;
                    if (lastActivity < cutoffTime) {
                        guildChannels.delete(channelId);
                        cleanedCount++;
                    }
                }
                if (guildChannels.size === 0) {
                    this.memoryChannels.delete(guildId);
                }
            }

            return cleanedCount;
        } catch (error) {
            Logger.error('Fehler beim Cleanup alter Channels', error);
            return 0;
        }
    }

    public async getDatabaseStats(): Promise<DatabaseStats> {
        try {
            if (!this.isConnected || !this.db) {
                return {
                    totalDocuments: this.getTotalMemoryDocuments(),
                    totalSize: 0,
                    avgDocumentSize: 0,
                    indexCount: 0,
                    dataSize: 0,
                    storageSize: 0
                };
            }

            const tempChannelsStats = await this.db.collection('tempChannels').estimatedDocumentCount();
            const guildConfigsStats = await this.db.collection('guildConfigs').estimatedDocumentCount();

            // Note: stats() method doesn't exist on Collection type in newer MongoDB drivers
            // We'll use available methods instead
            
            return {
                totalDocuments: tempChannelsStats + guildConfigsStats,
                totalSize: 0, // Would need admin access to get this
                avgDocumentSize: 0, // Would need to calculate manually
                indexCount: 0, // Would need to query listIndexes()
                dataSize: 0, // Would need admin access
                storageSize: 0 // Would need admin access
            };
        } catch (error) {
            Logger.error('Fehler beim Abrufen der Datenbankstatistiken', error);
            return {
                totalDocuments: 0,
                totalSize: 0,
                avgDocumentSize: 0,
                indexCount: 0,
                dataSize: 0,
                storageSize: 0
            };
        }
    }

    private getTotalMemoryDocuments(): number {
        let total = 0;
        for (const guildChannels of this.memoryChannels.values()) {
            total += guildChannels.size;
        }
        return total + this.memoryConfigs.size;
    }

    // Health check
    public isHealthy(): boolean {
        if (this.isConnected) {
            return this.mongoClient !== null && this.db !== null;
        }
        return true; // Memory mode is always "healthy"
    }

    public getConnectionInfo(): { connected: boolean; database: string; collections: number } {
        return {
            connected: this.isConnected,
            database: this.databaseName,
            collections: this.isConnected ? 2 : 0
        };
    }
}