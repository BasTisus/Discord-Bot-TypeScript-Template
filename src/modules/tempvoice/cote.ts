// src/modules/tempvoice/core.ts - Teil 5/8 Fortsetzung
// Core TempVoice Module Functions

import { 
    Guild,
    GuildMember,
    VoiceChannel,
    TextChannel,
    ChannelType,
    PermissionFlagsBits,
    VoiceState,
    Client
} from 'discord.js';
import { Logger } from '../../services/index.js';

interface ActivityLog {
    timestamp: Date;
    activity: string;
    userId: string;
    metadata?: any;
}

interface ChannelStats {
    totalChannels: number;
    activeChannels: number;
    channelsInTimeframe: number;
    memoryChannels: number;
    avgChannelLifetime: number;
    avgUsersPerChannel: number;
    totalBans: number;
    totalKicks: number;
    totalClaims: number;
    cleanupOperations: number;
    totalNameChanges: number;
    totalLimitChanges: number;
    totalLockChanges: number;
    totalVisibilityChanges: number;
    databaseSize: number;
    indexedChannels: number;
    orphanedChannels: number;
    topOwners: Array<{ ownerName: string; count: number }>;
    trendingActivities?: Array<{ type: string; count: number }>;
    peakHours?: Array<{ hour: number; count: number }>;
}

export class TempVoiceCore {
    // Core Channel Management Functions
    public async createTempChannel(
        guild: Guild, 
        member: GuildMember, 
        creatorChannel: VoiceChannel,
        config: any
    ): Promise<{ voiceChannel: VoiceChannel; textChannel: TextChannel } | null> {
        try {
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
                            PermissionFlagsBits.MoveMembers,
                            PermissionFlagsBits.MuteMembers,
                            PermissionFlagsBits.DeafenMembers
                        ],
                    }
                ]
            });

            // Create text channel
            const textChannel = await guild.channels.create({
                name: `💬${channelName}`,
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
                            PermissionFlagsBits.ManageMessages,
                            PermissionFlagsBits.ManageChannels
                        ],
                    }
                ]
            });

            // Move member to new channel
            await member.voice.setChannel(voiceChannel);

            // Store channel data
            const tempChannelData = {
                voiceChannelId: voiceChannel.id,
                textChannelId: textChannel.id,
                ownerId: member.id,
                ownerName: member.displayName,
                maxUsers: config.defaultMaxUsers,
                isVisible: true,
                isLocked: false,
                bannedUsers: [],
                createdAt: new Date(),
                guildId: guild.id,
                activityLog: []
            };

            await this.setTempChannel(guild.id, voiceChannel.id, tempChannelData);
            await this.updateTempChannelActivity(guild.id, voiceChannel.id, 'channel_created', member.id);

            Logger.info(`✅ Temp-Channel erstellt: ${channelName} für ${member.displayName} (${member.id})`);
            return { voiceChannel, textChannel };
        } catch (error) {
            Logger.error('Fehler beim Erstellen des Temp-Channels', error);
            return null;
        }
    }

    public async deleteEmptyTempChannel(guild: Guild, channelId: string): Promise<boolean> {
        try {
            const tempChannelData = this.getTempChannel(guild.id, channelId);
            if (!tempChannelData) return false;

            // Delete voice channel
            const voiceChannel = guild.channels.cache.get(channelId);
            if (voiceChannel) {
                await voiceChannel.delete('TempVoice: Channel leer - automatische Löschung');
            }

            // Delete text channel
            const textChannel = guild.channels.cache.get(tempChannelData.textChannelId);
            if (textChannel) {
                await textChannel.delete('TempVoice: Voice-Channel gelöscht');
            }

            // Remove from database/memory
            await this.deleteTempChannel(guild.id, channelId);
            
            Logger.info(`🗑️ Temp-Channel gelöscht: ${channelId} (leer)`);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Löschen des leeren Temp-Channels', error);
            return false;
        }
    }

    public async updateOwnerPermissions(
        voiceChannel: VoiceChannel, 
        textChannel: TextChannel, 
        newOwner: GuildMember, 
        oldOwnerId?: string
    ): Promise<void> {
        try {
            // Remove old owner permissions
            if (oldOwnerId) {
                await voiceChannel.permissionOverwrites.delete(oldOwnerId);
                if (textChannel) {
                    await textChannel.permissionOverwrites.delete(oldOwnerId);
                }
            }

            // Set new owner permissions
            await voiceChannel.permissionOverwrites.create(newOwner, {
                ViewChannel: true,
                Connect: true,
                Speak: true,
                ManageChannels: true,
                MoveMembers: true,
                MuteMembers: true,
                DeafenMembers: true
            });

            if (textChannel) {
                await textChannel.permissionOverwrites.create(newOwner, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true,
                    ManageMessages: true,
                    ManageChannels: true
                });
            }
        } catch (error) {
            Logger.error('Fehler beim Aktualisieren der Owner-Permissions', error);
        }
    }

    // Voice State Update Handler
    public async handleVoiceStateUpdate(
        oldState: VoiceState, 
        newState: VoiceState, 
        client: Client
    ): Promise<void> {
        try {
            const member = newState.member || oldState.member;
            if (!member || member.user.bot) return;

            const guild = newState.guild || oldState.guild;
            const config = this.getGuildConfig(guild.id);

            // User joined a voice channel
            if (!oldState.channel && newState.channel) {
                await this.handleUserJoinedVoice(newState.channel, member, config);
            }

            // User left a voice channel
            if (oldState.channel && !newState.channel) {
                await this.handleUserLeftVoice(oldState.channel, member, client);
            }

            // User moved between channels
            if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
                await this.handleUserLeftVoice(oldState.channel, member, client);
                await this.handleUserJoinedVoice(newState.channel, member, config);
            }

            // Update text channel permissions for temp channels
            await this.updateTextChannelPermissions(oldState, newState);

        } catch (error) {
            Logger.error('Fehler im VoiceStateUpdate Handler', error);
        }
    }

    private async handleUserJoinedVoice(
        channel: VoiceChannel, 
        member: GuildMember, 
        config: any
    ): Promise<void> {
        // Check if this is a creator channel
        if (config.creatorChannels.includes(channel.id)) {
            await this.createTempChannel(channel.guild, member, channel, config);
            return;
        }

        // Update activity for temp channels
        const tempChannelData = this.getTempChannel(channel.guild.id, channel.id);
        if (tempChannelData) {
            await this.updateTempChannelActivity(
                channel.guild.id, 
                channel.id, 
                'user_joined', 
                member.id
            );
        }
    }

    private async handleUserLeftVoice(
        channel: VoiceChannel, 
        member: GuildMember, 
        client: Client
    ): Promise<void> {
        const tempChannelData = this.getTempChannel(channel.guild.id, channel.id);
        if (!tempChannelData) return;

        // Log user left
        await this.updateTempChannelActivity(
            channel.guild.id, 
            channel.id, 
            'user_left', 
            member.id
        );

        // Check if channel is now empty
        if (channel.members.size === 0) {
            await this.deleteEmptyTempChannel(channel.guild, channel.id);
        }
    }

    private async updateTextChannelPermissions(
        oldState: VoiceState, 
        newState: VoiceState
    ): Promise<void> {
        try {
            const member = newState.member || oldState.member;
            if (!member) return;

            // Handle old channel text permissions
            if (oldState.channel) {
                const oldTempData = this.getTempChannel(oldState.guild.id, oldState.channel.id);
                if (oldTempData) {
                    const textChannel = oldState.guild.channels.cache.get(oldTempData.textChannelId) as TextChannel;
                    if (textChannel && !oldState.channel.members.has(member.id)) {
                        // Remove text channel access if user is no longer in voice
                        await textChannel.permissionOverwrites.delete(member.id);
                    }
                }
            }

            // Handle new channel text permissions
            if (newState.channel) {
                const newTempData = this.getTempChannel(newState.guild.id, newState.channel.id);
                if (newTempData) {
                    const textChannel = newState.guild.channels.cache.get(newTempData.textChannelId) as TextChannel;
                    if (textChannel) {
                        // Grant text channel access to voice members
                        await textChannel.permissionOverwrites.create(member, {
                            ViewChannel: true,
                            SendMessages: true,
                            ReadMessageHistory: true
                        });
                    }
                }
            }
        } catch (error) {
            Logger.error('Fehler beim Aktualisieren der Text-Channel Permissions', error);
        }
    }

    // Activity Logging
    public async updateTempChannelActivity(
        guildId: string, 
        channelId: string, 
        activity: string, 
        userId: string,
        metadata?: any
    ): Promise<void> {
        try {
            const tempChannelData = this.getTempChannel(guildId, channelId);
            if (!tempChannelData) return;

            if (!tempChannelData.activityLog) {
                tempChannelData.activityLog = [];
            }

            const activityEntry: ActivityLog = {
                timestamp: new Date(),
                activity,
                userId,
                metadata
            };

            tempChannelData.activityLog.push(activityEntry);

            // Keep only last 50 activities
            if (tempChannelData.activityLog.length > 50) {
                tempChannelData.activityLog = tempChannelData.activityLog.slice(-50);
            }

            await this.setTempChannel(guildId, channelId, tempChannelData);
        } catch (error) {
            Logger.error('Fehler beim Aktualisieren der Channel-Aktivität', error);
        }
    }

    public async getChannelActivity(
        guildId: string, 
        channelId: string, 
        limit: number = 10
    ): Promise<ActivityLog[]> {
        try {
            const tempChannelData = this.getTempChannel(guildId, channelId);
            if (!tempChannelData || !tempChannelData.activityLog) return [];

            return tempChannelData.activityLog
                .slice(-limit)
                .reverse();
        } catch (error) {
            Logger.error('Fehler beim Abrufen der Channel-Aktivität', error);
            return [];
        }
    }

    // Statistics Functions
    public async getDetailedStats(guildId: string, timeframe: string = 'all'): Promise<ChannelStats> {
        try {
            const allChannels = await this.getAllTempChannels(guildId);
            const now = new Date();
            let timeframeCutoff = new Date(0);

            // Calculate timeframe cutoff
            switch (timeframe) {
                case 'today':
                    timeframeCutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    break;
                case 'week':
                    timeframeCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case 'month':
                    timeframeCutoff = new Date(now.getFullYear(), now.getMonth(), 1);
                    break;
                default:
                    timeframeCutoff = new Date(0);
            }

            const channelsInTimeframe = allChannels.filter(
                channel => channel.createdAt >= timeframeCutoff
            );

            // Calculate statistics
            const activeChannels = allChannels.filter(channel => {
                // This would need to be checked against actual Discord channels
                return true; // Placeholder
            }).length;

            const totalLifetime = allChannels.reduce(
                (sum, channel) => sum + (now.getTime() - channel.createdAt.getTime()), 0
            );
            const avgChannelLifetime = allChannels.length > 0 ? totalLifetime / allChannels.length : 0;

            // Count activities
            let totalBans = 0, totalKicks = 0, totalClaims = 0;
            let totalNameChanges = 0, totalLimitChanges = 0;
            let totalLockChanges = 0, totalVisibilityChanges = 0;

            const ownerCounts = new Map<string, number>();

            allChannels.forEach(channel => {
                // Count owner occurrences
                const currentCount = ownerCounts.get(channel.ownerName) || 0;
                ownerCounts.set(channel.ownerName, currentCount + 1);

                // Count activities
                if (channel.activityLog) {
                    channel.activityLog.forEach(log => {
                        switch (log.activity) {
                            case 'user_banned': totalBans++; break;
                            case 'user_kicked': totalKicks++; break;
                            case 'channel_claimed': totalClaims++; break;
                            case 'name_changed': totalNameChanges++; break;
                            case 'limit_changed': totalLimitChanges++; break;
                            case 'channel_locked':
                            case 'channel_unlocked': totalLockChanges++; break;
                            case 'channel_hidden':
                            case 'channel_shown': totalVisibilityChanges++; break;
                        }
                    });
                }
            });

            const topOwners = Array.from(ownerCounts.entries())
                .map(([ownerName, count]) => ({ ownerName, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10);

            const stats: ChannelStats = {
                totalChannels: allChannels.length,
                activeChannels,
                channelsInTimeframe: channelsInTimeframe.length,
                memoryChannels: allChannels.length, // In memory mode
                avgChannelLifetime,
                avgUsersPerChannel: 2.5, // Placeholder
                totalBans,
                totalKicks,
                totalClaims,
                cleanupOperations: 0, // Would need to be tracked separately
                totalNameChanges,
                totalLimitChanges,
                totalLockChanges,
                totalVisibilityChanges,
                databaseSize: 0.5, // Placeholder MB
                indexedChannels: allChannels.length,
                orphanedChannels: 0, // Would need to be calculated
                topOwners
            };

            return stats;
        } catch (error) {
            Logger.error('Fehler beim Abrufen der detaillierten Statistiken', error);
            throw error;
        }
    }

    // Abstract methods (to be implemented by specific storage implementations)
    protected abstract getTempChannel(guildId: string, channelId: string): any;
    protected abstract setTempChannel(guildId: string, channelId: string, data: any): Promise<void>;
    protected abstract deleteTempChannel(guildId: string, channelId: string): Promise<void>;
    protected abstract getAllTempChannels(guildId: string): Promise<any[]>;
    protected abstract getGuildConfig(guildId: string): any;
    protected abstract saveGuildConfig(guildId: string, config: any): Promise<boolean>;
}