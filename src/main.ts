import { exit } from "process";
import { TwitchAPI } from "./api";
import { Config } from "./config";
import { Database } from "./database";
import { Overlaps } from "./overlaps";
import { Scraper } from "./scraper";
import * as fs from "fs";
import { ISettingsParam, Logger } from "tslog";
import { reject } from "lodash";
import { resolve } from "path";

const TSLOG_OPTIONS = {
    displayFilePath: "hidden",
    displayFunctionName: false,
};

export { TSLOG_OPTIONS };

declare interface StoreData {
    iteration: number,
};

const STORE_PATH = process.env.STORE_PATH || String(__dirname+'/config/data.json');

export class Main {

    private static log: Logger = new Logger({ name: 'Main', ...TSLOG_OPTIONS } as ISettingsParam);

    // Components
    public static config: Config;
    public static database: Database;
    public static api: TwitchAPI;
    public static overlaps: Overlaps;
    public static scraper: Scraper;

    // Global variables
    public static currentIteration: number;
    public static currentTotalChatters: Map<string, number>;

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
        Main.scraper.init(Main.database.writeChatters.bind(Main.database),
            Main.database.flushOverlaps.bind(Main.database));

        Main.overlaps = new Overlaps();
        Main.log.info(`Initialized twitch tracker!`);
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
        Main.log.debug(`Read store data file '${STORE_PATH}'.`);
    }

    public static async updateStoreData(data: StoreData): Promise<void> {
        Main.currentIteration = data.iteration;
        fs.promises.writeFile(STORE_PATH, JSON.stringify(data)).then(res => resolve())
        .catch(err => {
            Main.log.error(`Failed to write to store data file. ${STORE_PATH}.`);
            reject(err);
        })
    }
}


