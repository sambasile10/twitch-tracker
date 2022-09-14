import * as fs from "fs";
import { exit } from "process";
import { ISettingsParam, Logger } from "tslog";
import { TSLOG_OPTIONS } from "./main";

export declare interface ConfigData {
    channels: string[], // Channels to be tracked
    languages: string,
    search_depth: number,
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
        if(Config.config.channels) {
            return Config.config.channels.length;
        }

        return 0;
    }
}