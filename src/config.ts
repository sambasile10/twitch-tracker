import * as fs from "fs";
import { config } from "process";
import { Logger } from "tslog";

export declare interface ConfigData {
    channels: string[] // Channels to be tracked
}

const CONFIG_PATH = process.env.CONFIG_PATH || String(__dirname+'/config.json');

export class Config {

    private log: Logger = new Logger({ name: 'Config' });

    public static config: ConfigData;

    constructor() {}

    private loadConfig(): number {
        let rawText = fs.readFileSync(CONFIG_PATH).toString();
        Config.config = JSON.parse(rawText) as ConfigData;
        this.log.debug(`Read config file '${CONFIG_PATH}'.`);
        if(Config.config.channels) {
            return Config.config.channels.length;
        }

        return 0;
    }
}