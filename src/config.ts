import * as fs from "fs";
import { exit } from "process";
import { ISettingsParam, Logger } from "tslog";
import { TSLOG_OPTIONS } from "./main";

export declare interface ConfigData {
    languages: string, // Ignored for now
    search_depth: number, // Number of channels to search in top streams (must be divisible by 100)
    flush_every: number, // Flushes overlaps every x iterations (12 iterations = 6 hours)
}

const CONFIG_PATH = process.env.CONFIG_PATH || String(__dirname+'/config/config.json');

export class Config {

    private log: Logger = new Logger({ name: 'Config', ...TSLOG_OPTIONS } as ISettingsParam);

    public static config: ConfigData;

    constructor() {
        this.loadConfig();
    }

    private loadConfig(): number {
        if(!fs.existsSync(CONFIG_PATH)) {
            this.log.fatal(`Config file does not exist. Path: ${CONFIG_PATH}`);
            exit(255);
        }

        let rawText = fs.readFileSync(CONFIG_PATH).toString();
        Config.config = JSON.parse(rawText) as ConfigData;
        this.log.debug(`Read config file '${CONFIG_PATH}'.`);

        return 0;
    }
}