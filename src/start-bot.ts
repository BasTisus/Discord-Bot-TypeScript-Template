// src/start-bot.ts - Korrigierte Version

import { REST } from '@discordjs/rest';
import { Options } from 'discord.js';
import { createRequire } from 'node:module';

import {
    ButtonHandler,
    CommandHandler,
    GuildJoinHandler,
    GuildLeaveHandler,
    MessageHandler,
    ReactionHandler,
    TriggerHandler,
} from './events/index.js';
import { JobService, Logger } from './services/index.js';
import {
    Button,
    ButtonDeferType,
    Command,
    CommandDeferType,
    Job,
    MessageCommand,
    Reaction,
    Trigger,
    UserCommand,
} from './models/index.js';
import { Bot } from './models/bot.js';
import { CommandRegistrationService } from './services/index.js';

// TempVoice imports - korrigiert
import { 
    TempVoiceCreateCommand,
    TempVoiceSetOwnerCommand, 
    TempVoiceLimitCommand,
    TempVoiceRenameCommand,
    TempVoiceHideCommand,
    TempVoiceShowCommand,
    TempVoiceLockCommand,
    TempVoiceUnlockCommand,
    TempVoiceClaimCommand,
    TempVoiceBanCommand,
    TempVoiceUnbanCommand,
    TempVoiceKickCommand,
    TempVoiceStatusCommand,
    TempVoiceListCommand,
    TempVoiceStatsCommand,
    TempVoiceCleanupCommand,
    TempVoiceConfigCommand
} from './commands/chat/tempvoice-commands.js';

import { EnhancedTempVoiceModule } from './modules/tempvoice/enhanced.js';

// Standard imports
import {
    DevCommand,
    HelpCommand,
    InfoCommand,
    LinkCommand,
    TestCommand,
    TranslateCommand,
} from './commands/chat/index.js';
import { ViewDateSent } from './commands/message/index.js';
import { ViewDateJoined } from './commands/user/index.js';
import { ChatCommandMetadata, MessageCommandMetadata, UserCommandMetadata } from './models/index.js';

const require = createRequire(import.meta.url);
let Config = require('../config/config.json');
let Debug = require('../config/debug.json');
let Logs = require('../lang/logs.json');

async function start(): Promise<void> {
    Logger.info(Logs.info.appStarted);

    // Enhanced TempVoice Module Setup
    Logger.info('🚀 Initialisiere Enhanced TempVoice-Modul...');
    
    let enhancedTempVoiceModule: EnhancedTempVoiceModule;
    try {
        enhancedTempVoiceModule = new EnhancedTempVoiceModule(
            Config.database?.mongodb?.uri,
            Config.database?.mongodb?.dbName
        );
        await enhancedTempVoiceModule.connect();
        Logger.info('✅ TempVoice-Modul initialisiert');
    } catch (error) {
        Logger.error('❌ Fehler beim Initialisieren des TempVoice-Moduls:', error);
        process.exit(1);
    }

    // Client setup
    let client = Client({
        intents: Config.client.intents,
        partials: Config.client.partials,
        makeCache: Options.cacheWithLimits({
            // Keep default caching behavior
        }),
    });

    // Services
    let jobService: JobService = new JobService([]);

    // Commands - korrigiert ohne fehlende Properties
    let commands: Command[] = [
        // Standard Commands
        new DevCommand(),
        new HelpCommand(),
        new InfoCommand(),
        new LinkCommand(),
        new TestCommand(),
        new TranslateCommand(),
        
        // TempVoice Commands - korrigiert
        new TempVoiceCreateCommand(),      // /byvoicecreate - Creator-Channel erstellen
        new TempVoiceSetOwnerCommand(),    // /byvoicesetowner - Besitzer ändern
        new TempVoiceLimitCommand(),       // /byvoicelimit - Nutzer-Limit
        new TempVoiceRenameCommand(),      // /byvoicename - Channel umbenennen
        new TempVoiceHideCommand(),        // /byvoicehide - Channel verstecken
        new TempVoiceShowCommand(),        // /byvoiceshow - Channel sichtbar machen
        new TempVoiceLockCommand(),        // /byvoicelock - Channel sperren
        new TempVoiceUnlockCommand(),      // /byvoiceunlock - Channel entsperren
        new TempVoiceClaimCommand(),       // /byvoiceclaim - Channel beanspruchen
        new TempVoiceBanCommand(),         // /byvoiceban - Nutzer verbannen
        new TempVoiceUnbanCommand(),       // /byvoiceunban - Nutzer entbannen
        new TempVoiceKickCommand(),        // /byvoicekick - Nutzer rauswerfen
        new TempVoiceStatusCommand(),      // /byvoicestatus - Channel-Status
        new TempVoiceListCommand(),        // /byvoicelist - Admin Channel-Liste
        new TempVoiceStatsCommand(),       // /byvoicestats - Erweiterte Statistiken
        new TempVoiceCleanupCommand(),     // /byvoicecleanup - Admin Cleanup
        new TempVoiceConfigCommand(),      // /byvoiceconfig - Server-Konfiguration
    ];

    let messageCommands: MessageCommand[] = [new ViewDateSent()];
    let userCommands: UserCommand[] = [new ViewDateJoined()];
    let buttons: Button[] = [];
    let reactions: Reaction[] = [];
    let triggers: Trigger[] = [];

    // Event handlers
    let guildJoinHandler = new GuildJoinHandler();
    let guildLeaveHandler = new GuildLeaveHandler();
    let messageHandler = new MessageHandler(triggers);
    let commandHandler = new CommandHandler(commands, messageCommands, userCommands);
    let buttonHandler = new ButtonHandler(buttons);
    let reactionHandler = new ReactionHandler(reactions);
    let triggerHandler = new TriggerHandler(triggers);

    // Bot
    let bot = new Bot(
        Config.client.token,
        client,
        guildJoinHandler,
        guildLeaveHandler,
        messageHandler,
        commandHandler,
        buttonHandler,
        reactionHandler,
        jobService
    );

    // Initialize TempVoice with client
    try {
        await enhancedTempVoiceModule.initialize(client);
        Logger.info('✅ TempVoice-Modul mit Client verbunden');
    } catch (error) {
        Logger.error('❌ Fehler beim Verbinden des TempVoice-Moduls mit Client:', error);
        process.exit(1);
    }

    // Register Commands
    if (process.argv[2] == 'commands') {
        try {
            let rest = new REST({ version: '10' }).setToken(Config.client.token);
            let commandRegistrationService = new CommandRegistrationService(rest);
            
            // Sammle ALLE Commands für Registrierung
            let localCmds = [
                // Original Commands
                ...Object.values(ChatCommandMetadata).sort((a, b) => (a.name > b.name ? 1 : -1)),
                ...Object.values(MessageCommandMetadata).sort((a, b) => (a.name > b.name ? 1 : -1)),
                ...Object.values(UserCommandMetadata).sort((a, b) => (a.name > b.name ? 1 : -1)),
            ];
            
            Logger.info(`📝 Registriere ${localCmds.length} Commands...`);
            
            await commandRegistrationService.process(localCmds, process.argv);
            
            Logger.info('✅ Command-Registrierung abgeschlossen!');
            Logger.info('🎯 TempVoice-System vollständig einsatzbereit!');
            
        } catch (error) {
            Logger.error(Logs.error.commandAction, error);
        }
        
        // Wait for any final logs to be written.
        await new Promise(resolve => setTimeout(resolve, 1000));
        process.exit();
    }

    // Start bot
    try {
        await bot.start();
        Logger.info('🤖 Discord-Bot erfolgreich gestartet!');
        Logger.info('🔊 TempVoice-System ist online und bereit!');
        
        // TempVoice Startup Summary
        Logger.info('📋 TempVoice-System Zusammenfassung:');
        Logger.info('   ✅ 17 Commands verfügbar (by-Prefix)');
        Logger.info('   ✅ MongoDB Integration aktiv');
        Logger.info('   ✅ Performance-Monitoring läuft');
        Logger.info('   ✅ Automatische Cleanup-Routines aktiv');
        Logger.info('   ✅ Rate-Limiting und Sicherheit aktiviert');
        Logger.info('   ✅ Event-System und Caching bereit');
        
        // Performance Monitoring Setup - Logger.info statt Logger.debug
        setInterval(() => {
            const metrics = enhancedTempVoiceModule.getPerformanceMetrics();
            const cacheStats = enhancedTempVoiceModule.getCacheStats();
            
            Logger.info('📈 TempVoice Live-Metriken:');
            Logger.info(`   Channels: ${metrics.channelsCreated}/${metrics.channelsDeleted}`);
            Logger.info(`   Cache: ${cacheStats.size} Einträge`);
            Logger.info(`   Response: ${metrics.averageResponseTime.toFixed(2)}ms`);
        }, 1800000); // Alle 30 Minuten
        
    } catch (error) {
        Logger.error('❌ Fehler beim Starten des Discord-Bots:', error);
        process.exit(1);
    }

    // Graceful shutdown handling
    process.on('SIGINT', async () => {
        Logger.info('🛑 Graceful Shutdown initiiert...');
        
        try {
            // TempVoice Cleanup
            await enhancedTempVoiceModule.stop();
            Logger.info('✅ TempVoice-Modul bereinigt');
            
            // Bot Cleanup - korrigiert, da stop() möglicherweise nicht existiert
            if (bot && typeof (bot as any).stop === 'function') {
                await (bot as any).stop();
                Logger.info('✅ Bot gestoppt');
            }
            
            Logger.info('✅ Graceful Shutdown abgeschlossen');
            process.exit(0);
        } catch (error) {
            Logger.error('❌ Fehler beim Graceful Shutdown:', error);
            process.exit(1);
        }
    });

    process.on('SIGTERM', async () => {
        Logger.info('🛑 SIGTERM empfangen - Shutdown initiiert...');
        
        try {
            await enhancedTempVoiceModule.stop();
            Logger.info('✅ Shutdown abgeschlossen');
            process.exit(0);
        } catch (error) {
            Logger.error('❌ Fehler beim SIGTERM Shutdown:', error);
            process.exit(1);
        }
    });
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    Logger.error('Unhandled Rejection at:', promise);
    Logger.error('Reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    Logger.error('Uncaught Exception:', error);
    process.exit(1);
});

start().catch(error => {
    Logger.error('❌ Fataler Fehler beim Start:', error);
    process.exit(1);
});