import { exit } from "process";
import { TwitchAPI } from "./api";
import { Config } from "./config";
import { Database, DBStreamInfoEntry } from "./database";
import { Overlaps } from "./overlaps";
import { Scraper } from "./scraper";
import * as fs from "fs";
import { ILogObject, ISettingsParam, Logger } from "tslog";
import { reject } from "lodash";
import { resolve } from "path";

const TSLOG_OPTIONS = {
    displayFilePath: "hidden",
    //displayFunctionName: false,
};

export { TSLOG_OPTIONS };

declare interface StoreData {
    iteration: number,
    iterations_since_flush: number,
};

const STORE_PATH = process.env.STORE_PATH || String('/usr/share/tracker/config/data.json');
const LOG_PATH = process.env.LOG_PATH || String('/usr/share/tracker/config/logs.txt');

export class Main {

    private static log: Logger = new Logger({ name: 'Main', ...TSLOG_OPTIONS } as ISettingsParam);

    // Components
    public static config: Config;
    public static database: Database;
    public static api: TwitchAPI;
    public static overlaps: Overlaps;
    public static scraper: Scraper;

    // Global variables
    public static currentIteration: number = -1;
    public static currentTotalChatters: Map<string, number>;
    public static channels: string[];

    // Internal variables
    private static iterationsSinceFlush: number = 0;

    constructor() {}

    public async init(): Promise<void> {
        Main.log.info(`Initializing twitch tracker...`);
        Main.config = new Config();
        await Main.readDataFile();
        Main.currentTotalChatters = new Map<string, number>();

        Main.database = new Database();
        await Main.database.init();

        Main.api = new TwitchAPI();
        await Main.api.init();

        Main.scraper = new Scraper();
        Main.scraper.init(Main.database.writeChatters.bind(Main.database));

        Main.overlaps = new Overlaps();
    
        // Do initial start
        await Main.updateIteration(true);

        Main.log.info(`Initialized twitch tracker!`);
        Main.start();
    }

    public static async start(): Promise<void> {
        Main.log.info(`Starting collection for iteration ${Main.currentIteration} with ${Main.iterationsSinceFlush} iterations since flush.`);
        try {

            // Fetch top streams and write to database
            const top_streams: DBStreamInfoEntry[] = await Main.api.fetchTopStreams();
            await Main.database.flushStreamInfo(top_streams);

            // Write user info to database
            await Main.api.storeUsersFromFetch(top_streams);
            
            // Start scraper
            Main.channels = top_streams.map(stream => stream.channel_name);
            Main.log.info(`Starting collection cycle with channels: ${Main.channels}, total size of ${Main.channels.length}.`);
            Main.scraper.startCollection(Main.channels);
        } catch (err) {
            Main.log.error(`Error occured during collection cycle: ${err}.`);
        }
    }

    // Runs every half hour after end of channel queue is reached, called from scraper
    public static async handleEndOfQueue(): Promise<void> {
        this.log.info(`Reached end of channel queue for interval ${Main.currentIteration}.`);

        // Update iteration
        try {
            Main.iterationsSinceFlush = Main.iterationsSinceFlush + 1;
            await Main.updateIteration(false);

            // Check for flush
            if(Main.iterationsSinceFlush >= Config.config.flush_every) {
                // Flush overlaps
                await Main.flush();
            } else {
                // Restart collection cycle
                Main.start();
            }
        } catch (err) {
            Main.log.error(`Error occured while updating iteration: ${err}.`);
            Main.handleFatalError(err);
        }
    }

    // Flushes all data at end of n amount of collection cycles
    public static async flush(): Promise<void> {
        Main.log.warn(`Flushing data for all iterations from ${Main.currentIteration - Main.iterationsSinceFlush} through ${Main.currentIteration-1}.`);
        try {
            // Database calculates overlaps and flushes
            await Main.database.flushOverlaps();
        } catch (err) {
            Main.log.error(`Error occured while flushing overlaps: ${err}.`);
            this.handleFatalError(err);
        }

        Main.log.info(`Successfully flushed overlaps!`);

        // Reset iterationsSinceFlush and restart data collection
        Main.iterationsSinceFlush = 0;
        Main.start();
    }

    private static handleFatalError(err: any): void {
        Main.log.fatal(`===============================================================`);
        Main.log.fatal(`An unrecoverable error has occured. The program will abort.`);
        Main.log.fatal(JSON.stringify(err));
        Main.log.fatal(`===============================================================`);
        exit(255);
    }

    private static async readDataFile(): Promise<void> {
        try {
            await fs.promises.access(STORE_PATH, fs.constants.R_OK | fs.constants.W_OK);
        } catch(err) {
            this.log.fatal(`Failed to open store file ${STORE_PATH}. Aborting.`);
            exit(255);
        }

        const raw = await fs.promises.readFile(STORE_PATH)
        const data = JSON.parse(raw.toString()) as StoreData;
        Main.currentIteration = data.iteration;
        Main.iterationsSinceFlush = data.iterations_since_flush;
        Main.log.debug(`Current iteration on load: ${Main.currentIteration}, iterations since flush:${Main.iterationsSinceFlush}`);
        Main.log.debug(`Read store data file '${STORE_PATH}'.`);
    }

    public static async updateStoreData(data: StoreData): Promise<void> {
        Main.currentIteration = data.iteration;
        Main.iterationsSinceFlush = data.iterations_since_flush;
        fs.promises.writeFile(STORE_PATH, JSON.stringify(data)).then(res => resolve())
        .catch(err => {
            Main.log.error(`Failed to write to store data file. ${STORE_PATH}.`);
            reject(err);
        })
    }

    private static async updateIteration(initial: boolean): Promise<void> {
        try {
            Main.currentIteration = (initial ? Main.currentIteration : Main.currentIteration + 1);
            await Main.updateStoreData({
                iteration: Main.currentIteration,
                iterations_since_flush: Main.iterationsSinceFlush,
            } as StoreData);

            const timestamp = Main.database.getDatabaseTimestamp(); // change this?
            await Main.database.writeNewIteration({
                iteration: Main.currentIteration,
                timestamp: timestamp,
            });

            this.log.info(`Registered new iteration (${Main.currentIteration}) with timestamp ${timestamp}.`);
        } catch (err) {
            Main.log.error(`Error occured while updating iteration: ${err}.`);
            Main.handleFatalError(err);
        }
    }

    public static async logToFile(logObject: ILogObject): Promise<void> {
        return new Promise<void>((resolve) => {
            fs.promises.appendFile(LOG_PATH, `${logObject.date.toISOString()} | ${logObject.logLevel} | ${logObject.fileName}: ${logObject.argumentsArray[0]}` + "\n")
            .then(res => resolve())
            .catch(err => {
                console.log(`Error occured while logging to file: ${err}`);
                resolve();
            });
        })
    }

}

// Program entry point
const main: Main = new Main();
main.init();