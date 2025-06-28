// src/modules/tempvoice/storage.ts - Teil 6/8
// MongoDB Storage Implementation für TempVoice

import { MongoClient, Db, Collection } from 'mongodb';
import { Logger } from '../../services/index.js';
import { TempVoiceCore } from './core.js';

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
    private client: MongoClient | null = null;
    private db: Db | null = null;
    private tempChannelsCollection: Collection<TempChannelDocument> | null = null;
    private guildConfigsCollection: Collection<GuildConfigDocument> | null = null;
    private isConnected: boolean = false;
    private connectionString: string;
    private databaseName: string;

    // Fallback Memory Storage
    private memoryChannels = new Map<string, Map<string, TempChannelDocument>>();
    private memoryConfigs = new Map<string, GuildConfigDocument>();

    constructor(connectionString?: string, databaseName: string = 'discord_bot') {
        super();
        this.connectionString = connectionString || process.env.MONGODB_URI || '';
        this.databaseName = databaseName;
        
        if (this.connectionString) {
            this.initializeDatabase();
        } else {
            Logger.warn('⚠️ Keine MongoDB-Verbindung konfiguriert, verwende Memory-Storage');
        }
    }

    // Database Initialization
    private async initializeDatabase(): Promise<void> {
        try {
            Logger.info('🔄 Verbinde mit MongoDB...');
            
            this.client = new MongoClient(this.connectionString, {
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
            });

            await this.client.connect();
            this.db = this.client.db(this.databaseName);
            
            // Initialize Collections
            this.tempChannelsCollection = this.db.collection<TempChannelDocument>('tempChannels');
            this.guildConfigsCollection = this.db.collection<GuildConfigDocument>('guildConfigs');

            // Create Indexes
            await this.createIndexes();
            
            this.isConnected = true;
            Logger.info('✅ MongoDB erfolgreich verbunden und initialisiert');
            
            // Migrate memory data if exists
            await this.migrateMemoryToDatabase();
            
        } catch (error) {
            Logger.error('❌ MongoDB-Verbindung fehlgeschlagen, verwende Memory-Storage', error);
            this.isConnected = false;
        }
    }

    private async createIndexes(): Promise<void> {
        try {
            if (!this.tempChannelsCollection || !this.guildConfigsCollection) return;

            // TempChannels Indexes
            await this.tempChannelsCollection.createIndex({ guildId: 1, voiceChannelId: 1 }, { unique: true });
            await this.tempChannelsCollection.createIndex({ guildId: 1 });
            await this.tempChannelsCollection.createIndex({ ownerId: 1 });
            await this.tempChannelsCollection.createIndex({ createdAt: 1 });
            await this.tempChannelsCollection.createIndex({ lastActivity: 1 });
            await this.tempChannelsCollection.createIndex({ 'activityLog.timestamp': 1 });

            // GuildConfigs Indexes
            await this.guildConfigsCollection.createIndex({ guildId: 1 }, { unique: true });
            await this.guildConfigsCollection.createIndex({ 'creatorChannels': 1 });

            Logger.info('📊 MongoDB-Indexe erfolgreich erstellt');
        } catch (error) {
            Logger.error('Fehler beim Erstellen der MongoDB-Indexe', error);
        }
    }

    private async migrateMemoryToDatabase(): Promise<void> {
        if (!this.isConnected || this.memoryChannels.size === 0) return;

        try {
            Logger.info('🔄 Migriere Memory-Daten zu MongoDB...');
            let migratedCount = 0;

            for (const [guildId, guildChannels] of this.memoryChannels) {
                for (const [channelId, channelData] of guildChannels) {
                    await this.setTempChannelInDatabase(guildId, channelId, channelData);
                    migratedCount++;
                }
            }

            for (const [guildId, configData] of this.memoryConfigs) {
                await this.saveGuildConfigInDatabase(guildId, configData);
            }

            // Clear memory after successful migration
            this.memoryChannels.clear();
            this.memoryConfigs.clear();

            Logger.info(`✅ ${migratedCount} Channels erfolgreich zu MongoDB migriert`);
        } catch (error) {
            Logger.error('Fehler bei der Migration zu MongoDB', error);
        }
    }

    // TempChannel CRUD Operations
    protected getTempChannel(guildId: string, channelId: string): TempChannelDocument | null {
        if (this.isConnected) {
            // For synchronous access, we'll need to implement caching
            // For now, return from memory fallback
            const guildChannels = this.memoryChannels.get(guildId);
            return guildChannels?.get(channelId) || null;
        } else {
            const guildChannels = this.memoryChannels.get(guildId);
            return guildChannels?.get(channelId) || null;
        }
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
            
            // Also remove from memory cache
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
            return await this.getAllTempChannelsFromMemory(guildId);
        }
    }

    private async getAllTempChannelsFromDatabase(guildId: string): Promise<TempChannelDocument[]> {
        try {
            if (!this.tempChannelsCollection) throw new Error('TempChannels collection not initialized');

            const channels = await this.tempChannelsCollection.find({ guildId }).toArray();
            
            // Update memory cache
            const guildChannels = new Map<string, TempChannelDocument>();
            channels.forEach(channel => {
                guildChannels.set(channel.voiceChannelId, channel);
            });
            this.memoryChannels.set(guildId, guildChannels);
            
            return channels;
        } catch (error) {
            Logger.error('Fehler beim Abrufen der TempChannels aus MongoDB', error);
            return await this.getAllTempChannelsFromMemory(guildId);
        }
    }

    private async getAllTempChannelsFromMemory(guildId: string): Promise<TempChannelDocument[]> {
        const guildChannels = this.memoryChannels.get(guildId);
        return guildChannels ? Array.from(guildChannels.values()) : [];
    }

    // Guild Config Operations
    protected getGuildConfig(guildId: string): GuildConfigDocument {
        if (this.isConnected) {
            // Use memory cache or fetch from database
            let config = this.memoryConfigs.get(guildId);
            if (!config) {
                // Async fetch would be needed here, for now use default
                config = this.getDefaultGuildConfig(guildId);
                this.memoryConfigs.set(guildId, config);
            }
            return config;
        } else {
            let config = this.memoryConfigs.get(guildId);
            if (!config) {
                config = this.getDefaultGuildConfig(guildId);
                this.memoryConfigs.set(guildId, config);
            }
            return config;
        }
    }

    private getDefaultGuildConfig(guildId: string): GuildConfigDocument {
        return {
            guildId,
            creatorChannels: [],
            defaultMaxUsers: 5,
            cleanupInterval: 300000, // 5 minutes
            autoDeleteText: true,
            lastCleanup: new Date(),
            settings: {
                allowUserLimit: true,
                allowRename: true,
                allowVisibilityToggle: true,
                allowLocking: true,
                maxBannedUsers: 50,
                maxChannelLifetime: 86400000 // 24 hours
            }
        };
    }

    protected async saveGuildConfig(guildId: string, configData: Partial<GuildConfigDocument>): Promise<boolean> {
        if (this.isConnected) {
            return await this.saveGuildConfigInDatabase(guildId, configData);
        } else {
            return await this.saveGuildConfigInMemory(guildId, configData);
        }
    }

    private async saveGuildConfigInDatabase(guildId: string, configData: Partial<GuildConfigDocument>): Promise<boolean> {
        try {
            if (!this.guildConfigsCollection) throw new Error('GuildConfigs collection not initialized');

            const updateData = {
                ...configData,
                guildId,
                lastUpdated: new Date()
            };

            await this.guildConfigsCollection.replaceOne(
                { guildId },
                updateData as GuildConfigDocument,
                { upsert: true }
            );

            // Update memory cache
            await this.saveGuildConfigInMemory(guildId, configData);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Speichern der Guild-Config in MongoDB', error);
            return await this.saveGuildConfigInMemory(guildId, configData);
        }
    }

    private async saveGuildConfigInMemory(guildId: string, configData: Partial<GuildConfigDocument>): Promise<boolean> {
        try {
            const existingConfig = this.memoryConfigs.get(guildId) || this.getDefaultGuildConfig(guildId);
            const updatedConfig = { ...existingConfig, ...configData, guildId } as GuildConfigDocument;
            this.memoryConfigs.set(guildId, updatedConfig);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Speichern der Config im Memory', error);
            return false;
        }
    }

    // Advanced Database Operations
    public async getDatabaseStats(): Promise<DatabaseStats> {
        if (!this.isConnected || !this.db) {
            return {
                totalDocuments: this.memoryChannels.size,
                totalSize: 0,
                avgDocumentSize: 0,
                indexCount: 0,
                dataSize: 0,
                storageSize: 0
            };
        }

        try {
            const tempChannelsStats = await this.db.collection('tempChannels').stats();
            const guildConfigsStats = await this.db.collection('guildConfigs').stats();

            return {
                totalDocuments: tempChannelsStats.count + guildConfigsStats.count,
                totalSize: tempChannelsStats.size + guildConfigsStats.size,
                avgDocumentSize: tempChannelsStats.avgObjSize || 0,
                indexCount: tempChannelsStats.nindexes + guildConfigsStats.nindexes,
                dataSize: tempChannelsStats.size + guildConfigsStats.size,
                storageSize: tempChannelsStats.storageSize + guildConfigsStats.storageSize
            };
        } catch (error) {
            Logger.error('Fehler beim Abrufen der Datenbankstatistiken', error);
            throw error;
        }
    }

    public async cleanupOldChannels(maxAge: number = 86400000): Promise<number> {
        const cutoffDate = new Date(Date.now() - maxAge);
        let cleanedCount = 0;

        if (this.isConnected && this.tempChannelsCollection) {
            try {
                const result = await this.tempChannelsCollection.deleteMany({
                    createdAt: { $lt: cutoffDate }
                });
                cleanedCount = result.deletedCount || 0;
                Logger.info(`🧹 MongoDB: ${cleanedCount} alte Channels bereinigt`);
            } catch (error) {
                Logger.error('Fehler beim Bereinigen alter Channels in MongoDB', error);
            }
        }

        // Also clean memory
        for (const [guildId, guildChannels] of this.memoryChannels) {
            for (const [channelId, channelData] of guildChannels) {
                if (channelData.createdAt < cutoffDate) {
                    guildChannels.delete(channelId);
                    cleanedCount++;
                }
            }
            if (guildChannels.size === 0) {
                this.memoryChannels.delete(guildId);
            }
        }

        return cleanedCount;
    }

    public async getChannelsByOwner(guildId: string, ownerId: string): Promise<TempChannelDocument[]> {
        if (this.isConnected && this.tempChannelsCollection) {
            try {
                return await this.tempChannelsCollection.find({ guildId, ownerId }).toArray();
            } catch (error) {
                Logger.error('Fehler beim Abrufen der Channels nach Owner', error);
            }
        }

        // Fallback to memory
        const guildChannels = this.memoryChannels.get(guildId);
        if (!guildChannels) return [];

        return Array.from(guildChannels.values()).filter(channel => channel.ownerId === ownerId);
    }

    public async updateChannelActivity(guildId: string, channelId: string, activity: ActivityLogEntry): Promise<void> {
        if (this.isConnected && this.tempChannelsCollection) {
            try {
                await this.tempChannelsCollection.updateOne(
                    { guildId, voiceChannelId: channelId },
                    { 
                        $push: { 
                            activityLog: {
                                $each: [activity],
                                $slice: -50 // Keep only last 50 activities
                            }
                        },
                        $set: { lastActivity: new Date() }
                    }
                );
            } catch (error) {
                Logger.error('Fehler beim Aktualisieren der Channel-Aktivität', error);
            }
        }

        // Also update memory
        const channelData = this.getTempChannel(guildId, channelId);
        if (channelData) {
            if (!channelData.activityLog) channelData.activityLog = [];
            channelData.activityLog.push(activity);
            if (channelData.activityLog.length > 50) {
                channelData.activityLog = channelData.activityLog.slice(-50);
            }
            await this.setTempChannelInMemory(guildId, channelId, channelData);
        }
    }

    // Cleanup and Shutdown
    public async cleanup(): Promise<void> {
        Logger.info('🧹 TempVoice MongoDB Storage wird bereinigt...');
        
        try {
            // Clear memory
            this.memoryChannels.clear();
            this.memoryConfigs.clear();
            
            // Close MongoDB connection
            if (this.client) {
                await this.client.close();
                this.isConnected = false;
                Logger.info('📡 MongoDB-Verbindung geschlossen');
            }
        } catch (error) {
            Logger.error('Fehler beim Cleanup des MongoDB Storage', error);
        }
    }

    // Health Check
    public async healthCheck(): Promise<{ status: string; details: any }> {
        const details: any = {
            memoryChannels: this.memoryChannels.size,
            memoryConfigs: this.memoryConfigs.size,
            mongoConnected: this.isConnected
        };

        if (this.isConnected && this.db) {
            try {
                await this.db.admin().ping();
                details.mongoPing = 'OK';
                details.databaseName = this.databaseName;
            } catch (error) {
                details.mongoPing = 'FAILED';
                details.error = error;
                return { status: 'DEGRADED', details };
            }
        }

        const status = this.isConnected ? 'HEALTHY' : 'MEMORY_ONLY';
        return { status, details };
    }
}