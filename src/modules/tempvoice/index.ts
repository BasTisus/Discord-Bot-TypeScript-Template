// src/modules/tempvoice/index.ts - Temporäre Voice-Kanäle Modul mit MongoDB (FINAL KORRIGIERT - TEIL 1/4)
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
import { MongoClient, Db, Collection } from 'mongodb';
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
    
    // MongoDB Connection
    private mongoUri: string;
    private dbName: string;
    private configCollectionName = 'tempvoice_configs';
    private tempChannelsCollectionName = 'tempvoice_channels';
    
    private client: MongoClient | null = null;
    private db: Db | null = null;
    private configCollection: Collection<GuildConfig> | null = null;
    private tempChannelsCollection: Collection<TempChannelData> | null = null;
    
    // In-Memory Tracking für Performance (wird mit DB synchronisiert)
    private tempChannels = new Map<string, Map<string, TempChannelData>>();
    
    constructor() {
        this.mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
        this.dbName = process.env.MONGODB_DB_NAME || 'borety_bot';
        this.initMongo();
    }

    private async initMongo(): Promise<void> {
        try {
            this.client = new MongoClient(this.mongoUri);
            await this.client.connect();
            this.db = this.client.db(this.dbName);
            this.configCollection = this.db.collection<GuildConfig>(this.configCollectionName);
            this.tempChannelsCollection = this.db.collection<TempChannelData>(this.tempChannelsCollectionName);
            
            // Indices für bessere Performance
            await this.configCollection.createIndex({ guildId: 1 }, { unique: true });
            await this.tempChannelsCollection.createIndex({ guildId: 1, voiceChannelId: 1 }, { unique: true });
            await this.tempChannelsCollection.createIndex({ guildId: 1 });
            await this.tempChannelsCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 });
            
            // Lade bestehende Temp-Channels in Memory
            await this.loadTempChannelsFromDB();
            
            Logger.info('✅ TempVoice-Modul: MongoDB-Verbindung hergestellt');
        } catch (error) {
            Logger.error('❌ TempVoice-Modul: MongoDB-Verbindungsfehler', error);
            throw error;
        }
    }

    private async loadTempChannelsFromDB(): Promise<void> {
        try {
            if (!this.tempChannelsCollection) throw new Error('Collection not initialized');
            
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

    private async getGuildConfig(guildId: string): Promise<GuildConfig> {
        try {
            if (!this.configCollection) throw new Error('Collection not initialized');
            
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
            return {
                guildId,
                creatorChannels: [],
                defaultMaxUsers: 3,
                cleanupInterval: 30000
            };
        }
    }

    private async saveGuildConfig(guildId: string, configData: Partial<GuildConfig>): Promise<boolean> {
        try {
            if (!this.configCollection) throw new Error('Collection not initialized');
            
            const updateData = {
                ...configData,
                guildId,
                updatedAt: new Date()
            };
            
            const result = await this.configCollection.replaceOne(
                { guildId },
                updateData as GuildConfig,
                { upsert: true }
            );
            
            return result.acknowledged;
        } catch (error) {
            Logger.error('Fehler beim Speichern der TempVoice Config', error);
            return false;
        }
    }

    private async updateGuildConfig(guildId: string, updates: Partial<GuildConfig>): Promise<boolean> {
        try {
            if (!this.configCollection) throw new Error('Collection not initialized');
            
            const result = await this.configCollection.updateOne(
                { guildId },
                { 
                    $set: { 
                        ...updates, 
                        updatedAt: new Date() 
                    } 
                },
                { upsert: true }
            );
            
            return result.acknowledged;
        } catch (error) {
            Logger.error('Fehler beim Update der TempVoice Config', error);
            return false;
        }
    }

    private getTempChannel(guildId: string, channelId: string): TempChannelData | null {
        const guildChannels = this.tempChannels.get(guildId);
        return guildChannels ? guildChannels.get(channelId) || null : null;
    }
// Channel-Management Methoden (TEIL 2/4)

    private async setTempChannel(guildId: string, channelId: string, data: TempChannelData): Promise<boolean> {
        try {
            if (!this.tempChannelsCollection) throw new Error('Collection not initialized');
            
            // Update in MongoDB
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
            
            // Update in Memory
            if (!this.tempChannels.has(guildId)) {
                this.tempChannels.set(guildId, new Map());
            }
            this.tempChannels.get(guildId)!.set(channelId, channelData);
            
            return true;
        } catch (error) {
            Logger.error('Fehler beim Speichern des Temp-Channels', error);
            return false;
        }
    }

    private async deleteTempChannel(guildId: string, channelId: string): Promise<boolean> {
        try {
            if (!this.tempChannelsCollection) throw new Error('Collection not initialized');
            
            // Delete from MongoDB
            await this.tempChannelsCollection.deleteOne({
                guildId,
                voiceChannelId: channelId
            });
            
            // Delete from Memory
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

    private async getAllTempChannels(guildId: string): Promise<TempChannelData[]> {
        try {
            if (!this.tempChannelsCollection) return [];
            return await this.tempChannelsCollection.find({ guildId }).toArray();
        } catch (error) {
            Logger.error('Fehler beim Abrufen aller Temp-Channels', error);
            return [];
        }
    }

    private async isCreatorChannel(guildId: string, channelId: string): Promise<boolean> {
        const config = await this.getGuildConfig(guildId);
        return config.creatorChannels.includes(channelId);
    }

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
                guildId: guild.id
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
// Voice State Handler und Channel Info (TEIL 3/4)

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
            .setFooter({ text: 'Temp-Voice System • MongoDB • Automatische Löschung bei Leere' })
            .setTimestamp();

        await textChannel.send({ embeds: [embed] });
    }

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

    private async updateTempChannelActivity(guildId: string, channelId: string, activity: string, userId: string): Promise<void> {
        try {
            if (!this.tempChannelsCollection) return;
            
            await this.tempChannelsCollection.updateOne(
                { guildId, voiceChannelId: channelId },
                {
                    $set: {
                        lastActivity: new Date(),
                        updatedAt: new Date()
                    },
                    $push: {
                        activityLog: {
                            activity,
                            userId,
                            timestamp: new Date()
                        }
                    }
                }
            );
        } catch (error) {
            Logger.error('Fehler beim Update der Channel-Aktivität', error);
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
// Helper-Methoden, Cleanup und Statistics (TEIL 4/4)

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

    // Cleanup für Server-Neustart
    public async cleanupEmptyChannels(client: Client): Promise<void> {
        try {
            if (!this.tempChannelsCollection) return;
            
            // Hole alle Temp-Channels aus DB
            const allTempChannels = await this.tempChannelsCollection.find({}).toArray();
            
            for (const channelData of allTempChannels) {
                const guild = client.guilds.cache.get(channelData.guildId);
                if (!guild) {
                    // Guild nicht mehr verfügbar, lösche aus DB
                    await this.deleteTempChannel(channelData.guildId, channelData.voiceChannelId);
                    continue;
                }

                const voiceChannel = guild.channels.cache.get(channelData.voiceChannelId) as VoiceChannel;
                if (!voiceChannel || voiceChannel.members.size === 0) {
                    Logger.info(`🧹 Cleanup: Lösche leeren Channel ${channelData.voiceChannelId}`);
                    await this.deleteEmptyTempChannel(guild, channelData.voiceChannelId);
                }
            }
        } catch (error) {
            Logger.error('Fehler beim Cleanup leerer Channels', error);
        }
    }

    // Erweiterte Cleanup-Funktion für verwaiste Channels
    public async cleanupOrphanedChannels(client: Client): Promise<void> {
        try {
            if (!this.tempChannelsCollection) return;
            
            const allTempChannels = await this.tempChannelsCollection.find({}).toArray();
            let cleanedCount = 0;
            
            for (const channelData of allTempChannels) {
                const guild = client.guilds.cache.get(channelData.guildId);
                if (!guild) {
                    await this.deleteTempChannel(channelData.guildId, channelData.voiceChannelId);
                    cleanedCount++;
                    continue;
                }

                // Prüfe ob Voice-Channel noch existiert
                const voiceChannel = guild.channels.cache.get(channelData.voiceChannelId);
                const textChannel = guild.channels.cache.get(channelData.textChannelId);
                
                if (!voiceChannel) {
                    // Voice-Channel existiert nicht mehr, lösche auch Text-Channel und DB-Eintrag
                    if (textChannel) {
                        try {
                            await textChannel.delete('Voice-Channel nicht mehr vorhanden');
                        } catch (error) {
                            Logger.error('Fehler beim Löschen des verwaisten Text-Channels', error);
                        }
                    }
                    
                    await this.deleteTempChannel(channelData.guildId, channelData.voiceChannelId);
                    cleanedCount++;
                    Logger.info(`🧹 Verwaisten Channel bereinigt: ${channelData.voiceChannelId}`);
                }
            }
            
            if (cleanedCount > 0) {
                Logger.info(`✅ ${cleanedCount} verwaiste Channels bereinigt`);
            }
        } catch (error) {
            Logger.error('Fehler beim Cleanup verwaister Channels', error);
        }
    }

    // Statistiken für Admin-Dashboard
    public async getDetailedStats(guildId: string): Promise<{
        totalChannels: number;
        activeChannels: number;
        channelsToday: number;
        avgChannelLifetime: number;
        topOwners: Array<{ _id: string; count: number; ownerName: string }>;
        memoryChannels: number;
    }> {
        try {
            if (!this.tempChannelsCollection) {
                return {
                    totalChannels: 0,
                    activeChannels: 0,
                    channelsToday: 0,
                    avgChannelLifetime: 0,
                    topOwners: [],
                    memoryChannels: 0
                };
            }

            const [
                totalChannels,
                activeChannels,
                channelsToday,
                avgChannelLifetime,
                topOwners
            ] = await Promise.all([
                // Gesamtanzahl erstellter Channels
                this.tempChannelsCollection.countDocuments({ guildId }),
                
                // Aktuell aktive Channels
                this.tempChannelsCollection.countDocuments({ 
                    guildId,
                    // Nur Channels die noch existieren (basierend auf letzter Aktivität)
                    lastActivity: { $gte: new Date(Date.now() - 300000) } // 5 Minuten
                }),
                
                // Channels heute erstellt
                this.tempChannelsCollection.countDocuments({
                    guildId,
                    createdAt: { $gte: new Date(Date.now() - 86400000) } // 24 Stunden
                }),
                
                // Durchschnittliche Channel-Lebensdauer
                this.tempChannelsCollection.aggregate([
                    { $match: { guildId } },
                    { $group: {
                        _id: null,
                        avgLifetime: { $avg: { $subtract: ["$updatedAt", "$createdAt"] } }
                    }}
                ]).toArray(),
                
                // Top Channel-Ersteller
                this.tempChannelsCollection.aggregate([
                    { $match: { guildId } },
                    { $group: {
                        _id: "$ownerId",
                        count: { $sum: 1 },
                        ownerName: { $first: "$ownerName" }
                    }},
                    { $sort: { count: -1 } },
                    { $limit: 5 }
                ]).toArray()
            ]);

            return {
                totalChannels,
                activeChannels,
                channelsToday,
                avgChannelLifetime: avgChannelLifetime[0]?.avgLifetime || 0,
                topOwners,
                memoryChannels: this.tempChannels.get(guildId)?.size || 0
            };
        } catch (error) {
            Logger.error('Fehler beim Abrufen der detaillierten Stats', error);
            return {
                totalChannels: 0,
                activeChannels: 0,
                channelsToday: 0,
                avgChannelLifetime: 0,
                topOwners: [],
                memoryChannels: 0
            };
        }
    }

    // Bot Shutdown Cleanup
    public async cleanup(client: Client): Promise<void> {
        Logger.info('🧹 TempVoice-Modul wird bereinigt...');
        
        try {
            // Führe finales Cleanup durch
            await this.cleanupOrphanedChannels(client);
            
            // Schließe MongoDB-Verbindung
            if (this.client) {
                await this.client.close();
                Logger.info('✅ TempVoice MongoDB-Verbindung geschlossen');
            }
            
            // Leere Memory-Cache
            this.tempChannels.clear();
            
        } catch (error) {
            Logger.error('Fehler beim TempVoice Cleanup', error);
        }
    }

    // Initialisierung und Event Setup
    public init(client: Client): void {
        // Voice State Update Handler
        client.on('voiceStateUpdate', (oldState, newState) => {
            this.handleVoiceStateUpdate(oldState, newState, client);
        });

        // Cleanup Timer - alle 60 Sekunden
        setInterval(() => {
            this.cleanupEmptyChannels(client);
        }, 60000);

        // Erweiterte Cleanup alle 10 Minuten
        setInterval(() => {
            this.cleanupOrphanedChannels(client);
        }, 600000);

        Logger.info('✅ TempVoice-Modul (MongoDB) erfolgreich geladen - Alle Commands verfügbar');
        Logger.info('🔄 Automatische Löschung leerer Channels aktiviert (60s Intervall)');
        Logger.info('🧹 Erweiterte Cleanup-Routinen aktiviert (10min Intervall)');
        Logger.info('🗄️ MongoDB-Integration mit Activity-Logging aktiv');
        Logger.info('📊 Erweiterte Statistiken und Admin-Tools verfügbar');
        Logger.info('⚡ Memory + DB Synchronisation für optimale Performance');
    }
}

// Export der TempVoice-Modul Instanz
export const tempVoiceModule = new TempVoiceModule();