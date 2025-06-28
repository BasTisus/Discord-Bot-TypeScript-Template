// src/modules/tempvoice/cote.ts - Korrigierte Core TempVoice Module Functions

import { 
    Guild,
    GuildMember,
    VoiceChannel,
    TextChannel,
    ChannelType,
    PermissionFlagsBits,
    VoiceState,
    Client,
    VoiceBasedChannel,
    StageChannel
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

// Abstrakte Basisklasse für TempVoice Core
export abstract class TempVoiceCore {
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

            // Create text channel if enabled
            let textChannel: TextChannel | null = null;
            if (config.createTextChannel !== false) {
                textChannel = await guild.channels.create({
                    name: `📝-${channelName.toLowerCase().replace(/\s+/g, '-')}`,
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
                                PermissionFlagsBits.ManageChannels,
                                PermissionFlagsBits.ManageMessages
                            ],
                        }
                    ]
                });
            }

            // Move member to new channel
            if (member.voice.channelId === creatorChannel.id) {
                await member.voice.setChannel(voiceChannel);
            }

            // Store channel data
            const channelData = {
                voiceChannelId: voiceChannel.id,
                textChannelId: textChannel?.id || null,
                ownerId: member.id,
                ownerName: member.displayName,
                maxUsers: config.defaultMaxUsers || 0,
                isVisible: true,
                isLocked: false,
                bannedUsers: [],
                createdAt: new Date(),
                guildId: guild.id,
                lastActivity: new Date(),
                activityLog: [{
                    activity: 'channel_created',
                    userId: member.id,
                    timestamp: new Date()
                }]
            };

            await this.setTempChannel(guild.id, voiceChannel.id, channelData);

            Logger.info(`TempVoice: Channel erstellt - ${voiceChannel.name} (${voiceChannel.id}) für ${member.displayName}`);

            return { voiceChannel, textChannel: textChannel! };
        } catch (error) {
            Logger.error('Fehler beim Erstellen des TempVoice-Channels', error);
            return null;
        }
    }

    // Voice State Update Handler - korrigiert für VoiceBasedChannel
    public async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState, client: Client): Promise<void> {
        try {
            const member = newState.member || oldState.member;
            if (!member || member.user.bot) return;

            const guild = newState.guild || oldState.guild;
            const config = this.getGuildConfig(guild.id);

            // User joined a voice channel
            if (!oldState.channel && newState.channel) {
                await this.handleUserJoinedVoice(newState.channel as VoiceChannel, member, config);
            }
            // User left a voice channel
            else if (oldState.channel && !newState.channel) {
                await this.handleUserLeftVoice(oldState.channel as VoiceChannel, member, client);
            }
            // User moved between channels
            else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
                await this.handleUserLeftVoice(oldState.channel as VoiceChannel, member, client);
                await this.handleUserJoinedVoice(newState.channel as VoiceChannel, member, config);
            }
        } catch (error) {
            Logger.error('Fehler beim Verarbeiten des Voice State Updates', error);
        }
    }

    // User joined a voice channel - korrigierte Typisierung
    private async handleUserJoinedVoice(channel: VoiceChannel, member: GuildMember, config: any): Promise<void> {
        try {
            // Check if this is a creator channel
            if (config.creatorChannels?.includes(channel.id)) {
                const result = await this.createTempChannel(channel.guild, member, channel, config);
                if (result) {
                    Logger.info(`TempVoice: Neuer Channel für ${member.displayName} erstellt`);
                }
                return;
            }

            // Check if this is a temp channel
            const tempChannelData = this.getTempChannel(channel.guild.id, channel.id);
            if (tempChannelData) {
                // Update last activity
                tempChannelData.lastActivity = new Date();
                tempChannelData.activityLog?.push({
                    activity: 'user_joined',
                    userId: member.id,
                    timestamp: new Date()
                });

                await this.setTempChannel(channel.guild.id, channel.id, tempChannelData);

                // Give text channel access if exists
                if (tempChannelData.textChannelId) {
                    const textChannel = channel.guild.channels.cache.get(tempChannelData.textChannelId) as TextChannel;
                    if (textChannel) {
                        await textChannel.permissionOverwrites.edit(member.id, {
                            ViewChannel: true,
                            SendMessages: true,
                            ReadMessageHistory: true
                        });
                    }
                }
            }
        } catch (error) {
            Logger.error('Fehler beim Verarbeiten des Channel-Beitritts', error);
        }
    }

    // User left a voice channel - korrigierte Typisierung
    private async handleUserLeftVoice(channel: VoiceChannel, member: GuildMember, client: Client): Promise<void> {
        try {
            const tempChannelData = this.getTempChannel(channel.guild.id, channel.id);
            if (!tempChannelData) return;

            // Update activity log
            tempChannelData.lastActivity = new Date();
            tempChannelData.activityLog?.push({
                activity: 'user_left',
                userId: member.id,
                timestamp: new Date()
            });

            await this.setTempChannel(channel.guild.id, channel.id, tempChannelData);

            // Remove text channel access
            if (tempChannelData.textChannelId) {
                const textChannel = channel.guild.channels.cache.get(tempChannelData.textChannelId) as TextChannel;
                if (textChannel) {
                    await textChannel.permissionOverwrites.delete(member.id);
                }
            }

            // Check if channel is empty
            if (channel.members.size === 0) {
                Logger.info(`TempVoice: Leerer Channel erkannt - ${channel.name} (${channel.id})`);
                await this.deleteEmptyTempChannel(channel.guild, channel.id);
            }
            // Transfer ownership if owner left but channel not empty
            else if (tempChannelData.ownerId === member.id) {
                const newOwner = channel.members.first();
                if (newOwner && !newOwner.user.bot) {
                    tempChannelData.ownerId = newOwner.id;
                    tempChannelData.ownerName = newOwner.displayName;
                    tempChannelData.activityLog?.push({
                        activity: 'ownership_transferred',
                        userId: newOwner.id,
                        timestamp: new Date()
                    });

                    await this.setTempChannel(channel.guild.id, channel.id, tempChannelData);

                    // Update channel permissions for new owner
                    await channel.permissionOverwrites.edit(newOwner.id, {
                        ManageChannels: true,
                        MoveMembers: true,
                        MuteMembers: true,
                        DeafenMembers: true
                    });

                    Logger.info(`TempVoice: Besitzer übertragen - ${channel.name} → ${newOwner.displayName}`);
                }
            }
        } catch (error) {
            Logger.error('Fehler beim Verarbeiten des Channel-Verlassens', error);
        }
    }

    // Delete empty temp channel
    public async deleteEmptyTempChannel(guild: Guild, channelId: string): Promise<boolean> {
        try {
            const tempChannelData = this.getTempChannel(guild.id, channelId);
            if (!tempChannelData) return false;

            // Delete voice channel
            const voiceChannel = guild.channels.cache.get(channelId);
            if (voiceChannel) {
                await voiceChannel.delete('TempVoice: Channel ist leer');
            }

            // Delete text channel if exists
            if (tempChannelData.textChannelId) {
                const textChannel = guild.channels.cache.get(tempChannelData.textChannelId);
                if (textChannel) {
                    await textChannel.delete('TempVoice: Voice-Channel gelöscht');
                }
            }

            // Remove from storage
            await this.deleteTempChannel(guild.id, channelId);

            Logger.info(`TempVoice: Channel gelöscht - ${channelId}`);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Löschen des leeren Channels', error);
            return false;
        }
    }

    // Get detailed statistics
    public async getDetailedStats(guildId: string, timeframe?: string): Promise<ChannelStats> {
        try {
            const allChannels = await this.getAllTempChannels(guildId);
            const now = new Date();
            let timeframeStart = new Date(0); // Default: all time

            switch (timeframe) {
                case 'today':
                    timeframeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    break;
                case 'week':
                    timeframeStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case 'month':
                    timeframeStart = new Date(now.getFullYear(), now.getMonth(), 1);
                    break;
            }

            const channelsInTimeframe = allChannels.filter(ch => 
                new Date(ch.createdAt) >= timeframeStart
            );

            // Calculate statistics
            const totalLifetime = allChannels.reduce((sum, ch) => {
                const lifetime = (ch.lastActivity ? new Date(ch.lastActivity) : now).getTime() - new Date(ch.createdAt).getTime();
                return sum + lifetime;
            }, 0);

            const avgLifetime = allChannels.length > 0 ? totalLifetime / allChannels.length : 0;

            // Count activities from logs
            let totalBans = 0;
            let totalKicks = 0;
            let totalClaims = 0;
            let totalNameChanges = 0;
            let totalLimitChanges = 0;
            let totalLockChanges = 0;
            let totalVisibilityChanges = 0;

            const ownerCounts = new Map<string, number>();

            for (const channel of allChannels) {
                // Count owner occurrences
                const ownerName = channel.ownerName || 'Unknown';
                ownerCounts.set(ownerName, (ownerCounts.get(ownerName) || 0) + 1);

                // Count activities
                if (channel.activityLog) {
                    for (const log of channel.activityLog) {
                        switch (log.activity) {
                            case 'user_banned': totalBans++; break;
                            case 'user_kicked': totalKicks++; break;
                            case 'channel_claimed': totalClaims++; break;
                            case 'channel_renamed': totalNameChanges++; break;
                            case 'limit_changed': totalLimitChanges++; break;
                            case 'channel_locked':
                            case 'channel_unlocked': totalLockChanges++; break;
                            case 'channel_hidden':
                            case 'channel_shown': totalVisibilityChanges++; break;
                        }
                    }
                }
            }

            // Top owners
            const topOwners = Array.from(ownerCounts.entries())
                .map(([ownerName, count]) => ({ ownerName, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10);

            const stats: ChannelStats = {
                totalChannels: allChannels.length,
                activeChannels: allChannels.filter(ch => {
                    const lastActivity = ch.lastActivity ? new Date(ch.lastActivity) : new Date(ch.createdAt);
                    return now.getTime() - lastActivity.getTime() < 30 * 60 * 1000; // Active if used in last 30 min
                }).length,
                channelsInTimeframe: channelsInTimeframe.length,
                memoryChannels: allChannels.length, // All are in memory
                avgChannelLifetime: Math.round(avgLifetime / 1000 / 60), // in minutes
                avgUsersPerChannel: 2.5, // Would need to be calculated from actual data
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

    // Abstract methods - müssen von Implementierungen überschrieben werden
    protected abstract getTempChannel(guildId: string, channelId: string): any;
    protected abstract setTempChannel(guildId: string, channelId: string, data: any): Promise<void>;
    protected abstract deleteTempChannel(guildId: string, channelId: string): Promise<void>;
    protected abstract getAllTempChannels(guildId: string): Promise<any[]>;
    protected abstract getGuildConfig(guildId: string): any;
    protected abstract saveGuildConfig(guildId: string, config: any): Promise<boolean>;
}